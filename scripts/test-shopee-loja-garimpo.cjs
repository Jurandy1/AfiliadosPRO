#!/usr/bin/env node
"use strict";

/**
 * test-shopee-loja-garimpo.cjs — Testa se a API Shopee ainda devolve itens da loja.
 *
 * Modos:
 *   A) API direta (productOfferV2 shopId + keyword) — precisa SHOPEE_APP_ID + SHOPEE_SECRET
 *   B) Cloud Function shopeeGarimpoKeyword — usa VITE_BACKFILL_SECRET + VITE_GARIMPO_KEYWORD_URL
 *   C) Cloud Function shopeeBackupSimilaresShop — usa VITE_BACKFILL_SECRET + VITE_SIMILARES_URL
 *
 * Uso:
 *   node scripts/test-shopee-loja-garimpo.cjs
 *   node scripts/test-shopee-loja-garimpo.cjs 1505037811 "wid leg calca"
 *   node scripts/test-shopee-loja-garimpo.cjs 614376574 "canelada legging"
 *
 * Credenciais: .env na raiz (SHOPEE_APP_ID, SHOPEE_SECRET, VITE_BACKFILL_SECRET, URLs)
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

(function loadEnv() {
  const candidates = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    break;
  }
})();

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const CONNECT_TIMEOUT_MS = Number(process.env.SHOPEE_CONNECT_TIMEOUT_MS || 60_000);

const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
const SECRET = (process.env.SHOPEE_SECRET || "").trim();
const CF_SECRET = (process.env.VITE_BACKFILL_SECRET || process.env.META_SYNC_SECRET || "").trim();
const GARIMPO_URL = (process.env.VITE_GARIMPO_KEYWORD_URL || "").trim()
  || "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoKeyword";
const SIMILARES_URL = (process.env.VITE_SIMILARES_URL || "").trim()
  || "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackupSimilaresShop";

const shopId = process.argv[2] || "1505037811";
const keyword = process.argv[3] || "wid leg calca";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hr(title) {
  console.log("\n" + "═".repeat(60));
  console.log(title);
  console.log("═".repeat(60));
}

function signature(appId, ts, payload, secret) {
  return crypto.createHash("sha256").update(appId + ts + payload + secret).digest("hex");
}

function logFetchError(err, ctx) {
  console.error(`  ✗ ERRO [${ctx}]:`, err?.message || err);
  if (err?.cause) console.error("    causa:", err.cause?.message || err.cause);
  if (err?.code) console.error("    code:", err.code);
  if (err?.cause?.code) console.error("    cause.code:", err.cause.code);
}

/** fetch com connectTimeout maior (undici / Node 18+) */
async function fetchComTimeout(url, options = {}, timeoutMs = CONNECT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { ...options, signal: controller.signal };
    if (typeof globalThis.fetch === "function") {
      try {
        const { Agent, fetch: undiciFetch } = require("undici");
        const agent = new Agent({ connectTimeout: timeoutMs, headersTimeout: timeoutMs });
        return await undiciFetch(url, { ...init, dispatcher: agent });
      } catch {
        return await fetch(url, init);
      }
    }
    return await fetch(url, init);
  } finally {
    clearTimeout(timer);
  }
}

async function shopeeFetchDirect(query, label) {
  const t0 = Date.now();
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });
  const sig = signature(APP_ID, ts, payload, SECRET);

  try {
    const res = await fetchComTimeout(SHOPEE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${ts}, Signature=${sig}`,
      },
      body: payload,
    }, CONNECT_TIMEOUT_MS + 15_000);

    const text = await res.text();
    const ms = Date.now() - t0;
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`JSON inválido (${ms}ms): ${text.slice(0, 300)}`); }

    if (data.errors?.length) {
      const msg = data.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; ");
      console.log(`  ✗ ${label} — API erro (${ms}ms): ${msg}`);
      return { ok: false, ms, nodes: [], erro: msg };
    }

    const offer = data.data?.productOfferV2 || {};
    const nodes = offer.nodes || [];
    console.log(`  ✓ ${label} — ${nodes.length} itens em ${ms}ms`);
    nodes.slice(0, 5).forEach((n, i) => {
      const pct = (Number(n.commissionRate || 0) * 100).toFixed(1);
      console.log(`    ${i + 1}. [${n.itemId}] ${String(n.productName || "").slice(0, 55)} — R$ ${n.priceMin || n.price} — ${pct}%`);
    });
    if (nodes.length > 5) console.log(`    ... +${nodes.length - 5} itens`);
    return { ok: true, ms, nodes };
  } catch (err) {
    logFetchError(err, label);
    return { ok: false, ms: Date.now() - t0, nodes: [], erro: String(err?.message || err) };
  }
}

async function testApiDireta() {
  hr(`A) API DIRETA Shopee — shopId=${shopId} keyword="${keyword}"`);
  if (!APP_ID || !SECRET) {
    console.log("  ⊘ Pulado — SHOPEE_APP_ID / SHOPEE_SECRET não estão no .env");
    console.log("    Adicione no .env ou exporte antes de rodar.");
    return;
  }
  console.log(`  connectTimeout: ${CONNECT_TIMEOUT_MS}ms | appId: ${APP_ID.slice(0, 6)}...`);

  const qShop = `{
    productOfferV2(shopId: ${Number(shopId)}, sortType: 5, page: 1, limit: 20) {
      nodes {
        itemId shopId productName priceMin priceMax commissionRate sales ratingStar shopName
      }
      pageInfo { hasNextPage }
    }
  }`;

  const r1 = await shopeeFetchDirect(qShop, "productOfferV2(shopId)");
  await sleep(500);

  const qKw = `{
    productOfferV2(keyword: ${JSON.stringify(keyword)}, shopId: ${Number(shopId)}, listType: 1, sortType: 1, page: 1, limit: 15) {
      nodes {
        itemId shopId productName priceMin commissionRate sales shopName
      }
    }
  }`;

  const r2 = await shopeeFetchDirect(qKw, `productOfferV2(keyword+shopId)`);

  console.log("\n  Resumo API direta:");
  console.log(`    shopId:  ${r1.ok ? "OK" : "FALHOU"} — ${r1.nodes.length} itens (${r1.ms}ms)${r1.erro ? ` — ${r1.erro}` : ""}`);
  console.log(`    keyword: ${r2.ok ? "OK" : "FALHOU"} — ${r2.nodes.length} itens (${r2.ms}ms)${r2.erro ? ` — ${r2.erro}` : ""}`);
}

async function testCloudFunction(url, body, label) {
  const t0 = Date.now();
  if (!CF_SECRET) {
    console.log("  ⊘ Pulado — VITE_BACKFILL_SECRET não está no .env");
    return null;
  }
  try {
    const res = await fetchComTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }, 180_000);
    const ms = Date.now() - t0;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`); }

    if (!res.ok) {
      console.log(`  ✗ ${label} — HTTP ${res.status} (${ms}ms):`, data?.error || text.slice(0, 200));
      return { ok: false, ms, data };
    }

    const ofertas = data.ofertas || data.similares || [];
    console.log(`  ✓ ${label} — HTTP ${res.status} em ${ms}ms`);
    console.log(`    ofertas/similares: ${ofertas.length}`);
    if (data.shopeeApiOk !== undefined) console.log(`    shopeeApiOk: ${data.shopeeApiOk}`);
    if (data.fonte) console.log(`    fonte: ${data.fonte}`);
    if (data.motivoVazio) console.log(`    motivoVazio: ${data.motivoVazio}`);
    if (data.backupsNaLoja != null) console.log(`    backupsNaLoja: ${data.backupsNaLoja} | bloqueados: ${data.backupsBloqueados}`);
    ofertas.slice(0, 5).forEach((o, i) => {
      const nome = o.productName || o.nome || "?";
      const preco = o.priceMin ?? o.preco ?? "?";
      const pct = o.comissao_pct ?? (Number(o.commissionRate || 0) * 100);
      console.log(`    ${i + 1}. [${o.itemId}] ${String(nome).slice(0, 50)} — R$ ${preco} — ${Number(pct).toFixed(1)}%`);
    });
    return { ok: true, ms, data, count: ofertas.length };
  } catch (err) {
    logFetchError(err, label);
    return { ok: false, ms: Date.now() - t0, erro: String(err?.message || err) };
  }
}

async function testCloudFunctions() {
  hr(`B) Cloud Function — shopeeGarimpoKeyword`);
  console.log(`  URL: ${GARIMPO_URL}`);
  await testCloudFunction(GARIMPO_URL, {
    nome: keyword,
    nomeCompleto: keyword,
    apelido: keyword,
    shopId: String(shopId),
    comissaoPct: 5,
    precoPrincipal: 49.9,
    precoToleranciaAcimaPct: 100,
    precoToleranciaAbaixoPct: 0,
    limit: 10,
    excludeItemIds: [],
  }, "garimpo contextual");

  hr(`C) Cloud Function — shopeeBackupSimilaresShop`);
  console.log(`  URL: ${SIMILARES_URL}`);
  await testCloudFunction(
    `${SIMILARES_URL}?shopId=${encodeURIComponent(shopId)}`,
    { shopId: String(shopId) },
    "similares por shopId",
  );
}

async function main() {
  console.log("TESTE API LOJA — Garimpo / productOfferV2");
  console.log(`shopId: ${shopId} | keyword: "${keyword}"`);
  console.log(`hora: ${new Date().toISOString()}`);

  await testApiDireta();
  await testCloudFunctions();

  hr("FIM — interpretação rápida");
  console.log(`
  • API direta OK + Cloud Function FALHA → problema no backend/deploy/timeout GCP
  • API direta FALHA + Cloud Function FALHA → Shopee fora ou rede bloqueada
  • API direta FALHA + Cloud Function OK (fonte backup_cadastrado) → só Firestore, Shopee timeout
  • ofertas=0 + backupsBloqueados=backupsNaLoja → todos backups já no grupo
  • UND_ERR_CONNECT_TIMEOUT → aumentar connectTimeout no shopeeFetch (undici)
`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

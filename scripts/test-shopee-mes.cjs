#!/usr/bin/env node
"use strict";

/**
 * test-shopee-mes.cjs — TESTE LOCAL, NÃO GRAVA NADA NO FIREBASE.
 *
 * Puxa o conversionReport de um intervalo de datas direto da API Shopee,
 * agrega em memória e imprime os totais no terminal. Serve para comparar
 * as variantes de comissão (totalCommission vs itemTotalCommission vs net)
 * contra o alvo do CSV (R$ 35.432,67) ANTES de mexer no backend.
 *
 * Uso (na raiz do projeto Afiliadoteste-main):
 *   SHOPEE_APP_ID=xxx SHOPEE_SECRET=yyy node scripts/test-shopee-mes.cjs 2026-05-01 2026-05-31
 *
 * Ou crie .env na raiz do projeto com SHOPEE_APP_ID e SHOPEE_SECRET e rode:
 *   node scripts/test-shopee-mes.cjs 2026-05-01 2026-05-31
 *
 * Node 18+ (fetch nativo). Sem dependências externas.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ── carrega .env (scripts/.env ou raiz do projeto), sem dependência ─────────
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
const PAGE_LIMIT = 500;
const MAX_PAGES = 1000;
const PAGE_DELAY_MS = 200;
const NEW_QUERY_DELAY_MS = Math.max(31_000, Number(process.env.SHOPEE_NEW_QUERY_DELAY_MS || 31_000));

const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
const SECRET = (process.env.SHOPEE_SECRET || "").trim();

const startDate = process.argv[2] || "2026-05-01";
const endDate = process.argv[3] || "2026-05-31";

if (!APP_ID || !SECRET) {
  console.error("ERRO: defina SHOPEE_APP_ID e SHOPEE_SECRET (env ou .env na raiz do projeto).");
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
  console.error("ERRO: datas em YYYY-MM-DD. Ex: node scripts/test-shopee-mes.cjs 2026-05-01 2026-05-31");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundMoney = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function brtDateToUnixStart(d) { return Math.floor(Date.parse(`${d}T00:00:00-03:00`) / 1000); }
function brtDateToUnixEnd(d) { return Math.floor(Date.parse(`${d}T23:59:59-03:00`) / 1000); }

function signature(appId, ts, payload, secret) {
  return crypto.createHash("sha256").update(appId + ts + payload + secret).digest("hex");
}

async function shopeeFetch(query) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });
  const sig = signature(APP_ID, ts, payload, SECRET);
  const res = await fetch(SHOPEE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${ts}, Signature=${sig}`,
    },
    body: payload,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("Resposta inválida: " + text.slice(0, 200)); }
  if (data.errors && data.errors.length) {
    throw new Error("Shopee API: " + data.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; "));
  }
  return data.data;
}

function buildQuery(startTs, endTs, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  return `{
    conversionReport(limit: ${PAGE_LIMIT}, purchaseTimeStart: ${startTs}, purchaseTimeEnd: ${endTs}${scrollClause}) {
      nodes {
        conversionId conversionStatus purchaseTime
        totalCommission netCommission
        orders {
          orderId orderStatus
          items {
            itemId qty itemPrice actualAmount
            itemTotalCommission itemCommission
            attributionType displayItemStatus fraudStatus
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

async function pullRange(startTs, endTs) {
  const nodes = [];
  const seen = new Set();
  let scrollId = null, hasNext = true, page = 0, dup = 0;

  while (hasNext && page < MAX_PAGES) {
    page++;
    let data;
    try {
      data = await shopeeFetch(buildQuery(startTs, endTs, scrollId));
    } catch (err) {
      const msg = String(err.message || err);
      if (page === 1 || !/scroll|11001|params/i.test(msg)) throw err;
      console.warn(`  scrollId expirou na pág ${page}, reiniciando cadeia…`);
      scrollId = null; hasNext = true; page = 0;
      await sleep(NEW_QUERY_DELAY_MS);
      continue;
    }
    const report = data?.conversionReport || {};
    const list = report.nodes || [];
    let novos = 0;
    for (const n of list) {
      const cid = String(n?.conversionId || "").trim();
      const oid = String(n?.orders?.[0]?.orderId || "").trim();
      const key = (cid && oid) ? `${cid}__${oid}` : (cid || `__noid_${n?.purchaseTime || ""}_${oid}`);
      if (key && seen.has(key)) { dup++; continue; }
      if (key) seen.add(key);
      nodes.push(n);
      novos++;
    }
    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    const novoScroll = pi.scrollId || null;
    process.stdout.write(`\r  página ${page}: +${list.length} (${novos} novas) | total único: ${nodes.length}     `);
    if (hasNext && novoScroll === scrollId && novoScroll !== null) { console.log("\n  scrollId repetido, parando."); break; }
    scrollId = novoScroll;
    if (hasNext && !scrollId) { console.log("\n  hasNext sem scrollId, parando."); break; }
    if (hasNext) await sleep(PAGE_DELAY_MS);
  }
  console.log(`\n  → ${nodes.length} nodes únicos | ${dup} duplicados removidos | ${page} páginas`);
  return nodes;
}

function isExcludedVolume(st) {
  const s = String(st || "").toUpperCase().trim();
  return s === "CANCELLED" || s === "CANCELED" || s === "UNPAID";
}
function isExcludedCommission(st) {
  const s = String(st || "").toUpperCase().trim();
  return s === "CANCELLED" || s === "CANCELED";
}
function isDireta(attr) {
  return String(attr || "").toUpperCase().includes("SAME_SHOP") ? 1 : 0;
}

function comissaoTotal(node) {
  return parseFloat(node.totalCommission || "0") || 0;
}
function comissaoNet(node) {
  return parseFloat(node.netCommission || "0") || 0;
}
function comissaoItems(node) {
  let s = 0;
  for (const ord of node.orders || []) {
    for (const it of ord.items || []) {
      s += parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
    }
  }
  return s;
}

function agregar(nodes, commissionSource) {
  const pedidos = new Set();
  const comissaoPorPedido = new Map();
  let comissao = 0, gmv = 0, itens = 0, vendasDiretas = 0, vendasIndiretas = 0;
  const cancelados = new Set();

  for (const node of nodes) {
    const ord0 = node.orders?.[0];
    if (!ord0) continue;
    const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    if (isExcludedVolume(st0)) {
      const oid = String(ord0.orderId || "").trim();
      if (oid) cancelados.add(oid);
      continue;
    }

    const tc = commissionSource === "items" ? comissaoItems(node)
      : commissionSource === "net" ? comissaoNet(node)
      : comissaoTotal(node);

    let nodeValido = false;
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (isExcludedVolume(st)) continue;
      const oid = String(ord.orderId || "").trim();
      if (!oid) continue;
      let temItem = false;
      for (const it of ord.items || []) {
        const qty = parseInt(it.qty, 10) || 0;
        if (qty <= 0) continue;
        temItem = true;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const g = actual > 0 ? actual : price * qty;
        const d = isDireta(it.attributionType);
        itens += qty;
        vendasDiretas += d * qty;
        vendasIndiretas += (d ? 0 : 1) * qty;
        gmv += g;
      }
      if (!temItem) continue;
      nodeValido = true;
      pedidos.add(oid);
    }
    if (!nodeValido) continue;

    let oidCom = "";
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (isExcludedCommission(st)) continue;
      oidCom = String(ord.orderId || "").trim();
      if (oidCom) break;
    }
    if (!oidCom) oidCom = String(ord0.orderId || "").trim();
    if (!oidCom) continue;
    if (comissaoPorPedido.has(oidCom)) {
      const prev = comissaoPorPedido.get(oidCom);
      if (tc > prev) { comissao += tc - prev; comissaoPorPedido.set(oidCom, tc); }
    } else {
      comissaoPorPedido.set(oidCom, tc);
      comissao += tc;
    }
  }

  return {
    pedidos: pedidos.size,
    comissao: roundMoney(comissao),
    gmv: roundMoney(gmv),
    itens,
    vendas_diretas: vendasDiretas,
    vendas_indiretas: vendasIndiretas,
    pedidos_cancelados: cancelados.size,
  };
}

function somasCruas(nodes) {
  let total = 0, net = 0, item = 0, actual = 0, qty = 0;
  for (const n of nodes) {
    total += comissaoTotal(n);
    net += comissaoNet(n);
    for (const ord of n.orders || []) {
      for (const it of ord.items || []) {
        item += parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
        actual += parseFloat(it.actualAmount || "0") || 0;
        qty += parseInt(it.qty, 10) || 0;
      }
    }
  }
  return { total: roundMoney(total), net: roundMoney(net), item: roundMoney(item), actual: roundMoney(actual), qty };
}

const ALVO = {
  pedidos: 11818, comissao: 35432.67, gmv: 696359.73, itens: 13475,
  vendas_diretas: 1989, vendas_indiretas: 11486,
};

(async () => {
  console.log(`\n=== TESTE LOCAL Shopee (NÃO grava nada) ===`);
  console.log(`Período: ${startDate} → ${endDate}\n`);

  const startTs = brtDateToUnixStart(startDate);
  const endTs = brtDateToUnixEnd(endDate);

  console.log("Puxando conversionReport…");
  const nodes = await pullRange(startTs, endTs);

  const cru = somasCruas(nodes);
  console.log("\n── Somas CRUAS (sem dedup/filtro, referência) ──");
  console.log(`  Σ totalCommission       : R$ ${cru.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Σ itemTotalCommission   : R$ ${cru.item.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Σ netCommission         : R$ ${cru.net.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Σ actualAmount (GMV)    : R$ ${cru.actual.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  Σ qty                   : ${cru.qty.toLocaleString("pt-BR")}`);

  const fontes = ["total", "items", "net"];
  console.log("\n── Agregação Regra A (scope order, 1×/orderId) por fonte de comissão ──");
  for (const src of fontes) {
    const t = agregar(nodes, src);
    const gapCom = roundMoney(t.comissao - ALVO.comissao);
    console.log(`\n  commissionSource = "${src}"`);
    console.log(`    comissao        : R$ ${t.comissao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}  (alvo 35.432,67 · gap ${gapCom >= 0 ? "+" : ""}${gapCom})`);
    console.log(`    pedidos         : ${t.pedidos.toLocaleString("pt-BR")}  (alvo 11.818 · gap ${t.pedidos - ALVO.pedidos})`);
    console.log(`    itens           : ${t.itens.toLocaleString("pt-BR")}  (alvo 13.475 · gap ${t.itens - ALVO.itens})`);
    console.log(`    gmv             : R$ ${t.gmv.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}  (alvo 696.359,73 · gap ${roundMoney(t.gmv - ALVO.gmv)})`);
    console.log(`    vendas_diretas  : ${t.vendas_diretas.toLocaleString("pt-BR")}  (alvo 1.989 · gap ${t.vendas_diretas - ALVO.vendas_diretas})`);
    console.log(`    vendas_indiretas: ${t.vendas_indiretas.toLocaleString("pt-BR")}  (alvo 11.486 · gap ${t.vendas_indiretas - ALVO.vendas_indiretas})`);
    console.log(`    cancelados      : ${t.pedidos_cancelados.toLocaleString("pt-BR")}`);
  }

  console.log("\n=== fim (nada foi gravado) ===\n");
})().catch((e) => {
  console.error("\nFALHOU:", e.message || e);
  process.exit(1);
});

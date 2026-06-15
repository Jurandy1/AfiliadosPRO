#!/usr/bin/env node
"use strict";

/**
 * test-shopee-utm.cjs — TESTE LOCAL, NÃO GRAVA NADA.
 *
 * Inspeciona o campo utmContent (e variantes) da API Shopee em pedidos
 * que sabemos ter múltiplos sub_ids no CSV.
 *
 * Caso testado: 2606021CA4PWUX e 26060215P823S4 — ambos com
 * sub_id1=LGFLARE + sub_id2=LGSUPLEXDP no CSV, mas que viraram
 * "lgflarelgsuplexdp" colado no painel.
 *
 * Uso:
 *   node scripts\test-shopee-utm.cjs
 *
 * Lê SHOPEE_APP_ID / SHOPEE_SECRET do .env. Node 18+.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

(function loadEnv() {
  for (const p of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
})();

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const PAGE_LIMIT = 500, MAX_PAGES = 1000, PAGE_DELAY_MS = 200;
const NEW_QUERY_DELAY_MS = Math.max(31_000, Number(process.env.SHOPEE_NEW_QUERY_DELAY_MS || 31_000));
const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
const SECRET = (process.env.SHOPEE_SECRET || "").trim();

if (!APP_ID || !SECRET) { console.error("ERRO: defina SHOPEE_APP_ID e SHOPEE_SECRET."); process.exit(1); }

// Os 2 pedidos críticos com sub_id1=LGFLARE + sub_id2=LGSUPLEXDP no CSV
const ALVOS = new Set(["2606021CA4PWUX", "26060215P823S4"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brtStart = (d) => Math.floor(Date.parse(`${d}T00:00:00-03:00`) / 1000);
const brtEnd = (d) => Math.floor(Date.parse(`${d}T23:59:59-03:00`) / 1000);
const sig = (a, t, p, s) => crypto.createHash("sha256").update(a + t + p + s).digest("hex");

async function shopeeFetch(query) {
  const t = Math.floor(Date.now() / 1000), p = JSON.stringify({ query });
  const res = await fetch(SHOPEE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${t}, Signature=${sig(APP_ID, t, p, SECRET)}` },
    body: p,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error("inválido: " + text.slice(0, 200)); }
  if (data.errors?.length) throw new Error("Shopee API: " + data.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; "));
  return data.data;
}

/**
 * Query EXPANDIDA — tenta puxar todos os campos de sub_id que a API talvez exponha.
 * utmContent (padrão atual) e variantes plausíveis: subIds, sub_id1..5, customId.
 */
function buildQuery(s, e, scroll) {
  const sc = scroll ? `, scrollId: ${JSON.stringify(scroll)}` : "";
  return `{
    conversionReport(limit: ${PAGE_LIMIT}, purchaseTimeStart: ${s}, purchaseTimeEnd: ${e}${sc}) {
      nodes {
        conversionId conversionStatus purchaseTime
        utmContent referrer
        orders { orderId orderStatus }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

(async () => {
  console.log(`\n=== Inspeção utmContent — alvos: ${[...ALVOS].join(", ")} ===\n`);
  const dia = "2026-06-01"; // confirmado pelo CSV: ambos pedidos são 01/06
  let scroll = null, hasNext = true, page = 0;
  const achados = [];

  while (hasNext && page < MAX_PAGES) {
    page++;
    let data;
    try { data = await shopeeFetch(buildQuery(brtStart(dia), brtEnd(dia), scroll)); }
    catch (err) {
      const m = String(err.message || err);
      if (page === 1 || !/scroll|11001|params/i.test(m)) throw err;
      scroll = null; hasNext = true; page = 0; await sleep(NEW_QUERY_DELAY_MS); continue;
    }
    const r = data?.conversionReport || {}, list = r.nodes || [];
    for (const n of list) {
      for (const ord of n.orders || []) {
        const oid = String(ord.orderId || "").trim();
        if (ALVOS.has(oid)) achados.push({ node: n, order: ord });
      }
    }
    const pi = r.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    process.stdout.write(`\r  pág ${page} | achados: ${achados.length}/${ALVOS.size}     `);
    if (achados.length >= ALVOS.size) break;
    if (hasNext && pi.scrollId === scroll && pi.scrollId !== null) break;
    scroll = pi.scrollId || null;
    if (hasNext && !scroll) break;
    if (hasNext) await sleep(PAGE_DELAY_MS);
  }
  console.log("");

  if (!achados.length) {
    console.log("\nNão achei os pedidos em 02/06. Pode estar em 01/06; cole o resultado e a gente tenta de novo.");
    return;
  }

  for (const { node, order } of achados) {
    console.log(`── ${order.orderId} (status ${order.orderStatus}) ──`);
    console.log(`  conversionId   : ${node.conversionId}`);
    console.log(`  purchaseTime   : ${node.purchaseTime}`);
    console.log(`  utmContent     : ${JSON.stringify(node.utmContent)}`);
    console.log(`  typeof         : ${typeof node.utmContent}`);
    console.log(`  isArray        : ${Array.isArray(node.utmContent)}`);
    if (typeof node.utmContent === "string") {
      console.log(`  tem vírgula?   : ${node.utmContent.includes(",")}`);
      console.log(`  tem pipe?      : ${node.utmContent.includes("|")}`);
      console.log(`  tem espaço?    : ${node.utmContent.includes(" ")}`);
      console.log(`  length         : ${node.utmContent.length}`);
    }
    console.log(`  referrer       : ${JSON.stringify(node.referrer)}`);
    console.log("");
  }

  console.log("=== fim (nada gravado) ===\n");
})().catch((e) => { console.error("\nFALHOU:", e.message || e); process.exit(1); });

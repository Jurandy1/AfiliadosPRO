#!/usr/bin/env node
"use strict";

/**
 * test-shopee-pedido.cjs — TESTE LOCAL, NÃO GRAVA NADA.
 *
 * Puxa o conversionReport de um dia (ou intervalo) e imprime o node CRU de um orderId,
 * com TODOS os campos de comissão (node-level e item-level).
 *
 * Uso (raiz Afiliadoteste-main):
 *   node scripts\test-shopee-pedido.cjs 260521264SR6YJ 2026-05-21
 *   node scripts\test-shopee-pedido.cjs 260521264SR6YJ 2026-05-20..2026-05-22
 *
 * Lê SHOPEE_APP_ID / SHOPEE_SECRET do .env na raiz. Node 18+.
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
const PAGE_LIMIT = 500;
const MAX_PAGES = 1000;
const PAGE_DELAY_MS = 200;
const NEW_QUERY_DELAY_MS = Math.max(31_000, Number(process.env.SHOPEE_NEW_QUERY_DELAY_MS || 31_000));
const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
const SECRET = (process.env.SHOPEE_SECRET || "").trim();

const alvoOrderId = String(process.argv[2] || "").trim();
const dateArg = String(process.argv[3] || "").trim();

if (!alvoOrderId) {
  console.error("ERRO: passe o orderId. Ex:\n  node scripts\\test-shopee-pedido.cjs 260521264SR6YJ 2026-05-21");
  process.exit(1);
}
if (!APP_ID || !SECRET) {
  console.error("ERRO: defina SHOPEE_APP_ID e SHOPEE_SECRET no .env da raiz do projeto.");
  process.exit(1);
}

let dias = [];
if (/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  const [ini, fim] = dateArg.split("..");
  let cur = ini;
  while (cur <= fim) {
    dias.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const nx = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${nx.getUTCFullYear()}-${String(nx.getUTCMonth() + 1).padStart(2, "0")}-${String(nx.getUTCDate()).padStart(2, "0")}`;
  }
} else if (/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  dias = [dateArg];
} else {
  console.error("ERRO: 3º arg deve ser YYYY-MM-DD ou YYYY-MM-DD..YYYY-MM-DD");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brtStart = (d) => Math.floor(Date.parse(`${d}T00:00:00-03:00`) / 1000);
const brtEnd = (d) => Math.floor(Date.parse(`${d}T23:59:59-03:00`) / 1000);
const sig = (a, t, p, s) => crypto.createHash("sha256").update(a + t + p + s).digest("hex");
const toN = (v) => parseFloat(v || "0") || 0;

async function shopeeFetch(query) {
  const t = Math.floor(Date.now() / 1000);
  const p = JSON.stringify({ query });
  const res = await fetch(SHOPEE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${t}, Signature=${sig(APP_ID, t, p, SECRET)}`,
    },
    body: p,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("inválido: " + text.slice(0, 200));
  }
  if (data.errors?.length) {
    throw new Error("Shopee API: " + data.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; "));
  }
  return data.data;
}

function buildQuery(s, e, scroll) {
  const sc = scroll ? `, scrollId: ${JSON.stringify(scroll)}` : "";
  return `{
    conversionReport(limit: ${PAGE_LIMIT}, purchaseTimeStart: ${s}, purchaseTimeEnd: ${e}${sc}) {
      nodes {
        conversionId conversionStatus purchaseTime
        totalCommission netCommission shopeeCommissionCapped sellerCommission
        mcnManagementFee mcnManagementFeeRate
        orders {
          orderId orderStatus shopType
          items {
            itemId itemName modelId qty itemPrice actualAmount refundAmount
            itemTotalCommission itemCommission
            itemSellerCommission itemSellerCommissionRate
            itemShopeeCommissionCapped itemShopeeCommissionRate
            displayItemStatus fraudStatus completeTime attributionType
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

async function buscarNodeNoDia(dia) {
  let scroll = null;
  let hasNext = true;
  let page = 0;
  const achados = [];
  while (hasNext && page < MAX_PAGES) {
    page++;
    let data;
    try {
      data = await shopeeFetch(buildQuery(brtStart(dia), brtEnd(dia), scroll));
    } catch (err) {
      const m = String(err.message || err);
      if (page === 1 || !/scroll|11001|params/i.test(m)) throw err;
      scroll = null;
      hasNext = true;
      page = 0;
      await sleep(NEW_QUERY_DELAY_MS);
      continue;
    }
    const r = data?.conversionReport || {};
    const list = r.nodes || [];
    for (const n of list) {
      for (const ord of n.orders || []) {
        if (String(ord.orderId || "").trim() === alvoOrderId) achados.push({ node: n, order: ord });
      }
    }
    const pi = r.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    process.stdout.write(`\r  ${dia} pág ${page} | varrendo…     `);
    if (hasNext && pi.scrollId === scroll && pi.scrollId !== null) break;
    scroll = pi.scrollId || null;
    if (hasNext && !scroll) break;
    if (hasNext) await sleep(PAGE_DELAY_MS);
  }
  process.stdout.write("\r");
  return achados;
}

function resumoComissao(node, order) {
  let sumItemTotal = 0;
  let sumItemParts = 0;
  for (const it of order.items || []) {
    sumItemTotal += toN(it.itemTotalCommission || it.itemCommission);
    sumItemParts += toN(it.itemShopeeCommissionCapped) + toN(it.itemSellerCommission);
  }
  const nodeTotal = toN(node.totalCommission);
  const nodeParts = toN(node.shopeeCommissionCapped) + toN(node.sellerCommission);
  return { sumItemTotal, sumItemParts, nodeTotal, nodeParts, net: toN(node.netCommission) };
}

(async () => {
  console.log(`\n=== Inspeção do pedido ${alvoOrderId} (NÃO grava nada) ===\n`);
  let achados = [];
  let diaEncontrado = null;
  for (let i = 0; i < dias.length; i++) {
    if (i > 0) {
      console.log(`  (aguardando ${NEW_QUERY_DELAY_MS / 1000}s — regra da API entre dias)`);
      await sleep(NEW_QUERY_DELAY_MS);
    }
    achados = await buscarNodeNoDia(dias[i]);
    if (achados.length) {
      diaEncontrado = dias[i];
      console.log(`  encontrado em ${diaEncontrado}\n`);
      break;
    }
    console.log(`  não está em ${dias[i]}`);
  }

  if (!achados.length) {
    console.log("\nNão achei esse orderId nas datas varridas. Tente outro dia ou intervalo.\n");
    return;
  }

  for (const { node, order } of achados) {
    const r = resumoComissao(node, order);
    console.log("── NODE (nível conversão) ──");
    console.log(`  conversionId          : ${node.conversionId}`);
    console.log(`  conversionStatus      : ${node.conversionStatus}`);
    console.log(`  purchaseTime          : ${node.purchaseTime}`);
    console.log(`  totalCommission       : ${node.totalCommission}`);
    console.log(`  netCommission         : ${node.netCommission}`);
    console.log(`  shopeeCommissionCapped: ${node.shopeeCommissionCapped}`);
    console.log(`  sellerCommission      : ${node.sellerCommission}`);

    console.log(`\n── ORDER ${order.orderId} (status ${order.orderStatus}) ──`);
    for (const it of order.items || []) {
      console.log(`  item ${it.itemId} / model ${it.modelId} · qty ${it.qty} · "${String(it.itemName || "").slice(0, 50)}"`);
      console.log(`    itemTotalCommission        : ${it.itemTotalCommission}`);
      console.log(`    itemCommission             : ${it.itemCommission}`);
      console.log(`    itemSellerCommission       : ${it.itemSellerCommission}`);
      console.log(`    itemShopeeCommissionCapped : ${it.itemShopeeCommissionCapped}`);
      console.log(`    actualAmount               : ${it.actualAmount}`);
      console.log(`    displayItemStatus          : ${it.displayItemStatus}`);
    }

    console.log("\n── SOMA rápida (onde estão os R$?) ──");
    console.log(`  Σ itemTotalCommission     : ${r.sumItemTotal.toFixed(4)}`);
    console.log(`  Σ itemShopee+itemSeller   : ${r.sumItemParts.toFixed(4)}`);
    console.log(`  node.totalCommission      : ${r.nodeTotal.toFixed(4)}`);
    console.log(`  node.shopee+seller        : ${r.nodeParts.toFixed(4)}`);
    console.log(`  node.netCommission        : ${r.net.toFixed(4)}`);
    console.log("");
  }
  console.log("=== fim (nada gravado) ===\n");
})().catch((e) => {
  console.error("\nFALHOU:", e.message || e);
  process.exit(1);
});

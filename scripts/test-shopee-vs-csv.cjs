#!/usr/bin/env node
"use strict";

/**
 * test-shopee-vs-csv.cjs — TESTE LOCAL, NÃO GRAVA NADA NO FIREBASE.
 *
 * Cruza o export oficial (ex. MAIO.csv) com o conversionReport da API, por orderId,
 * para descobrir se o gap vem de:
 *   (a) pedidos no CSV que a API não retornou  → problema de DADO
 *   (b) pedidos na API que a agregação descarta → problema de CRITÉRIO
 *
 * Uso (raiz Afiliadoteste-main):
 *   node scripts\test-shopee-vs-csv.cjs "C:\Users\PC\Desktop\BATIMENTO DE COMPRAS\MAIO.csv" 2026-05-01 2026-05-31
 *
 * Lê SHOPEE_APP_ID / SHOPEE_SECRET do .env na raiz do projeto. Node 18+.
 * Não usa firebase-admin. Não altera functions/index.js.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

(function loadEnv() {
  for (const p of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
})();

const COL_ORDER_ID = ["ID do pedido"];
const COL_ITEM_COMM = ["Comissão total do item(R$)", "Comissão total do item"];
const COL_ORDER_COMM = ["Comissão total do pedido(R$)", "Comissão total do pedido"];
const COL_QTY = ["Qtd"];

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const PAGE_LIMIT = 500;
const MAX_PAGES = 1000;
const PAGE_DELAY_MS = 200;
const NEW_QUERY_DELAY_MS = Math.max(31_000, Number(process.env.SHOPEE_NEW_QUERY_DELAY_MS || 31_000));
const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
const SECRET = (process.env.SHOPEE_SECRET || "").trim();

const csvPath = process.argv[2];
const startDate = process.argv[3] || "2026-05-01";
const endDate = process.argv[4] || "2026-05-31";

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('ERRO: passe o caminho do CSV. Ex:\n  node scripts\\test-shopee-vs-csv.cjs "C:\\...\\MAIO.csv" 2026-05-01 2026-05-31');
  process.exit(1);
}
if (!APP_ID || !SECRET) {
  console.error("ERRO: defina SHOPEE_APP_ID e SHOPEE_SECRET no .env da raiz do projeto.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundMoney = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const toNum = (s) => {
  const t = String(s || "").replace(/[R$\s]/g, "").trim();
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) return parseFloat(t.replace(/\./g, "").replace(",", ".")) || 0;
  if (t.includes(",")) return parseFloat(t.replace(",", ".")) || 0;
  return parseFloat(t) || 0;
};

function detectSep(firstLine) {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function parseCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === sep && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function pickCol(header, candidates) {
  for (const c of candidates) {
    const idx = header.findIndex((h) => h.trim().toLowerCase() === c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function lerCsv() {
  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  const CSV_SEP = detectSep(lines[0]);
  const header = parseCsvLine(lines[0], CSV_SEP).map((h) => h.trim());
  console.log(`Separador detectado: ${CSV_SEP === "\t" ? "TAB" : "vírgula"}`);
  console.log("Colunas detectadas no CSV:", header.slice(0, 8).join(" | ") + (header.length > 8 ? " | …" : ""));

  const iOid = pickCol(header, COL_ORDER_ID);
  const iItemComm = pickCol(header, COL_ITEM_COMM);
  const iOrderComm = pickCol(header, COL_ORDER_COMM);
  const iQty = pickCol(header, COL_QTY);

  if (iOid < 0) {
    console.error(`\nNÃO achei coluna de pedido. Procurei: ${COL_ORDER_ID.join(", ")}`);
    process.exit(1);
  }
  if (iItemComm < 0) {
    console.error(`\nNÃO achei coluna de comissão item. Procurei: ${COL_ITEM_COMM.join(", ")}`);
    process.exit(1);
  }

  const porOrder = new Map();
  let totalLinhas = 0;
  let totalQtd = 0;
  let somaComissaoItem = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], CSV_SEP);
    const oid = String(cols[iOid] || "").trim();
    if (!oid) continue;
    totalLinhas++;
    const q = iQty >= 0 ? parseInt(cols[iQty], 10) || 0 : 0;
    totalQtd += q;
    const ci = toNum(cols[iItemComm]);
    somaComissaoItem += ci;
    if (!porOrder.has(oid)) {
      porOrder.set(oid, { comissaoItem: 0, comissaoPedido: 0, linhas: 0, qtd: 0 });
    }
    const rec = porOrder.get(oid);
    rec.linhas++;
    rec.qtd += q;
    rec.comissaoItem += ci;
    if (iOrderComm >= 0) rec.comissaoPedido = Math.max(rec.comissaoPedido, toNum(cols[iOrderComm]));
  }

  console.log(`  CSV: ${totalLinhas} linhas-item · ${porOrder.size} pedidos · Σ Qtd = ${totalQtd}`);
  console.log(`  CSV: Σ Comissão total do item = R$ ${roundMoney(somaComissaoItem).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  return porOrder;
}

function brtStart(d) {
  return Math.floor(Date.parse(`${d}T00:00:00-03:00`) / 1000);
}
function brtEnd(d) {
  return Math.floor(Date.parse(`${d}T23:59:59-03:00`) / 1000);
}
function sig(a, t, p, s) {
  return crypto.createHash("sha256").update(a + t + p + s).digest("hex");
}

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
  return `{ conversionReport(limit: ${PAGE_LIMIT}, purchaseTimeStart: ${s}, purchaseTimeEnd: ${e}${sc}) {
    nodes { conversionId conversionStatus purchaseTime totalCommission netCommission
      orders { orderId orderStatus items { qty itemTotalCommission itemCommission itemPrice actualAmount } } }
    pageInfo { hasNextPage scrollId } } }`;
}

async function pull(s, e) {
  const nodes = [];
  const seen = new Set();
  let scroll = null;
  let hasNext = true;
  let page = 0;
  let dup = 0;

  while (hasNext && page < MAX_PAGES) {
    page++;
    let data;
    try {
      data = await shopeeFetch(buildQuery(s, e, scroll));
    } catch (err) {
      const m = String(err.message || err);
      if (page === 1 || !/scroll|11001|params/i.test(m)) throw err;
      console.warn(`  scrollId expirou, reiniciando cadeia (${NEW_QUERY_DELAY_MS / 1000}s)…`);
      scroll = null;
      hasNext = true;
      page = 0;
      await sleep(NEW_QUERY_DELAY_MS);
      continue;
    }
    const r = data?.conversionReport || {};
    const list = r.nodes || [];
    for (const n of list) {
      const cid = String(n?.conversionId || "").trim();
      const oid = String(n?.orders?.[0]?.orderId || "").trim();
      const k = cid && oid ? `${cid}__${oid}` : cid || `__n_${n?.purchaseTime}_${oid}`;
      if (k && seen.has(k)) {
        dup++;
        continue;
      }
      if (k) seen.add(k);
      nodes.push(n);
    }
    const pi = r.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    process.stdout.write(`\r  página ${page} | nodes únicos: ${nodes.length} | dup: ${dup}     `);
    if (hasNext && pi.scrollId === scroll && pi.scrollId !== null) break;
    scroll = pi.scrollId || null;
    if (hasNext && !scroll) break;
    if (hasNext) await sleep(PAGE_DELAY_MS);
  }
  console.log(`\n  → ${nodes.length} nodes | ${dup} duplicados removidos`);
  return nodes;
}

function comissaoItemsNode(node) {
  let s = 0;
  for (const ord of node.orders || []) {
    for (const it of ord.items || []) {
      s += parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
    }
  }
  return s;
}

function buildApiOrders(nodes) {
  const map = new Map();
  for (const n of nodes) {
    const tcTotal = parseFloat(n.totalCommission || "0") || 0;
    const tcItems = comissaoItemsNode(n);
    for (const ord of n.orders || []) {
      const oid = String(ord.orderId || "").trim();
      if (!oid) continue;
      const st = String(ord.orderStatus || n.conversionStatus || "").toUpperCase().trim();
      const prev = map.get(oid);
      if (!prev) {
        map.set(oid, {
          status: st,
          totalCommission: tcTotal,
          itemCommission: tcItems,
          nodes: 1,
        });
      } else {
        prev.nodes++;
        prev.totalCommission = Math.max(prev.totalCommission, tcTotal);
        prev.itemCommission = Math.max(prev.itemCommission, tcItems);
        if (!prev.status && st) prev.status = st;
      }
    }
  }
  return map;
}

(async () => {
  console.log(`\n=== CSV vs API (NÃO grava nada) ===\nPeríodo: ${startDate} → ${endDate}\n`);

  console.log("Lendo CSV…");
  const csvOrders = lerCsv();

  console.log("\nPuxando API (conversionReport)…");
  const nodes = await pull(brtStart(startDate), brtEnd(endDate));
  const apiOrders = buildApiOrders(nodes);
  console.log(`  API: ${apiOrders.size} orderIds únicos`);

  const soNoCsv = [];
  for (const [oid, rec] of csvOrders) {
    if (!apiOrders.has(oid)) soNoCsv.push({ oid, ...rec });
  }

  const soNaApi = [];
  for (const [oid, rec] of apiOrders) {
    if (!csvOrders.has(oid)) soNaApi.push({ oid, ...rec });
  }

  const comissaoOrfaCsv = roundMoney(soNoCsv.reduce((s, r) => s + (r.comissaoItem || 0), 0));
  const comissaoOrfaApi = roundMoney(
    soNaApi.reduce((s, r) => s + (r.itemCommission || r.totalCommission || 0), 0),
  );

  const emAmbos = [];
  for (const [oid, csvRec] of csvOrders) {
    if (apiOrders.has(oid)) {
      const apiRec = apiOrders.get(oid);
      emAmbos.push({
        oid,
        gapItem: roundMoney(csvRec.comissaoItem - apiRec.itemCommission),
        csvItem: roundMoney(csvRec.comissaoItem),
        apiItem: roundMoney(apiRec.itemCommission),
      });
    }
  }

  console.log("\n── CRUZAMENTO por orderId ──");
  console.log(`  no CSV e NÃO na API : ${soNoCsv.length} pedidos`);
  console.log(`    → comissão item (CSV) somada: R$ ${comissaoOrfaCsv.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  na API e NÃO no CSV : ${soNaApi.length} pedidos`);
  console.log(`    → comissão item/total (API) somada: R$ ${comissaoOrfaApi.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  em ambos            : ${emAmbos.length} pedidos`);

  if (soNoCsv.length) {
    console.log("\n  Amostra — CSV tem, API não retornou:");
    for (const r of soNoCsv.slice(0, 15)) {
      console.log(
        `    ${r.oid}  · comissão item R$ ${roundMoney(r.comissaoItem)}  · ${r.linhas} linha(s)  · qtd ${r.qtd}`,
      );
    }
    if (soNoCsv.length > 15) console.log(`    … +${soNoCsv.length - 15} pedidos`);
  }

  if (soNaApi.length) {
    console.log("\n  Amostra — API tem, CSV não tem:");
    for (const r of soNaApi.slice(0, 10)) {
      console.log(`    ${r.oid}  · status ${r.status}  · item R$ ${roundMoney(r.itemCommission)}`);
    }
    if (soNaApi.length > 10) console.log(`    … +${soNaApi.length - 10} pedidos`);
  }

  const excl = { CANCELLED: 0, CANCELED: 0, UNPAID: 0, outros: 0 };
  for (const rec of apiOrders.values()) {
    const st = rec.status || "";
    if (st === "CANCELLED" || st === "CANCELED") excl.CANCELLED++;
    else if (st === "UNPAID") excl.UNPAID++;
    else excl.outros++;
  }
  console.log("\n  Status na API (contagem de pedidos):", JSON.stringify(excl));

  const gapsGrandes = emAmbos
    .filter((x) => Math.abs(x.gapItem) > 0.01)
    .sort((a, b) => Math.abs(b.gapItem) - Math.abs(a.gapItem))
    .slice(0, 5);
  if (gapsGrandes.length) {
    console.log("\n  Maiores diferenças comissão item (CSV − API) no mesmo pedido:");
    for (const g of gapsGrandes) {
      console.log(`    ${g.oid}  CSV R$ ${g.csvItem}  API R$ ${g.apiItem}  gap ${g.gapItem >= 0 ? "+" : ""}${g.gapItem}`);
    }
  }

  console.log("\n=== fim (nada gravado) ===\n");
})().catch((e) => {
  console.error("\nFALHOU:", e.message || e);
  process.exit(1);
});

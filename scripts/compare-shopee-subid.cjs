#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require('@supabase/supabase-js');
const { normalizeSubId } = require("../functions/lib/normalizeSubId");

// Load .env
(function loadEnv() {
  const candidates = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", ".env.local"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  }
})();

const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
const SECRET = (process.env.SHOPEE_SECRET || "").trim();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const PAGE_LIMIT = 500;
const PAGE_DELAY_MS = 200;

const startDate = process.argv[2] || "2026-06-01";
const endDate = process.argv[3] || "2026-06-25";

if (!APP_ID || !SECRET) {
  console.error("ERRO: defina SHOPEE_APP_ID e SHOPEE_SECRET (env ou .env na raiz do projeto).");
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
        utmContent
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

  while (hasNext && page < 1000) {
    page++;
    let data;
    try {
      data = await shopeeFetch(buildQuery(startTs, endTs, scrollId));
    } catch (err) {
      const msg = String(err.message || err);
      if (page === 1 || !/scroll|11001|params/i.test(msg)) throw err;
      console.warn(`  scrollId expirou na pág ${page}, reiniciando cadeia…`);
      scrollId = null; hasNext = true; page = 0;
      await sleep(31000);
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

function agregarPorSubId(nodes) {
  const map = {}; // subid => comissao
  for (const node of nodes) {
    const ord0 = node.orders?.[0];
    if (!ord0) continue;
    
    // Na API do AfiliadoShopee, costumamos usar 'totalCommission' quando o pedido é válido.
    const tc = parseFloat(node.totalCommission || "0") || 0;
    
    // Check if order is valid for commission
    let oidCom = "";
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (isExcludedCommission(st)) continue;
      oidCom = String(ord.orderId || "").trim();
      if (oidCom) break;
    }
    if (!oidCom) oidCom = String(ord0.orderId || "").trim();
    if (!oidCom) continue;

    const baseSubIdRaw = node.utmContent || "";
    const subidNorm = normalizeSubId(baseSubIdRaw) || "missing_subid";

    // For simplicity of test, we aggregate all commissions per SubID for valid orders
    // Note: If multiple nodes have the same oidCom, we should only take the max commission. 
    // This is handled if we track by order ID first, then sum up by SubID.
  }
  return map;
}

(async () => {
  console.log(`\n=== TESTE COMPARATIVO SubID Shopee API vs Supabase ===`);
  console.log(`Período: ${startDate} → ${endDate}\n`);

  const startTs = brtDateToUnixStart(startDate);
  const endTs = brtDateToUnixEnd(endDate);

  console.log("1) Puxando conversionReport da Shopee...");
  const nodes = await pullRange(startTs, endTs);

  // Aggregation by order ID to get max commission per order, then map to subID
  const pedidos = new Map(); // oid => { subid, comissao }
  for (const node of nodes) {
    const ord0 = node.orders?.[0];
    if (!ord0) continue;
    let tc = parseFloat(node.totalCommission || "0") || 0;
    
    let oidCom = "";
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (isExcludedCommission(st)) continue;
      oidCom = String(ord.orderId || "").trim();
      if (oidCom) break;
    }
    if (!oidCom) continue;

    const baseSubIdRaw = node.utmContent || "";
    const subidNorm = normalizeSubId(baseSubIdRaw) || "(sem_subid)";

    const existing = pedidos.get(oidCom);
    if (!existing || tc > existing.comissao) {
      pedidos.set(oidCom, { subid: subidNorm, comissao: tc });
    }
  }

  const apiSubids = {};
  let totalApi = 0;
  for (const [oid, info] of pedidos.entries()) {
    if (!apiSubids[info.subid]) apiSubids[info.subid] = 0;
    apiSubids[info.subid] += info.comissao;
    totalApi += info.comissao;
  }

  console.log(`Total API Comissão: R$ ${roundMoney(totalApi).toLocaleString("pt-BR")}`);

  console.log("\n2) Puxando subid_daily do Supabase...");
  const { data: supaData, error } = await supabase
    .from("subid_daily")
    .select("subid, comissoes, comissoes_estimadas")
    .gte("data", startDate)
    .lte("data", endDate);

  if (error) {
    console.error("Erro no Supabase:", error);
    process.exit(1);
  }

  const supaSubids = {};
  let totalSupa = 0;
  for (const row of supaData || []) {
    const subid = row.subid || "(sem_subid)";
    if (!supaSubids[subid]) supaSubids[subid] = 0;
    const c1 = parseFloat(row.comissoes || "0") || 0;
    // Não somamos c2 (comissoes_estimadas) pois no Firebase ambas são populadas com a comissão total e causava duplicidade.
    supaSubids[subid] += c1;
    totalSupa += c1;
  }
  
  console.log(`Total Supabase Comissão: R$ ${roundMoney(totalSupa).toLocaleString("pt-BR")}`);

  console.log("\n3) Comparativo (Somente diferenças encontradas):");
  const allSubids = new Set([...Object.keys(apiSubids), ...Object.keys(supaSubids)]);
  let diffCount = 0;

  for (const subid of allSubids) {
    const vApi = roundMoney(apiSubids[subid] || 0);
    const vSupa = roundMoney(supaSubids[subid] || 0);
    const diff = roundMoney(vApi - vSupa);
    
    if (Math.abs(diff) > 0.01) {
      diffCount++;
      console.log(`  ❌ SubID: ${subid.padEnd(25)} | API: R$ ${vApi.toFixed(2).padStart(8)} | Supabase: R$ ${vSupa.toFixed(2).padStart(8)} | Δ: R$ ${diff.toFixed(2)}`);
    }
  }

  if (diffCount === 0) {
    console.log("  ✅ Tudo bate! Nenhuma diferença encontrada por SubID.");
  } else {
    console.log(`\nForam encontrados ${diffCount} SubIDs com diferença.`);
  }

  console.log("\n=== Fim do teste ===\n");
})();

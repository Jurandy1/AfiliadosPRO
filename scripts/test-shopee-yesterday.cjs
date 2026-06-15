#!/usr/bin/env node
"use strict";

/**
 * test-shopee-yesterday.cjs — LEITURA API Shopee, NÃO GRAVA FIRESTORE.
 *
 * Compara totais da API com o dashboard (PromosApp node_once + soma por item).
 *
 * Uso:
 *   node scripts/test-shopee-yesterday.cjs
 *   node scripts/test-shopee-yesterday.cjs 2026-06-12
 *
 * Credenciais: SHOPEE_APP_ID + SHOPEE_SECRET (ou SHOPEE_APP_SECRET) no .env
 * ou proxy VITE_AFFILIATE_GRAPHQL_URL + VITE_BACKFILL_SECRET
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ENV_PATHS = [
  path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, "..", ".env.local"),
  path.join(__dirname, ".env"),
];

const API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const PAGE_LIMIT = 500;

const DASHBOARD_ALVO = {
  "2026-06-12": {
    gmv: 31209.72,
    itens: 601,
    pedidos: 539,
    pedidosConcluidos: 7,
    pedidosPendentes: 532,
    comissaoConcluida: 34.49,
    comissaoPendente: 1945.6,
    comissaoTotal: 1980.09,
    splitItensConcl: 46.42,
    splitItensPend: 1933.66,
    gasto: 1271.54,
    lucro: 708.55,
    roiPct: 55.72,
    roas: 1.56,
  },
};

function loadEnvFiles() {
  for (const p of ENV_PATHS) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

function resolveAuth() {
  loadEnvFiles();
  const appId = (process.env.SHOPEE_APP_ID || "").trim();
  const secret = (process.env.SHOPEE_SECRET || process.env.SHOPEE_APP_SECRET || "").trim();
  if (appId && secret) {
    return { mode: "direct", appId, secret, label: "API direta" };
  }
  const proxyUrl = (process.env.VITE_AFFILIATE_GRAPHQL_URL || "").trim();
  const proxySecret = (process.env.VITE_BACKFILL_SECRET || process.env.META_SYNC_SECRET || "").trim();
  if (proxyUrl && proxySecret) {
    return { mode: "proxy", proxyUrl, proxySecret, label: `proxy ${proxyUrl}` };
  }
  return null;
}

function brtDayRange(dateStr) {
  const start = Math.floor(Date.parse(`${dateStr}T00:00:00-03:00`) / 1000);
  return [start, start + 86400 - 1];
}

function shopeeSignature(appId, timestamp, payload, secret) {
  return crypto.createHash("sha256").update(appId + timestamp + payload + secret).digest("hex");
}

async function shopeeQueryDirect(appId, secret, bodyObj) {
  const payload = JSON.stringify(bodyObj);
  const ts = Math.floor(Date.now() / 1000);
  const signature = shopeeSignature(appId, ts, payload, secret);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}`,
    },
    body: payload,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

async function shopeeQueryProxy(proxyUrl, proxySecret, bodyObj) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${proxySecret}`,
    },
    body: JSON.stringify(bodyObj),
  });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error || `Proxy HTTP ${res.status}`);
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

const CONVERSION_QUERY = `
query ConversionReport($purchaseTimeStart: Int, $purchaseTimeEnd: Int, $limit: Int, $scrollId: String) {
  conversionReport(
    purchaseTimeStart: $purchaseTimeStart
    purchaseTimeEnd: $purchaseTimeEnd
    limit: $limit
    scrollId: $scrollId
  ) {
    nodes {
      purchaseTime
      conversionId
      utmContent
      totalCommission
      netCommission
      orders {
        orderId
        orderStatus
        items {
          actualAmount
          qty
          itemTotalCommission
          completeTime
          fraudStatus
        }
      }
    }
    pageInfo {
      limit
      hasNextPage
      scrollId
    }
  }
}`;

function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const roundMoney = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

function nodeOnceCommission(node) {
  const net = num(node.netCommission);
  return net > 0 ? net : num(node.totalCommission);
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET")) return "concluida";
  if (s === "CANCELLED" || s === "CANCELED") return "cancelada";
  if (s === "UNPAID") return "unpaid";
  return "pendente";
}

function pedidosValidadosNaConversao(node) {
  const out = [];
  for (const ord of node.orders || []) {
    const st = String(ord.orderStatus || "").toUpperCase().trim();
    if (st === "UNPAID" || st === "CANCELLED" || st === "CANCELED") continue;
    const oid = String(ord.orderId || "").trim();
    if (!oid) continue;
    out.push({ ord, st });
  }
  return out;
}

function conversaoConcluidaPromosApp(node) {
  const validados = pedidosValidadosNaConversao(node);
  if (!validados.length) return false;
  return validados.every(({ ord }) => {
    const items = ord.items || [];
    return items.length > 0 && items.every((it) => num(it.completeTime) > 0);
  });
}

async function fetchAllNodes(queryFn, dateStr) {
  const [purchaseTimeStart, purchaseTimeEnd] = brtDayRange(dateStr);
  const allNodes = [];
  let scrollId;
  let page = 0;

  do {
    page += 1;
    const data = await queryFn({
      query: CONVERSION_QUERY,
      variables: {
        purchaseTimeStart,
        purchaseTimeEnd,
        limit: PAGE_LIMIT,
        scrollId: scrollId || null,
      },
    });
    const result = data.conversionReport;
    const nodes = result?.nodes ?? [];
    allNodes.push(...nodes);
    process.stderr.write(`  pagina ${page}: +${nodes.length} (total ${allNodes.length})\n`);
    scrollId = result?.pageInfo?.hasNextPage ? result.pageInfo.scrollId : undefined;
  } while (scrollId);

  return allNodes;
}

/** Agregacao do script do usuario: soma itemTotalCommission por linha. */
function aggregateItemSum(nodes) {
  const orderIds = new Set();
  const completedOrders = new Set();
  const pendingOrders = new Set();
  const cancelledOrders = new Set();
  const unpaidOrders = new Set();
  let items = 0;
  let gmv = 0;
  let commission = 0;

  for (const conversion of nodes) {
    for (const order of conversion.orders || []) {
      const st = String(order.orderStatus || "").toUpperCase().trim();
      const oid = String(order.orderId || "");
      if (oid) orderIds.add(oid);
      if (st === "COMPLETED") completedOrders.add(oid);
      else if (st === "PENDING") pendingOrders.add(oid);
      else if (st === "CANCELLED" || st === "CANCELED") cancelledOrders.add(oid);
      else if (st === "UNPAID") unpaidOrders.add(oid);

      for (const item of order.items || []) {
        items += num(item.qty);
        gmv += num(item.actualAmount);
        commission += num(item.itemTotalCommission);
      }
    }
  }

  return {
    pedidos: orderIds.size,
    pedidosConcluidos: completedOrders.size,
    pedidosPendentes: pendingOrders.size,
    pedidosCancelados: cancelledOrders.size,
    pedidosUnpaid: unpaidOrders.size,
    itens: items,
    gmv: roundMoney(gmv),
    comissao: roundMoney(commission),
  };
}

/** Agregacao PromosApp / nosso sync (node_once + split conversao). */
function aggregatePromosApp(nodes) {
  const orderIds = new Set();
  const pedidosConcluidos = new Set();
  const pedidosPendentes = new Set();
  const pedidosCancelados = new Set();
  const pedidosUnpaid = new Set();
  let itens = 0;
  let gmv = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let comissaoItensConcl = 0;
  let comissaoItensPend = 0;
  let comissaoNodeOnceTotal = 0;

  for (const node of nodes) {
    const convCommission = nodeOnceCommission(node);
    comissaoNodeOnceTotal += convCommission;
    const concluidaConv = conversaoConcluidaPromosApp(node);

    for (const order of node.orders || []) {
      const st = String(order.orderStatus || "").toUpperCase().trim();
      const cls = shopeeClassifyStatus(st);
      const oid = String(order.orderId || "");
      if (!oid) continue;

      if (cls === "unpaid") {
        pedidosUnpaid.add(oid);
        continue;
      }
      if (cls === "cancelada") {
        pedidosCancelados.add(oid);
        continue;
      }

      orderIds.add(oid);
      if (concluidaConv) pedidosConcluidos.add(oid);
      else pedidosPendentes.add(oid);

      for (const item of order.items || []) {
        itens += num(item.qty);
        gmv += num(item.actualAmount);
        const ic = num(item.itemTotalCommission);
        if (concluidaConv) comissaoItensConcl += ic;
        else comissaoItensPend += ic;
      }
    }

    if (concluidaConv) comissaoConcluida += convCommission;
    else {
      const validados = pedidosValidadosNaConversao(node);
      if (validados.length > 0) comissaoPendente += convCommission;
    }
  }

  comissaoConcluida = roundMoney(comissaoConcluida);
  comissaoPendente = roundMoney(comissaoPendente);
  const comissaoTotal = roundMoney(comissaoConcluida + comissaoPendente);

  return {
    pedidos: orderIds.size,
    pedidosConcluidos: pedidosConcluidos.size,
    pedidosPendentes: pedidosPendentes.size,
    pedidosCancelados: pedidosCancelados.size,
    pedidosUnpaid: pedidosUnpaid.size,
    itens,
    gmv: roundMoney(gmv),
    comissaoConcluida,
    comissaoPendente,
    comissaoTotal,
    comissaoItensConcl: roundMoney(comissaoItensConcl),
    comissaoItensPend: roundMoney(comissaoItensPend),
    comissaoNodeOnceTotal: roundMoney(comissaoNodeOnceTotal),
  };
}

function calcLucroRoi(comissaoTotal, gasto) {
  const g = roundMoney(gasto);
  const lucro = roundMoney(comissaoTotal - g);
  const roi = g > 0 ? lucro / g : 0;
  const roas = g > 0 ? comissaoTotal / g : 0;
  return { gasto: g, lucro, roiPct: roundMoney(roi * 100), roas: roundMoney(roas * 100) / 100 };
}

function diffLine(label, apiVal, dashVal) {
  const d = roundMoney(apiVal - dashVal);
  const ok = Math.abs(d) < 0.02;
  return { label, api: apiVal, dashboard: dashVal, delta: d, ok };
}

async function main() {
  const dateStr = process.argv[2] || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const auth = resolveAuth();
  if (!auth) {
    console.error("ERRO: defina SHOPEE_APP_ID + SHOPEE_SECRET no .env ou use o proxy GraphQL.");
    console.error(`Arquivos tentados: ${ENV_PATHS.join(", ")}`);
    process.exit(1);
  }

  console.error(`\n=== Shopee API (somente leitura) — ${dateStr} BRT ===`);
  console.error(`Auth: ${auth.label}\n`);

  const queryFn = auth.mode === "direct"
    ? (body) => shopeeQueryDirect(auth.appId, auth.secret, body)
    : (body) => shopeeQueryProxy(auth.proxyUrl, auth.proxySecret, body);

  const nodes = await fetchAllNodes(queryFn, dateStr);
  const itemSum = aggregateItemSum(nodes);
  const promos = aggregatePromosApp(nodes);
  const alvo = DASHBOARD_ALVO[dateStr];
  const fin = alvo ? calcLucroRoi(promos.comissaoTotal, alvo.gasto) : null;

  const out = {
    date: dateStr,
    nodes: nodes.length,
    auth: auth.label,
    scriptUsuario_somaPorItem: itemSum,
    sistema_promosapp_nodeOnce: promos,
    lucroRoi_seComissaoPromosApp_eGastoDashboard: fin,
    comparacaoDashboard: alvo ? {
      gmv: diffLine("GMV", promos.gmv, alvo.gmv),
      itens: diffLine("Itens", promos.itens, alvo.itens),
      pedidos: diffLine("Pedidos validados", promos.pedidos, alvo.pedidos),
      pedidosConcluidos: diffLine("Pedidos concluídos (conv.)", promos.pedidosConcluidos, alvo.pedidosConcluidos),
      pedidosPendentes: diffLine("Pedidos pendentes", promos.pedidosPendentes, alvo.pedidosPendentes),
      comissaoConcluida: diffLine("Comissão concluída", promos.comissaoConcluida, alvo.comissaoConcluida),
      comissaoPendente: diffLine("Comissão pendente", promos.comissaoPendente, alvo.comissaoPendente),
      comissaoTotal: diffLine("Comissão total", promos.comissaoTotal, alvo.comissaoTotal),
      splitItensConcl: diffLine("Itens concl.", promos.comissaoItensConcl, alvo.splitItensConcl),
      splitItensPend: diffLine("Itens pend.", promos.comissaoItensPend, alvo.splitItensPend),
      lucroCalculado: diffLine("Lucro (total−gasto)", fin.lucro, alvo.lucro),
      roiCalculado: diffLine("ROI %", fin.roiPct, alvo.roiPct),
    } : null,
    nota: itemSum.comissao !== promos.comissaoTotal
      ? "Soma por item (seu script) difere de node_once (dashboard/PromosApp) — use promosapp para lucro/ROI."
      : "Comissao item-sum = node_once neste dia.",
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/** Simula buildShopeePanelAppDayMap (functions/index.js) com dados da API. */
const path = require("path");
const { spawnSync } = require("child_process");

const dateStr = process.argv[2] || "2026-06-11";

function roundMoney(v) {
  return Math.round((Number(v) + 1e-9) * 100) / 100;
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET")) return "concluida";
  if (s === "CANCELLED" || s === "CANCELED") return "cancelada";
  if (s === "UNPAID") return "unpaid";
  return "pendente";
}

function parseItemTotalCommission(it) {
  return Number(it.itemTotalCommission || 0) || 0;
}

function somaComissaoItensOrdem(ord) {
  let s = 0;
  for (const it of ord.items || []) s += parseItemTotalCommission(it);
  return s;
}

function nodeOnceCommission(node) {
  const net = Number(node.netCommission || 0) || 0;
  if (net > 0) return net;
  return Number(node.totalCommission || 0) || 0;
}

function pedidosValidadosNaConversao(node) {
  const out = [];
  for (const ord of node.orders || []) {
    const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
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
  return validados.every(({ st }) => st === "COMPLETED");
}

function groupNodesByConversionId(nodes) {
  const map = new Map();
  for (const node of nodes) {
    const cid = String(node.conversionId || "").trim()
      || `__solo_${node.purchaseTime || 0}_${node.orders?.[0]?.orderId || "?"}`;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(node);
  }
  return map;
}

function pedidosValidadosNoGrupo(nodes) {
  const out = [];
  for (const node of nodes) {
    for (const item of pedidosValidadosNaConversao(node)) out.push(item);
  }
  return out;
}

function conversaoConcluidaGrupo(nodes) {
  const v = pedidosValidadosNoGrupo(nodes);
  return v.length > 0 && v.every(({ st }) => st === "COMPLETED");
}

function comissaoGrupo(nodes) {
  return nodes.reduce((s, n) => s + nodeOnceCommission(n), 0);
}

function buildShopeePanelAppDayMap(nodes) {
  const dayMap = {};
  function ensure(date) {
    if (!dayMap[date]) {
      dayMap[date] = {
        _pedidosSet: new Set(),
        _pedidosConcluidosSet: new Set(),
        _pedidosConcluidosConv: 0,
        _pedidosPendentesConv: 0,
        _splitPedidoNivel: { pedidos_concluidos: 0, pedidos_pendentes: 0, comissao_concluida: 0, comissao_pendente: 0 },
        _comConcItemsH2: 0,
        _comPendItemsH2: 0,
        comissao_total: 0,
      };
    }
    return dayMap[date];
  }

  const day = ensure(dateStr);
  for (const node of nodes) {
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st === "CANCELLED" || st === "CANCELED") continue;
      const pk = String(ord.orderId || "").trim();
      if (!pk) continue;
      if (st === "UNPAID") continue;
      day._pedidosSet.add(pk);
      if (shopeeClassifyStatus(st) === "concluida") day._pedidosConcluidosSet.add(pk);
    }
  }

  for (const groupNodes of groupNodesByConversionId(nodes).values()) {
    const validadosConv = pedidosValidadosNoGrupo(groupNodes);
    if (!validadosConv.length) continue;
    const tcGrupo = comissaoGrupo(groupNodes);
    day.comissao_total += tcGrupo;
    const convConcluida = conversaoConcluidaGrupo(groupNodes);
    let itemSumConv = 0;
    for (const { ord } of validadosConv) itemSumConv += somaComissaoItensOrdem(ord);
    if (convConcluida) {
      day._pedidosConcluidosConv += validadosConv.length;
      day._comConcItemsH2 += itemSumConv;
    } else {
      day._pedidosPendentesConv += validadosConv.length;
      day._comPendItemsH2 += itemSumConv;
    }
    for (const { ord, st } of validadosConv) {
      const comPed = somaComissaoItensOrdem(ord);
      if (shopeeClassifyStatus(st) === "concluida") {
        day._splitPedidoNivel.pedidos_concluidos += 1;
        day._splitPedidoNivel.comissao_concluida += comPed;
      } else {
        day._splitPedidoNivel.pedidos_pendentes += 1;
        day._splitPedidoNivel.comissao_pendente += comPed;
      }
    }
  }

  const d = dayMap[dateStr];
  d.pedidos = d._pedidosSet.size;
  d.pedidos_concluidos = d._pedidosConcluidosConv;
  d.pedidos_pendentes = d._pedidosPendentesConv;
  d.comissao_total = roundMoney(d.comissao_total);
  const bruto = d._comConcItemsH2 + d._comPendItemsH2;
  if (bruto > 0 && d.comissao_total > 0) {
    d.comissao_concluida = roundMoney(d.comissao_total * (d._comConcItemsH2 / bruto));
    d.comissao_pendente = roundMoney(d.comissao_total - d.comissao_concluida);
  }
  d.splitPedidoNivel = {
    pedidos_concluidos: d._splitPedidoNivel.pedidos_concluidos,
    pedidos_pendentes: d._splitPedidoNivel.pedidos_pendentes,
    comissao_concluida: roundMoney(d._splitPedidoNivel.comissao_concluida),
    comissao_pendente: roundMoney(d._splitPedidoNivel.comissao_pendente),
  };
  d.legacy_h1_pedidos_concluidos = d._pedidosConcluidosSet.size;
  return d;
}

// Reuse audit fetch via child process JSON export — simpler: require audit helpers
const auditPath = path.join(__dirname, "audit-promosapp-split.cjs");
const auditSrc = require("fs").readFileSync(auditPath, "utf8");

// Minimal inline fetch by eval-ing only fetch part — use dynamic import of audit as module won't work (IIFE).
// Run audit with env and parse — instead duplicate fetch from audit.

const fs = require("fs");
const crypto = require("crypto");

function loadEnv() {
  for (const p of [
    path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
    path.join(__dirname, "..", ".env"),
  ]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function fetchNodes() {
  loadEnv();
  const proxyUrl = process.env.VITE_AFFILIATE_GRAPHQL_URL;
  const secret = process.env.VITE_BACKFILL_SECRET || process.env.META_SYNC_SECRET;
  const start = Math.floor(new Date(`${dateStr}T00:00:00-03:00`).getTime() / 1000);
  const end = start + 86400 - 1;
  const all = [];
  let scrollId = "";
  for (;;) {
    const scroll = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
    const query = `{ conversionReport(limit: 500, purchaseTimeStart: ${start}, purchaseTimeEnd: ${end}${scroll}) { nodes { conversionId purchaseTime totalCommission netCommission orders { orderId orderStatus items { itemTotalCommission fraudStatus } } } pageInfo { hasNextPage scrollId } } }`;
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const conn = json.data?.conversionReport || json.conversionReport;
    all.push(...(conn.nodes || []));
    if (!conn.pageInfo?.hasNextPage) break;
    scrollId = conn.pageInfo.scrollId;
  }
  return all;
}

(async () => {
  const nodes = await fetchNodes();
  const d = buildShopeePanelAppDayMap(nodes);
  console.log(JSON.stringify(d, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

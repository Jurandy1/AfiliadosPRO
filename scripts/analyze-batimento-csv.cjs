#!/usr/bin/env node
/**
 * Analisa CSVs do painel Shopee (export cliente) vs metas/API.
 *   node scripts/analyze-batimento-csv.cjs "c:\Users\PC\Desktop\BATIMENTO DE COMPRAS\MAIO.csv"
 */
"use strict";

const fs = require("fs");
const path = require("path");

const META_MAIO = { pedidos: 11900, comissao: 35800, gmv: 701900, itens: 13600 };
const API_MAIO = { pedidos: 11820, comissao: 35444.5, gmv: 697130, itens: 13493 };

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function num(s) {
  return parseFloat(String(s || "").replace(/"/g, "").trim()) || 0;
}

function loadCsv(filePath) {
  const txt = fs.readFileSync(filePath, "utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  const hdr = parseCsvLine(lines[0]);
  const col = (part) => hdr.findIndex((h) => h.includes(part));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    rows.push({
      oid: c[col("ID do pedido")]?.trim(),
      orderSt: c[col("Status do Pedido")]?.trim(),
      orderTime: c[col("Horário do pedido")]?.trim(),
      qty: num(c[col("Qtd")]),
      gmv: num(c[col("Valor de Compra")]),
      comPedido: num(c[col("Comissão total do pedido")]),
      comLiq: num(c[col("Comissão líquida do afiliado")]),
      comItem: num(c[col("Comissão total do item")]),
      stItem: c[col("Status do item do afiliado")]?.trim(),
      sub1: c[col("Sub_id1")]?.trim(),
    });
  }
  return { hdr, rows };
}

function isCancelOrder(st) {
  return /cancelado|não pago|nao pago/i.test(st || "");
}

function isCancelItem(st) {
  return /cancelado/i.test(st || "");
}

function inMonth(orderTime, monthPrefix) {
  return String(orderTime || "").startsWith(monthPrefix);
}

function inPeriod(orderTime, period) {
  if (!period) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const d = String(orderTime || "").slice(0, 10);
    return d === period;
  }
  return inMonth(orderTime, period);
}

function aggregate(rows, opts) {
  const pedidos = new Set();
  const comPedMap = new Map();
  let gmv = 0;
  let itens = 0;
  let sumComLiq = 0;
  let sumComItem = 0;
  let linhasFiltradas = 0;

  for (const r of rows) {
    if (opts.month && !inPeriod(r.orderTime, opts.month)) continue;
    if (opts.skipCancelOrder && isCancelOrder(r.orderSt)) continue;
    if (opts.skipCancelItem && isCancelItem(r.stItem)) continue;
    if (opts.qtyPositive && r.qty <= 0) continue;

    linhasFiltradas++;
    if (r.oid) pedidos.add(r.oid);
    gmv += r.gmv;
    itens += r.qty;
    sumComLiq += r.comLiq;
    sumComItem += r.comItem;
    if (r.oid) {
      const prev = comPedMap.get(r.oid);
      comPedMap.set(r.oid, prev == null ? r.comPedido : Math.max(prev, r.comPedido));
    }
  }

  let sumComPedido = 0;
  for (const v of comPedMap.values()) sumComPedido += v;

  return {
    pedidos: pedidos.size,
    gmv: round(gmv),
    itens,
    com_pedido_unico: round(sumComPedido),
    com_liquida_linhas: round(sumComLiq),
    com_item_linhas: round(sumComItem),
    linhas_filtradas: linhasFiltradas,
    linhas_arquivo: rows.length,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function gapPct(actual, target) {
  if (!target) return "—";
  const p = round((100 * (actual - target)) / target);
  return p > 0 ? `+${p}%` : `${p}%`;
}

function printBlock(title, t, target) {
  log(`\n=== ${title} ===`);
  log(JSON.stringify(t, null, 2));
  if (target) {
    const comKey = t.com_pedido_unico != null ? "com_pedido_unico" : t.comissao != null ? "comissao" : null;
    const comVal = comKey ? t[comKey] : 0;
    log(
      `vs meta: pedidos ${gapPct(t.pedidos, target.pedidos)} | comissão ${gapPct(comVal, target.comissao)} | GMV ${gapPct(t.gmv, target.gmv)} | itens ${gapPct(t.itens, target.itens)}`,
    );
  }
}

const file = process.argv[2];
if (!file) {
  console.log("Uso: node scripts/analyze-batimento-csv.cjs <caminho.csv> [YYYY-MM ou YYYY-MM-DD]");
  process.exit(1);
}

const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
const logLines = [];
function log(...a) {
  const s = a.map((x) => (typeof x === "object" ? JSON.stringify(x, null, 2) : String(x))).join(" ");
  logLines.push(s);
  console.log(...a);
}

const { rows } = loadCsv(file);
const period = process.argv[3] || "2026-05";
const isDay = /^\d{4}-\d{2}-\d{2}$/.test(period);
const meta = isDay ? null : META_MAIO;

log(`Arquivo: ${path.basename(file)} | linhas no arquivo: ${rows.length}`);
log(`Período: ${period}${isDay ? " (dia)" : " (mês)"}`);

const ruleA = aggregate(rows, {
  month: period,
  skipCancelOrder: true,
  qtyPositive: true,
});
log("\n=== Regra A (export Shopee) ===");
log(`Comissão (1× pedido): R$ ${ruleA.com_pedido_unico}`);
log(`Pedidos únicos: ${ruleA.pedidos} | Linhas de item (filtro): ${ruleA.linhas_filtradas}`);
log(`GMV (Valor de Compra, qtd>0): R$ ${ruleA.gmv} | Itens (soma Qtd): ${ruleA.itens}`);
if (meta) {
  log(
    `vs meta mês: pedidos ${gapPct(ruleA.pedidos, meta.pedidos)} | comissão ${gapPct(ruleA.com_pedido_unico, meta.comissao)} | GMV ${gapPct(ruleA.gmv, meta.gmv)}`,
  );
}

if (isDay) {
  const semQtd = aggregate(rows, { month: period, skipCancelOrder: true, qtyPositive: false });
  log("\n=== Mesmo dia SEM exigir qtd>0 (só exclui cancelado) ===");
  log(`GMV: R$ ${semQtd.gmv} | Itens (soma Qtd): ${semQtd.itens} | Linhas: ${semQtd.linhas_filtradas}`);
}

printBlock("A) Detalhe JSON — Regra A", ruleA, meta);

if (!isDay) {
  printBlock("B) Comissão líquida (soma linhas)", aggregate(rows, {
    month: period,
    skipCancelOrder: true,
    qtyPositive: true,
  }), meta);
  printBlock("C) Comissão por item", aggregate(rows, {
    month: period,
    skipCancelOrder: true,
    skipCancelItem: true,
    qtyPositive: true,
  }), meta);
  printBlock("D) Referência API lab maio (api_faithful_v2)", API_MAIO, meta);
}

log("\n--- Recomendação ---");
log("Compare A comissão por pedido único vs API. Se B ou C bater 35800, ajustar agregação no backend.");

const outFile = path.join(outDir, `batimento-${path.basename(file, path.extname(file))}.txt`);
fs.writeFileSync(outFile, logLines.join("\n"), "utf8");
log(`\nSalvo: ${outFile}`);

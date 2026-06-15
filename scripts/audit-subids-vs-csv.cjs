#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeSubId } = require("../functions/lib/normalizeSubId");

const PROJECT = "projetoafiliado-9ff07";
const API_KEY = "AIzaSyBclouv8Hot0kKiykpGjEjMw7yKsGXQjGI";
const CSV = process.argv[2] || path.join("c:", "Users", "PC", "Desktop", "BATIMENTO DE COMPRAS", "AffiliateCommissionReport_202606112114.csv");
const START = process.argv[3] || "2026-06-01";
const END = process.argv[4] || "2026-06-10";

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

function aggregateCsv() {
  const txt = fs.readFileSync(CSV, "utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  const hdr = parseCsvLine(lines[0]);
  const col = (p) => hdr.findIndex((h) => h.includes(p));
  const bySub = {};
  const pedCom = new Map();

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const t = c[col("Horário do pedido")]?.trim() || "";
    if (t.slice(0, 10) < START || t.slice(0, 10) > END) continue;
    const st = c[col("Status do Pedido")]?.trim() || "";
    if (/cancelado|não pago|nao pago/i.test(st)) continue;
    const raw = c[col("Sub_id1")]?.trim() || "";
    const sub = normalizeSubId(raw) || "organico";
    const oid = c[col("ID do pedido")]?.trim();
    const com = num(c[col("Comissão total do pedido")]);
    const gmv = num(c[col("Valor de Compra")]);
    const qty = num(c[col("Qtd")]);
    if (!bySub[sub]) bySub[sub] = { com: 0, gmv: 0, itens: 0 };
    bySub[sub].gmv += gmv;
    bySub[sub].itens += qty;
    if (oid) {
      const k = `${sub}\t${oid}`;
      const prev = pedCom.get(k);
      pedCom.set(k, prev == null ? com : Math.max(prev, com));
    }
  }
  for (const [k, v] of pedCom) {
    const sub = k.split("\t")[0];
    bySub[sub].com = Math.round(((bySub[sub].com || 0) + v) * 100) / 100;
  }
  return bySub;
}

async function aggregateFirestore() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "subid_daily" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "data" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: START } } },
            { fieldFilter: { field: { fieldPath: "data" }, op: "LESS_THAN_OR_EQUAL", value: { stringValue: END } } },
          ],
        },
      },
    },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const rows = await res.json();
  const bySub = {};
  for (const row of rows) {
    if (!row.document) continue;
    const f = row.document.fields || {};
    const raw = f.subid?.stringValue || "";
    const sub = normalizeSubId(raw) || raw.toLowerCase() || "organico";
    const com = Number(f.comissoes?.doubleValue ?? f.comissoes?.integerValue ?? f.comissoes_estimadas?.doubleValue ?? 0);
    const gmv = Number(f.faturamento?.doubleValue ?? f.faturamento?.integerValue ?? 0);
    const itens = Number(f.qtd_itens?.integerValue ?? f.qtd_itens?.doubleValue ?? 0);
    if (!bySub[sub]) bySub[sub] = { com: 0, gmv: 0, itens: 0 };
    bySub[sub].com = Math.round((bySub[sub].com + com) * 100) / 100;
    bySub[sub].gmv = Math.round((bySub[sub].gmv + gmv) * 100) / 100;
    bySub[sub].itens += itens;
  }
  return bySub;
}

function pct(d, b) {
  if (!b) return "—";
  return `${((100 * d) / b).toFixed(1)}%`;
}

async function main() {
  const csv = aggregateCsv();
  const fsData = await aggregateFirestore();
  const allSubs = [...new Set([...Object.keys(csv), ...Object.keys(fsData)])];
  const diffs = allSubs.map((sub) => {
    const c = csv[sub]?.com || 0;
    const f = fsData[sub]?.com || 0;
    return { sub, csv: c, fs: f, delta: Math.round((f - c) * 100) / 100 };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const totCsv = Object.values(csv).reduce((a, x) => a + x.com, 0);
  const totFs = Object.values(fsData).reduce((a, x) => a + x.com, 0);
  const ok2 = diffs.filter((d) => Math.abs(d.delta) <= 2).length;
  const ok5 = diffs.filter((d) => Math.abs(d.delta) <= 5).length;

  console.log(`\nSubIDs — CSV vs subid_daily (Firestore) | ${START} → ${END}`);
  console.log(`Total CSV: R$ ${totCsv.toFixed(2)} | Firestore: R$ ${totFs.toFixed(2)} | Δ ${(totFs - totCsv).toFixed(2)} (${pct(totFs - totCsv, totCsv)})`);
  console.log(`Subs: ${allSubs.length} | |Δ|≤R$2: ${ok2}/${allSubs.length} | |Δ|≤R$5: ${ok5}/${allSubs.length}\n`);
  console.log("subid           | CSV        | Firestore  | Δ        | Δ%");
  console.log("----------------|------------|------------|----------|------");
  for (const d of diffs.slice(0, 20)) {
    console.log(
      `${d.sub.padEnd(15)} | ${d.csv.toFixed(2).padStart(10)} | ${d.fs.toFixed(2).padStart(10)} | ${(d.delta >= 0 ? "+" : "") + d.delta.toFixed(2).padStart(7)} | ${pct(d.delta, d.csv)}`,
    );
  }

  const samples = ["story", "flare01", "lgflare", "organico"];
  console.log("\nAmostra PATCH:");
  for (const s of samples) {
    const row = diffs.find((d) => d.sub === s);
    if (row) console.log(`  ${s}: CSV ${row.csv.toFixed(2)} | FS ${row.fs.toFixed(2)} | Δ ${row.delta.toFixed(2)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

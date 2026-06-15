#!/usr/bin/env node
/**
 * PATCH I Bug 5 — Etapa 0: triangulação shopee_daily × subid_daily × CSV
 *   node scripts/triangulo-bug5-etapa0.cjs [start] [end]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT = "projetoafiliado-9ff07";
const API_KEY = "AIzaSyBclouv8Hot0kKiykpGjEjMw7yKsGXQjGI";
const CSV_DEFAULT = path.join(
  "c:",
  "Users",
  "PC",
  "Desktop",
  "BATIMENTO DE COMPRAS",
  "AffiliateCommissionReport_202606112114.csv",
);

const CSV_REF = {
  "2026-06-01": 1931.76,
  "2026-06-02": 1912.0,
  "2026-06-03": 1554.65,
  "2026-06-04": 1786.28,
  "2026-06-05": 1624.53,
  "2026-06-06": 3787.15,
  "2026-06-07": 2319.97,
  "2026-06-08": 1910.03,
  "2026-06-09": 2075.24,
  "2026-06-10": 2130.27,
};

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function num(s) {
  return parseFloat(String(s || "").replace(/"/g, "").trim()) || 0;
}

function loadCsvDaily(filePath, start, end) {
  const txt = fs.readFileSync(filePath, "utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  const hdr = parseCsvLine(lines[0]);
  const col = (part) => hdr.findIndex((h) => h.includes(part));
  const comPedMap = new Map();
  const porDia = {};

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const orderTime = c[col("Horário do pedido")]?.trim() || "";
    const day = orderTime.slice(0, 10);
    if (!day || day < start || day > end) continue;
    const oid = c[col("ID do pedido")]?.trim();
    const comPedido = num(c[col("Comissão total do pedido")]);
    const orderSt = c[col("Status do Pedido")]?.trim() || "";
    if (/cancelado|não pago|nao pago/i.test(orderSt)) continue;
    if (!porDia[day]) porDia[day] = new Map();
    const m = porDia[day];
    if (oid) {
      const prev = m.get(oid);
      m.set(oid, prev == null ? comPedido : Math.max(prev, comPedido));
    }
  }

  const out = {};
  for (const [day, m] of Object.entries(porDia)) {
    let sum = 0;
    for (const v of m.values()) sum += v;
    out[day] = Math.round(sum * 100) / 100;
  }
  return out;
}

function firestoreValue(v) {
  if (v == null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  throw new Error(`tipo não suportado: ${typeof v}`);
}

function readFirestoreField(fields, name) {
  const f = fields?.[name];
  if (!f) return 0;
  if (f.doubleValue != null) return Number(f.doubleValue);
  if (f.integerValue != null) return Number(f.integerValue);
  if (f.stringValue != null) return f.stringValue;
  return 0;
}

async function getShopeeDaily(date) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)` +
    `/documents/shopee_daily/${date}?key=${API_KEY}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`shopee_daily/${date}: ${res.status} ${await res.text()}`);
  const doc = await res.json();
  const f = doc.fields || {};
  return {
    comissao_estimada: readFirestoreField(f, "comissao_estimada"),
    qtd_itens: readFirestoreField(f, "qtd_itens") || readFirestoreField(f, "vendas"),
    pedidos: readFirestoreField(f, "pedidos"),
  };
}

async function getSubidMensalBucket(start, end) {
  const mk = start.slice(0, 7);
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)` +
    `/documents/subid_mensal/${mk}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return { porDia: {}, updatedAt: null };
  const doc = await res.json();
  const subids = doc.fields?.subids?.mapValue?.fields || {};
  const porDia = {};
  for (const day of enumerateDays(start, end)) {
    let sum = 0;
    for (const [, dm] of Object.entries(subids)) {
      const cell = dm.mapValue?.fields?.[day]?.mapValue?.fields;
      if (!cell) continue;
      sum += readFirestoreField(cell, "comissoes") || readFirestoreField(cell, "comissoes_estimadas");
    }
    porDia[day] = Math.round(sum * 100) / 100;
  }
  return { porDia, updatedAt: doc.updateTime || doc.fields?.updatedAt?.timestampValue };
}

async function querySubidDaily(start, end) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)` +
    `/documents:runQuery?key=${API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "subid_daily" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "data" },
                op: "GREATER_THAN_OR_EQUAL",
                value: firestoreValue(start),
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "data" },
                op: "LESS_THAN_OR_EQUAL",
                value: firestoreValue(end),
              },
            },
          ],
        },
      },
    },
  };

  const porDia = {};
  let pageToken = null;
  let reads = 0;

  do {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pageToken ? { ...body, pageToken } : body),
    });
    if (!res.ok) throw new Error(`subid_daily query: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    for (const row of rows) {
      if (!row.document) continue;
      reads++;
      const f = row.document.fields || {};
      const data = readFirestoreField(f, "data");
      const com = readFirestoreField(f, "comissoes") || readFirestoreField(f, "comissoes_estimadas");
      porDia[data] = (porDia[data] || 0) + Number(com || 0);
    }
    pageToken = rows[rows.length - 1]?.readTime ? null : null;
    if (rows.length < 300) break;
  } while (pageToken);

  for (const k of Object.keys(porDia)) {
    porDia[k] = Math.round(porDia[k] * 100) / 100;
  }
  return { porDia, reads };
}

function enumerateDays(start, end) {
  const out = [];
  const d = new Date(`${start}T12:00:00Z`);
  const endD = new Date(`${end}T12:00:00Z`);
  while (d <= endD) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function pct(delta, base) {
  if (!base) return "—";
  const p = (100 * delta) / base;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const start = process.argv[2] || "2026-06-01";
  const end = process.argv[3] || "2026-06-10";
  const csvPath = process.argv[4] || CSV_DEFAULT;
  const days = enumerateDays(start, end);

  let csvDaily = { ...CSV_REF };
  if (fs.existsSync(csvPath)) {
    csvDaily = { ...csvDaily, ...loadCsvDaily(csvPath, start, end) };
  }

  const shopee = {};
  for (const day of days) {
    const row = await getShopeeDaily(day);
    shopee[day] = row;
  }

  const [{ porDia: subid, reads: subidReads }, { porDia: bucket, updatedAt: bucketAt }] = await Promise.all([
    querySubidDaily(start, end),
    getSubidMensalBucket(start, end),
  ]);

  const totBucketPre = days.reduce((a, d) => a + (bucket[d] || 0), 0);
  const totShopeePre = days.reduce((a, d) => a + (shopee[d]?.comissao_estimada ?? 0), 0);
  const scaleK = totShopeePre > 0 ? totShopeePre / totBucketPre : 1;

  const lines = [];
  lines.push("");
  lines.push(`PATCH I Bug 5 — Etapa 0 | ${start} → ${end} | projeto ${PROJECT}`);
  lines.push(`subid_daily docs lidos na query: ${subidReads}`);
  if (bucketAt) lines.push(`subid_mensal bucket updateTime: ${bucketAt}`);
  lines.push(`alinharDaily sim: bucket × ${scaleK.toFixed(6)} (KPI total / Σ bucket)`);
  lines.push("");
  lines.push(
    "dia       | shopee_daily | Σ subid_daily | bucket    | CSV ref   | Δ sh×CSV | Dash sim",
  );
  lines.push(
    "----------|--------------|---------------|-----------|-----------|----------|----------",
  );

  let totShopee = 0;
  let totSubid = 0;
  let totBucket = 0;
  let totDash = 0;
  let totCsv = 0;
  let shopeeVsCsvOk = 0;
  let subidVsCsvOk = 0;
  let bucketVsDailyOk = 0;

  for (const day of days) {
    const s = shopee[day]?.comissao_estimada ?? 0;
    const u = subid[day] ?? 0;
    const b = bucket[day] ?? 0;
    const dash = Math.round(b * scaleK * 100) / 100;
    const c = csvDaily[day] ?? 0;
    totShopee += s;
    totSubid += u;
    totBucket += b;
    totDash += dash;
    totCsv += c;
    const dSc = s - c;
    const dUc = u - c;
    if (Math.abs(dSc) < 2) shopeeVsCsvOk++;
    if (Math.abs(dUc) < 2) subidVsCsvOk++;
    if (Math.abs(b - u) < 2) bucketVsDailyOk++;
    lines.push(
      `${day} | ${fmt(s).padStart(12)} | ${fmt(u).padStart(13)} | ${fmt(b).padStart(9)} | ${fmt(c).padStart(9)} | ${pct(dSc, c).padStart(8)} | ${fmt(dash).padStart(8)}`,
    );
  }

  lines.push(
    "----------|--------------|---------------|-----------|-----------|----------|----------",
  );
  lines.push(
    `TOTAL     | ${fmt(totShopee).padStart(12)} | ${fmt(totSubid).padStart(13)} | ${fmt(totBucket).padStart(9)} | ${fmt(totCsv).padStart(9)} | ${pct(totShopee - totCsv, totCsv).padStart(8)} | ${fmt(totDash).padStart(8)}`,
  );
  lines.push("");
  lines.push(`Dias com |Δ shopee×CSV| < R$2: ${shopeeVsCsvOk}/${days.length}`);
  lines.push(`Dias com |Δ subid×CSV| < R$2: ${subidVsCsvOk}/${days.length}`);
  lines.push(`Dias com bucket ≈ subid_daily (±R$2): ${bucketVsDailyOk}/${days.length}`);
  lines.push("");

  if (shopeeVsCsvOk >= days.length - 2 && bucketVsDailyOk < days.length - 3) {
    lines.push(
      "→ DECISÃO: **D (novo)** — shopee_daily ≈ CSV; subid_daily ≈ CSV; subid_mensal bucket inflado (merge:true) → Dash = bucket × alinharDaily",
    );
  } else if (shopeeVsCsvOk >= days.length - 1 && subidVsCsvOk < days.length - 3) {
    lines.push("→ DECISÃO: **A** — shopee_daily ≈ CSV; subid_daily ≠ CSV");
  } else if (shopeeVsCsvOk < days.length - 3 && subidVsCsvOk < days.length - 3) {
    lines.push("→ DECISÃO: **B** — dating comum no agregador");
  } else if (bucketVsDailyOk < days.length - 3) {
    lines.push("→ DECISÃO: **C** — shopee_daily ≠ subid_daily");
  } else {
    lines.push("→ DECISÃO: ver linhas acima");
  }

  const out = lines.join("\n");
  console.log(out);

  const outFile = path.join(__dirname, "out", `triangulo-bug5-${start}_${end}.txt`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out, "utf8");
  console.log(`\nSalvo em ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

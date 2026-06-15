#!/usr/bin/env node
"use strict";

/**
 * analyze-lucro-roi-dia.cjs — DIAGNÓSTICO LOCAL, SOMENTE LEITURA (não grava no Firebase).
 *
 * Compara comissão, gasto, lucro e ROI de um dia entre as fontes do dashboard
 * e mostra onde os números divergem.
 *
 * Uso (na raiz do projeto):
 *   set GOOGLE_APPLICATION_CREDENTIALS=caminho\serviceAccount.json
 *   node scripts/analyze-lucro-roi-dia.cjs
 *   node scripts/analyze-lucro-roi-dia.cjs 2026-06-08
 *   node scripts/analyze-lucro-roi-dia.cjs 2026-06-08 --imposto-meta=5 --imposto-nf=6
 *   node scripts/analyze-lucro-roi-dia.cjs 2026-06-08 --api
 *
 * Requer firebase-admin (npm install em functions/ se ainda não tiver).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ── .env opcional ───────────────────────────────────────────────────────────
(function loadEnv() {
  for (const envPath of [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
  ]) {
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

function requireFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch {
    return require(path.join(__dirname, "../functions/node_modules/firebase-admin"));
  }
}

const admin = requireFirebaseAdmin();
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FLAGS = new Set(argv.filter((a) => a.startsWith("--")));
const DATE = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || "2026-06-08";
const FETCH_API = FLAGS.has("--api");
const impostoMeta = Number((argv.find((a) => a.startsWith("--imposto-meta=")) || "").split("=")[1] || process.env.IMPOSTO_META || 0);
const impostoNf = Number((argv.find((a) => a.startsWith("--imposto-nf=")) || "").split("=")[1] || process.env.IMPOSTO_NF || 0);

const roundMoney = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const fmt = (n) => roundMoney(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (dec) => `${(dec * 100).toFixed(2)}%`;

function calcFinanceiro(comissao, gasto, { impostoMeta: im = 0, impostoNf: inf = 0 } = {}) {
  const c = roundMoney(comissao);
  const g = roundMoney(gasto);
  const imposto = roundMoney((g * (im || 0) / 100) + (c * (inf || 0) / 100));
  const lucro = roundMoney(c - g - imposto);
  const roi = g > 0 ? lucro / g : 0;
  const roas = g > 0 ? c / g : 0;
  const lucroSemImposto = roundMoney(c - g);
  const roiSemImposto = g > 0 ? lucroSemImposto / g : 0;
  return { comissao: c, gasto: g, imposto, lucro, roi, roas, lucroSemImposto, roiSemImposto };
}

function firstNonEmptyUtm(raw) {
  if (Array.isArray(raw)) return raw.find((v) => v && String(v).trim()) || "";
  if (typeof raw === "string" && raw.includes(",")) {
    return raw.split(",").find((v) => v && v.trim()) || "";
  }
  return raw;
}

function normalizeSubId(name) {
  let raw = firstNonEmptyUtm(name);
  raw = String(raw || "").trim();
  if (!raw) return "";
  const byLabel = raw.match(/(?:sub[\s_-]*id|sid)\s*[:=-]?\s*([A-Za-z0-9_-]{2,80})/i);
  if (byLabel?.[1]) {
    return byLabel[1].replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "").trim().toLowerCase().slice(0, 50);
  }
  const cut = raw.split(/[\|\u2013\u2014\-\/\(\)\[\]:]/)[0] || raw;
  const token = (cut.trim().split(/\s+/)[0] || cut).trim();
  const cleaned = token.replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "").trim().toLowerCase();
  if (cleaned) return cleaned.slice(0, 50);
  return raw.replace(/-/g, "").trim().toLowerCase().slice(0, 50);
}

function comissaoDoDiaShopee(x) {
  return Number(x?.comissao_estimada || x?.comissao_total || x?.comissao_real || x?.comissao_concluida || 0);
}

function calcOverlapRatio(filterStart, filterEnd, itemStart, itemEnd) {
  if (!filterStart || !filterEnd || !itemStart || !itemEnd) return 0;
  const fStart = Date.parse(`${filterStart}T00:00:00`);
  const fEnd = Date.parse(`${filterEnd}T23:59:59`);
  const iStart = Date.parse(`${itemStart}T00:00:00`);
  const iEnd = Date.parse(`${itemEnd}T23:59:59`);
  if (!Number.isFinite(fStart) || !Number.isFinite(fEnd) || !Number.isFinite(iStart) || !Number.isFinite(iEnd)) return 0;
  if (fEnd < iStart || fStart > iEnd) return 0;
  const overlapMs = Math.min(fEnd, iEnd) - Math.max(fStart, iStart);
  const itemTotalMs = iEnd - iStart;
  if (itemTotalMs <= 0) return 0;
  return Math.max(0, Math.min(1, overlapMs / itemTotalMs));
}

function line(title) {
  console.log(`\n${"═".repeat(72)}\n  ${title}\n${"═".repeat(72)}`);
}

function sub(title, obj) {
  console.log(`\n── ${title} ──`);
  if (obj == null) {
    console.log("  (sem dados)");
    return;
  }
  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      console.log(`  ${k.padEnd(28)} ${typeof v === "number" && String(k).match(/comiss|gasto|lucro|imposto|fat|gmv/i) ? fmt(v) : v}`);
    }
    return;
  }
  console.log(obj);
}

// ── Firestore reads ─────────────────────────────────────────────────────────
async function readShopeeDaily(date) {
  const snap = await db.collection("shopee_daily").doc(date).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function readSubidDaily(date) {
  const snap = await db.collection("subid_daily").where("data", "==", date).get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  return rows;
}

async function readMetaAdsDaily(date) {
  const snap = await db.collection("meta_ads_daily").where("data", "==", date).get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  return rows;
}

async function readPainelDia(date) {
  const mk = date.slice(0, 7);
  const snap = await db.collection("painel_resumo").doc(mk).get();
  if (!snap.exists) return null;
  return snap.data()?.dias?.[date] || null;
}

async function readSubidMensalDia(date) {
  const mk = date.slice(0, 7);
  const snap = await db.collection("subid_mensal").doc(mk).get();
  if (!snap.exists) return [];
  const subids = snap.data()?.subids || {};
  const out = [];
  for (const [rawSid, daysMap] of Object.entries(subids)) {
    const cell = daysMap?.[date];
    if (!cell) continue;
    out.push({ subid: normalizeSubId(rawSid) || rawSid, rawSid, ...cell });
  }
  return out;
}

async function readLatestImportIds() {
  const snap = await db.collection("sync_state").doc("importacoes_latest").get();
  if (snap.exists) return snap.data() || {};
  return {};
}

async function readPinterestForDay(date, importId) {
  if (!importId) return { total: 0, bySub: {}, rows: 0 };
  const snap = await db.collection("pinterest_ads").where("importacaoId", "==", importId).get();
  const bySub = {};
  let total = 0;
  snap.forEach((d) => {
    const p = d.data() || {};
    const key = normalizeSubId(p.subid || p.adName || "");
    const itemStart = p.dataInicio || p.date || null;
    const itemEnd = p.dataFim || p.date || itemStart;
    const ratio = calcOverlapRatio(date, date, itemStart, itemEnd);
    if (ratio <= 0) return;
    const spend = (Number(p.spend || 0)) * ratio;
    total += spend;
    if (key) {
      if (!bySub[key]) bySub[key] = 0;
      bySub[key] += spend;
    }
  });
  return { total: roundMoney(total), bySub, rows: snap.size };
}

function aggregateSubidDaily(rows) {
  let comissao = 0;
  let comissaoEst = 0;
  let fat = 0;
  let itens = 0;
  const bySub = {};
  for (const r of rows) {
    const sid = String(r.subid || "").trim() || "ORGANICO";
    const c = Number(r.comissoes_estimadas || r.comissoes || 0);
    comissao += Number(r.comissoes || 0);
    comissaoEst += c;
    fat += Number(r.faturamento || 0);
    itens += Number(r.qtd_itens || 0);
    if (!bySub[sid]) bySub[sid] = { comissao: 0, fat: 0 };
    bySub[sid].comissao += c;
    bySub[sid].fat += Number(r.faturamento || 0);
  }
  return {
    comissao: roundMoney(comissaoEst || comissao),
    comissao_raw: roundMoney(comissao),
    faturamento: roundMoney(fat),
    itens,
    qtd_subids: Object.keys(bySub).length,
    bySub,
  };
}

function aggregateMetaDaily(rows) {
  let total = 0;
  let comSubid = 0;
  let semSubid = 0;
  const bySub = {};
  const semSubidLinhas = [];
  for (const m of rows) {
    const gasto = Number(m.valorUsado || 0);
    total += gasto;
    const sid = normalizeSubId(m.subid || m.nomeAnuncio || "");
    if (sid) {
      comSubid += gasto;
      if (!bySub[sid]) bySub[sid] = 0;
      bySub[sid] += gasto;
    } else {
      semSubid += gasto;
      semSubidLinhas.push({ nome: m.nomeAnuncio || m.subid || m.id, gasto });
    }
  }
  return {
    total: roundMoney(total),
    com_subid: roundMoney(comSubid),
    sem_subid: roundMoney(semSubid),
    bySub,
    semSubidLinhas,
    linhas: rows.length,
  };
}

function buildSubidFinanceTable(subidRows, metaBySub, pinBySub, settings) {
  const map = {};
  const touch = (sid) => {
    if (!map[sid]) {
      map[sid] = { subid: sid, comissao: 0, meta_gasto: 0, pin_gasto: 0, gasto: 0 };
    }
    return map[sid];
  };

  for (const r of subidRows) {
    const sid = r.subid || "ORGANICO";
    touch(sid).comissao += Number(r.comissoes_estimadas || r.comissoes || 0);
  }
  for (const [sid, g] of Object.entries(metaBySub)) {
    touch(sid).meta_gasto = roundMoney((touch(sid).meta_gasto || 0) + g);
    touch(sid).gasto = roundMoney(touch(sid).gasto + g);
  }
  for (const [sid, g] of Object.entries(pinBySub)) {
    touch(sid).pin_gasto = roundMoney((touch(sid).pin_gasto || 0) + g);
    touch(sid).gasto = roundMoney(touch(sid).gasto + g);
  }

  const rows = Object.values(map).map((r) => {
    const fin = calcFinanceiro(r.comissao, r.gasto, settings);
    return { ...r, ...fin };
  }).sort((a, b) => b.comissao - a.comissao);

  const tot = rows.reduce((acc, r) => {
    acc.comissao += r.comissao;
    acc.gasto += r.gasto;
    acc.meta_gasto += r.meta_gasto;
    acc.pin_gasto += r.pin_gasto;
    acc.lucro += r.lucro;
    return acc;
  }, { comissao: 0, gasto: 0, meta_gasto: 0, pin_gasto: 0, lucro: 0 });

  for (const k of Object.keys(tot)) tot[k] = roundMoney(tot[k]);
  tot.roi = tot.gasto > 0 ? tot.lucro / tot.gasto : 0;
  return { rows, tot };
}

// ── Shopee API opcional (mesmo dia) — alinhado a test-shopee-mes.cjs / functions ─
const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_PAGE_LIMIT = 500;
const SHOPEE_PAGE_DELAY_MS = 400;

function shopeeSignature(appId, ts, payload, secret) {
  return crypto.createHash("sha256").update(appId + ts + payload + secret).digest("hex");
}

function buildShopeeConversionQuery(startTs, endTs, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  return `{
    conversionReport(
      limit: ${SHOPEE_PAGE_LIMIT},
      purchaseTimeStart: ${startTs},
      purchaseTimeEnd: ${endTs}${scrollClause}
    ) {
      nodes {
        conversionId purchaseTime
        totalCommission netCommission
        orders {
          orderId orderStatus
          items {
            qty itemPrice actualAmount
            itemTotalCommission itemCommission attributionType
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

async function shopeeFetchGraphql(APP_ID, SECRET, query) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });
  const res = await fetch(SHOPEE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${ts}, Signature=${shopeeSignature(APP_ID, ts, payload, SECRET)}`,
    },
    body: payload,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error("Resposta inválida da Shopee: " + text.slice(0, 200));
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; "));
  }
  return json.data;
}

async function pullShopeeConversionDay(date, APP_ID, SECRET) {
  // Mesmo fuso do backend (BRT = UTC-3)
  const startTs = Math.floor(Date.parse(`${date}T00:00:00-03:00`) / 1000);
  const endTs = Math.floor(Date.parse(`${date}T23:59:59-03:00`) / 1000);
  const nodes = [];
  const seen = new Set();
  let scrollId = null;
  let hasNext = true;
  let pages = 0;

  while (hasNext && pages < 50) {
    pages += 1;
    const data = await shopeeFetchGraphql(APP_ID, SECRET, buildShopeeConversionQuery(startTs, endTs, scrollId));
    const report = data?.conversionReport || {};
    const list = report.nodes || [];
    for (const n of list) {
      const cid = String(n?.conversionId || "").trim();
      const oid = String(n?.orders?.[0]?.orderId || "").trim();
      const key = (cid && oid) ? `${cid}__${oid}` : (cid || `__${n?.purchaseTime || ""}_${oid}`);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      nodes.push(n);
    }
    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    scrollId = pi.scrollId || null;
    if (hasNext && !scrollId) break;
    if (hasNext) await new Promise((r) => setTimeout(r, SHOPEE_PAGE_DELAY_MS));
  }

  return { nodes, startTs, endTs, pages };
}

function sumShopeeCommissions(nodes) {
  let comTotal = 0;
  let comNet = 0;
  let comItems = 0;
  const pedidos = new Set();
  for (const n of nodes) {
    comTotal += parseFloat(n.totalCommission || "0") || 0;
    comNet += parseFloat(n.netCommission || "0") || 0;
    for (const o of n.orders || []) {
      if (o.orderId) pedidos.add(String(o.orderId));
      for (const it of o.items || []) {
        comItems += parseFloat(it.itemTotalCommission || it.itemCommission || "0") || 0;
      }
    }
  }
  return {
    pedidos: pedidos.size,
    comissao_totalCommission: roundMoney(comTotal),
    comissao_netCommission: roundMoney(comNet),
    comissao_soma_itens: roundMoney(comItems),
  };
}

async function fetchShopeeApiDay(date) {
  const APP_ID = (process.env.SHOPEE_APP_ID || "").trim();
  const SECRET = (process.env.SHOPEE_SECRET || "").trim();
  if (!APP_ID || !SECRET) return null;

  const { nodes, startTs, endTs, pages } = await pullShopeeConversionDay(date, APP_ID, SECRET);
  const sums = sumShopeeCommissions(nodes);
  return {
    ...sums,
    nodes: nodes.length,
    paginas: pages,
    purchaseTimeStart_unix: startTs,
    purchaseTimeEnd_unix: endTs,
    fuso: "BRT (UTC-3) — igual ao backend",
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🔍 Análise lucro / ROI — SOMENTE LEITURA — data:", DATE);
  console.log("   Impostos simulados: Meta", impostoMeta + "%, NF", impostoNf + "%");
  console.log("   (ajuste com --imposto-meta=N --imposto-nf=N se usar Configurações)\n");

  const settings = { impostoMeta, impostoNf };

  const [shopee, subidDaily, metaDaily, painelDia, subidMensal, importIds, pinData] = await Promise.all([
    readShopeeDaily(DATE),
    readSubidDaily(DATE),
    readMetaAdsDaily(DATE),
    readPainelDia(DATE),
    readSubidMensalDia(DATE),
    readLatestImportIds(),
    readLatestImportIds().then((ids) => readPinterestForDay(DATE, ids.pinterest)),
  ]);

  line("1) COMISSÃO — fontes");
  if (shopee) {
    sub("shopee_daily/" + DATE, {
      comissao_estimada: shopee.comissao_estimada,
      comissao_total: shopee.comissao_total,
      comissao_real: shopee.comissao_real,
      comissao_concluida: shopee.comissao_concluida,
      comissao_pendente: shopee.comissao_pendente,
      "→ comissaoDoDiaShopee()": comissaoDoDiaShopee(shopee),
      pedidos: shopee.pedidos,
      vendas: shopee.vendas,
      faturamento: shopee.faturamento ?? shopee.gmv_total,
    });
  } else {
    sub("shopee_daily/" + DATE, null);
  }

  const aggSub = aggregateSubidDaily(subidDaily);
  sub("subid_daily (soma do dia)", {
    docs: subidDaily.length,
    comissao_estimada_soma: aggSub.comissao,
    faturamento: aggSub.faturamento,
    itens: aggSub.itens,
    subids_distintos: aggSub.qtd_subids,
  });

  if (painelDia) {
    sub("painel_resumo (bucket mensal)", {
      comissao_estimada: painelDia.comissao_estimada,
      comissao_real: painelDia.comissao_real,
      pedidos: painelDia.pedidos,
      vendas: painelDia.vendas,
      faturamento: painelDia.faturamento,
      gasto_meta: painelDia.gasto_meta,
      gasto_pin: painelDia.gasto_pin,
    });
  } else {
    sub("painel_resumo (bucket mensal)", null);
  }

  const comissaoKpi = shopee ? comissaoDoDiaShopee(shopee) : aggSub.comissao;
  const comissaoPainel = painelDia ? Number(painelDia.comissao_estimada || 0) : null;

  if (comissaoPainel != null && Math.abs(comissaoKpi - comissaoPainel) >= 0.01) {
    console.log(`\n  ⚠️  Delta comissão shopee_daily vs painel_resumo: ${fmt(comissaoKpi - comissaoPainel)}`);
  }
  if (Math.abs(aggSub.comissao - comissaoKpi) >= 0.01) {
    console.log(`  ⚠️  Delta comissão subid_daily vs shopee_daily: ${fmt(aggSub.comissao - comissaoKpi)}`);
  }

  line("2) GASTO — fontes");
  const metaAgg = aggregateMetaDaily(metaDaily);
  sub("meta_ads_daily (conta do dia)", {
    linhas: metaAgg.linhas,
    gasto_total: metaAgg.total,
    gasto_com_subid: metaAgg.com_subid,
    gasto_sem_subid: metaAgg.sem_subid,
  });

  if (metaAgg.semSubidLinhas.length) {
    console.log("\n  Anúncios Meta SEM SubID reconhecível:");
    for (const x of metaAgg.semSubidLinhas.slice(0, 15)) {
      console.log(`    - ${fmt(x.gasto).padStart(12)}  ${x.nome}`);
    }
    if (metaAgg.semSubidLinhas.length > 15) {
      console.log(`    ... +${metaAgg.semSubidLinhas.length - 15} linhas`);
    }
  }

  sub("Pinterest (proporcional ao dia, import " + (importIds.pinterest || "—") + ")", {
    docs_import: pinData.rows,
    gasto_pin_dia: pinData.total,
    subids_com_pin: Object.keys(pinData.bySub).length,
  });

  const gastoMeta = metaAgg.total;
  const gastoPin = pinData.total;
  const gastoTotalKpi = roundMoney(gastoMeta + gastoPin);
  const gastoPainel = painelDia ? roundMoney(Number(painelDia.gasto_meta || 0) + Number(painelDia.gasto_pin || 0)) : null;

  sub("Totais de gasto usados no KPI", {
    gasto_meta: gastoMeta,
    gasto_pin: gastoPin,
    gasto_total: gastoTotalKpi,
    painel_gasto_meta_mais_pin: gastoPainel ?? "(n/a)",
  });

  if (gastoPainel != null && Math.abs(gastoTotalKpi - gastoPainel) >= 0.01) {
    console.log(`\n  ⚠️  Delta gasto KPI (meta_daily+pin) vs painel_resumo: ${fmt(gastoTotalKpi - gastoPainel)}`);
  }

  line("3) LUCRO e ROI — fórmulas");
  const finDashboard = calcFinanceiro(comissaoKpi, gastoTotalKpi, settings);
  const finSemImposto = calcFinanceiro(comissaoKpi, gastoTotalKpi, { impostoMeta: 0, impostoNf: 0 });

  sub("Como o DASHBOARD calcula (com impostos das Configurações)", {
    comissao: finDashboard.comissao,
    gasto: finDashboard.gasto,
    imposto: finDashboard.imposto,
    lucro: finDashboard.lucro,
    roi: fmtPct(finDashboard.roi),
    roas: finDashboard.roas.toFixed(2) + "x",
    "checagem ROI×gasto": fmt(finDashboard.roi * finDashboard.gasto),
  });

  sub("Conta manual ERRADA (comissão − gasto, SEM imposto)", {
    lucro: finSemImposto.lucroSemImposto,
    roi: fmtPct(finSemImposto.roiSemImposto),
    delta_vs_dashboard: fmt(finSemImposto.lucroSemImposto - finDashboard.lucro),
  });

  if (finDashboard.imposto > 0) {
    console.log("\n  💡 Se o cliente faz 'comissão − gasto' na calculadora, vai divergir do card Lucro.");
    console.log(`     Imposto do dia: ${fmt(finDashboard.imposto)}`);
  }

  line("4) SubIDs — soma das linhas vs KPI");
  const bucketRows = subidMensal.map((r) => ({
    subid: r.subid,
    comissao: Number(r.comissoes_estimadas || r.comissoes || 0),
    meta_gasto: Number(r.gasto_meta || 0),
  }));
  const { rows: subFinRows, tot: subFinTot } = buildSubidFinanceTable(
    bucketRows.length ? bucketRows : Object.entries(aggSub.bySub).map(([subid, v]) => ({ subid, comissao: v.comissao })),
    metaAgg.bySub,
    pinData.bySub,
    settings,
  );

  const gastoNasLinhas = roundMoney(subFinTot.meta_gasto + subFinTot.pin_gasto);
  const metaGap = roundMoney(gastoMeta - subFinTot.meta_gasto);
  const pinGap = roundMoney(gastoPin - subFinTot.pin_gasto);

  sub("Soma SubID (comissão + meta + pin por linha)", {
    comissao_linhas: subFinTot.comissao,
    gasto_linhas: subFinTot.gasto,
    lucro_linhas: subFinTot.lucro,
    roi_linhas: fmtPct(subFinTot.roi),
    meta_gap_nao_nas_linhas: metaGap,
    pin_gap_nao_nas_linhas: pinGap,
  });

  sub("KPI do topo (referência)", {
    comissao: finDashboard.comissao,
    gasto: finDashboard.gasto,
    lucro: finDashboard.lucro,
    roi: fmtPct(finDashboard.roi),
  });

  const dCom = roundMoney(finDashboard.comissao - subFinTot.comissao);
  const dGas = roundMoney(finDashboard.gasto - subFinTot.gasto);
  const dLuc = roundMoney(finDashboard.lucro - subFinTot.lucro);

  console.log("\n  Diferenças KPI − soma linhas:");
  console.log(`    Comissão: ${fmt(dCom)}`);
  console.log(`    Gasto:    ${fmt(dGas)}  ${metaGap > 0 ? `(Meta sem SubID ~${fmt(metaGap)})` : ""}`);
  console.log(`    Lucro:    ${fmt(dLuc)}`);

  if (Math.abs(metaGap) >= 0.01 || Math.abs(pinGap) >= 0.01) {
    console.log("\n  💡 Gasto na conta (Meta/Pin) maior que o atribuído aos SubIDs → lucro do KPI fica menor.");
  }

  console.log("\n  Top SubIDs do dia (comissão / gasto / lucro / ROI):");
  for (const r of subFinRows.filter((x) => x.comissao > 0 || x.gasto > 0).slice(0, 20)) {
    console.log(
      `    ${String(r.subid).padEnd(22)}  com ${fmt(r.comissao).padStart(11)}  gas ${fmt(r.gasto).padStart(11)}  luc ${fmt(r.lucro).padStart(11)}  ROI ${fmtPct(r.roi).padStart(8)}`,
    );
  }

  if (FETCH_API) {
    line("5) API Shopee ao vivo (opcional)");
    try {
      const api = await fetchShopeeApiDay(DATE);
      if (!api) {
        console.log("  Defina SHOPEE_APP_ID e SHOPEE_SECRET no .env para usar --api");
      } else {
        sub("conversionReport API (ao vivo)", api);
        console.log("\n  Campos de comissão na API:");
        console.log(`    totalCommission (bruta, usada no dashboard): ${fmt(api.comissao_totalCommission)}`);
        console.log(`    netCommission (após taxa MCN, se houver):    ${fmt(api.comissao_netCommission)}`);
        console.log(`    soma itemTotalCommission (auditoria):        ${fmt(api.comissao_soma_itens)}`);
        const dApi = roundMoney(api.comissao_totalCommission - comissaoKpi);
        if (Math.abs(dApi) >= 0.01) {
          console.log(`\n  ⚠️  Delta API totalCommission vs shopee_daily: ${fmt(dApi)}`);
        }
        if (Math.abs(api.comissao_netCommission - api.comissao_totalCommission) >= 0.01) {
          console.log("  💡 netCommission ≠ totalCommission → conta tem MCN; dashboard usa totalCommission.");
        }
      }
    } catch (err) {
      console.error("  Erro API:", err.message);
    }
  } else {
    console.log("\n  (Use --api para comparar com conversionReport Shopee ao vivo)");
  }

  line("RESUMO");
  console.log(`
  Data analisada:     ${DATE}
  Comissão (KPI):     ${fmt(finDashboard.comissao)}
  Gasto total:        ${fmt(finDashboard.gasto)}  (Meta ${fmt(gastoMeta)} + Pin ${fmt(gastoPin)})
  Lucro dashboard:    ${fmt(finDashboard.lucro)}
  ROI dashboard:      ${fmtPct(finDashboard.roi)}
  Comissão − gasto:   ${fmt(finSemImposto.lucroSemImposto)}  ${finDashboard.imposto > 0 ? "← sem impostos" : ""}

  Nenhum dado foi gravado no Firebase.
`);
}

main().catch((err) => {
  console.error("\nERRO:", err.message || err);
  if (/credential|permission|GOOGLE_APPLICATION/i.test(String(err.message))) {
    console.error("\nConfigure: set GOOGLE_APPLICATION_CREDENTIALS=caminho\\serviceAccount.json");
  }
  process.exit(1);
});

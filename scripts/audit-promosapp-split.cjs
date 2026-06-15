#!/usr/bin/env node
/**
 * audit-promosapp-split.cjs
 *
 * Descobre qual regra de classificacao pendente/concluido o PromosApp usa vs nosso dashboard
 * (buildShopeePanelAppDayMap / shopeeClassifyStatus por orderStatus).
 *
 * Uso:
 *   node scripts/audit-promosapp-split.cjs 2026-06-11
 *   node scripts/audit-promosapp-split.cjs 2026-06-11 --csv ./AffiliateCommissionReport.csv
 *   node scripts/audit-promosapp-split.cjs 2026-06-11 --target-pend 597 --target-concl 11 --target-pend-com 1821.53
 *
 * Credenciais (ordem de prioridade):
 *   1) SHOPEE_APP_ID + SHOPEE_SECRET (env ou .env na raiz)
 *   2) Proxy Cloud Function shopeeAffiliateGraphql via VITE_AFFILIATE_GRAPHQL_URL
 *      + VITE_BACKFILL_SECRET (ou META_SYNC_SECRET) — ja no .env do projeto
 *
 * Script 100% leitura — nao grava Firestore nem altera functions/index.js.
 * Node 18+ (fetch nativo).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENV_PATHS = [
  path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, ".env"),
];
const API_URL = "https://open-api.affiliate.shopee.com.br/graphql";
const PAGE_LIMIT = 500;

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

function resolveAuth(cli = {}) {
  loadEnvFiles();
  const appId = (cli.appId || process.env.SHOPEE_APP_ID || "").trim();
  const secret = (cli.secret || process.env.SHOPEE_SECRET || "").trim();
  if (appId && secret) {
    return { mode: "direct", appId, secret, label: "API Shopee direta (SHOPEE_APP_ID)" };
  }

  const proxyUrl = (
    cli.proxyUrl
    || process.env.SHOPEE_PROXY_URL
    || process.env.VITE_AFFILIATE_GRAPHQL_URL
    || ""
  ).trim();
  const proxySecret = (
    cli.proxySecret
    || process.env.META_SYNC_SECRET
    || process.env.VITE_BACKFILL_SECRET
    || ""
  ).trim();

  if (proxyUrl && proxySecret) {
    return { mode: "proxy", proxyUrl, proxySecret, label: `proxy ${proxyUrl}` };
  }

  return null;
}

function printAuthHelp() {
  console.error("SHOPEE_APP_ID/SHOPEE_SECRET nao encontrados localmente.");
  console.error("");
  console.error("Opcao A — adicione no .env da raiz (mesmos secrets do Firebase):");
  console.error("  SHOPEE_APP_ID=...");
  console.error("  SHOPEE_SECRET=...");
  console.error("");
  console.error("Opcao B — use o proxy ja configurado no projeto (recomendado):");
  console.error("  VITE_AFFILIATE_GRAPHQL_URL=https://.../shopeeAffiliateGraphql");
  console.error("  VITE_BACKFILL_SECRET=...  (mesmo valor de META_SYNC_SECRET)");
  console.error("");
  console.error("Opcao C — PowerShell nesta sessao:");
  console.error('  $env:SHOPEE_APP_ID="..."; $env:SHOPEE_SECRET="..."; node scripts/audit-promosapp-split.cjs ...');
  console.error("");
  console.error(`Arquivos lidos: ${ENV_PATHS.join(", ")}`);
}

function brtDayRange(dateStr) {
  const start = Math.floor(new Date(`${dateStr}T00:00:00-03:00`).getTime() / 1000);
  return [start, start + 86400 - 1];
}

/** Mesma assinatura de functions/index.js (shopeeSignature). */
function shopeeSignature(appId, timestamp, payload, secret) {
  return crypto.createHash("sha256").update(appId + timestamp + payload + secret).digest("hex");
}

async function shopeeQueryDirect(appId, secret, payloadObj) {
  const payload = JSON.stringify(payloadObj);
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
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Resposta invalida: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    const messages = json.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; ");
    throw new Error(`API Shopee: ${messages}`);
  }
  return json.data;
}

async function shopeeQueryProxy(proxyUrl, proxySecret, payloadObj) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${proxySecret}`,
    },
    body: JSON.stringify(payloadObj),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Proxy invalido (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Proxy HTTP ${res.status}`);
  }
  if (json.errors?.length) {
    const messages = json.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; ");
    throw new Error(`API Shopee via proxy: ${messages}`);
  }
  return json.data;
}

function makeShopeeClient(auth) {
  if (auth.mode === "direct") {
    return (payloadObj) => shopeeQueryDirect(auth.appId, auth.secret, payloadObj);
  }
  return (payloadObj) => shopeeQueryProxy(auth.proxyUrl, auth.proxySecret, payloadObj);
}

function buildConversionQuery(start, end, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  return `{ conversionReport(limit: ${PAGE_LIMIT}, purchaseTimeStart: ${start}, purchaseTimeEnd: ${end}${scrollClause}) {
    nodes {
      conversionId purchaseTime utmContent totalCommission netCommission
      orders {
        orderId orderStatus
        items {
          itemId itemName qty actualAmount itemTotalCommission
          completeTime fraudStatus displayItemStatus itemNotes
        }
      }
    }
    pageInfo { hasNextPage scrollId }
  } }`;
}

async function fetchAllConversions(queryFn, dateStr) {
  const [start, end] = brtDayRange(dateStr);
  const all = [];
  let scrollId = "";
  let page = 0;
  for (;;) {
    page += 1;
    const data = await queryFn({ query: buildConversionQuery(start, end, scrollId || null) });
    const conn = data.conversionReport;
    all.push(...(conn.nodes || []));
    process.stderr.write(`pagina ${page}: +${conn.nodes?.length || 0} (total ${all.length})\n`);
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.scrollId) break;
    scrollId = conn.pageInfo.scrollId;
  }
  return all;
}

function num(v) { return Number(v || 0) || 0; }
const r2 = (v) => Math.round(v * 100) / 100;

function nodeOnceCommission(conv) {
  const net = num(conv.netCommission);
  return net > 0 ? net : num(conv.totalCommission);
}

function flattenOrders(conversions) {
  const orders = [];
  for (const c of conversions) {
    const convCommission = nodeOnceCommission(c);
    for (const o of c.orders || []) {
      const items = o.items || [];
      orders.push({
        conversionId: String(c.conversionId),
        orderId: String(o.orderId),
        subid: c.utmContent || "",
        orderStatus: String(o.orderStatus || "").toUpperCase().trim(),
        convCommission,
        orderCommission: r2(items.reduce((s, i) => s + num(i.itemTotalCommission), 0)),
        allItemsComplete: items.length > 0 && items.every((i) => num(i.completeTime) > 0),
        anyFraud: items.some((i) => (i.fraudStatus || "").toUpperCase() === "FRAUD"),
        allVerified: items.length > 0 && items.every((i) => (i.fraudStatus || "").toUpperCase() === "VERIFIED"),
        displayStatuses: [...new Set(items.map((i) => i.displayItemStatus).filter(Boolean))],
      });
    }
  }
  return orders;
}

function buildConvAllCompleted(validated) {
  const byConv = new Map();
  for (const o of validated) {
    if (!byConv.has(o.conversionId)) byConv.set(o.conversionId, []);
    byConv.get(o.conversionId).push(o);
  }
  const convAllCompleted = new Map();
  for (const [cid, list] of byConv) {
    convAllCompleted.set(cid, list.every((o) => o.orderStatus === "COMPLETED"));
  }
  return convAllCompleted;
}

function classify(orders) {
  const validated = orders.filter(
    (o) => o.orderStatus !== "UNPAID" && o.orderStatus !== "CANCELLED" && o.orderStatus !== "CANCELED",
  );

  const convAllCompleted = buildConvAllCompleted(validated);

  const hyps = {
    "H2_conversaoInteira (PADRAO DASHBOARD)": (o) => convAllCompleted.get(o.conversionId) === true,
    "H1_orderStatus (detalhe por pedido)": (o) => o.orderStatus === "COMPLETED",
    H3_completeTimeItens: (o) => o.allItemsComplete,
    H4_completedEVerified: (o) => o.orderStatus === "COMPLETED" && o.allVerified,
  };

  const results = {};
  for (const [name, fn] of Object.entries(hyps)) {
    let concl = 0;
    let pend = 0;
    let comConcl = 0;
    let comPend = 0;
    const conclIds = [];
    const pendIds = [];
    for (const o of validated) {
      if (fn(o)) {
        concl += 1;
        comConcl += o.orderCommission;
        conclIds.push(o.orderId);
      } else {
        pend += 1;
        comPend += o.orderCommission;
        pendIds.push(o.orderId);
      }
    }
    results[name] = {
      concl,
      pend,
      comConcl: r2(comConcl),
      comPend: r2(comPend),
      conclIds,
      pendIds,
    };
  }
  return { validated, results };
}

function detectSep(firstLine) {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function parseCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(p) {
  const text = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = detectSep(lines[0]);
  const header = parseCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const idx = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iOrder = idx("id do pedido", "order id", "orderid");
  const iStatus = idx("status do pedido", "order status");
  if (iOrder < 0) {
    throw new Error("CSV sem coluna de pedido (ID do pedido / Order ID)");
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line, sep);
    if (!c[iOrder]) continue;
    rows.push({ orderId: String(c[iOrder]), status: (c[iStatus] || "").toUpperCase() });
  }
  return rows;
}

function scoreTargets(r, targets) {
  let score = Math.abs(r.pend - targets.pend) + Math.abs(r.concl - targets.concl);
  if (targets.pendCom > 0) score += Math.abs(r.comPend - targets.pendCom) / 10;
  return score;
}

(async () => {
  const args = process.argv.slice(2);
  const dateStr = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!dateStr) {
    console.error("Uso: node scripts/audit-promosapp-split.cjs YYYY-MM-DD [--csv arquivo] [--target-pend N --target-concl N --target-pend-com X]");
    process.exit(1);
  }
  const getOpt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const csvPath = getOpt("--csv");
  const targets = {
    pend: Number(getOpt("--target-pend") || 0),
    concl: Number(getOpt("--target-concl") || 0),
    pendCom: Number(getOpt("--target-pend-com") || 0),
  };
  const cliAuth = {
    appId: getOpt("--app-id"),
    secret: getOpt("--secret"),
    proxyUrl: getOpt("--proxy-url"),
    proxySecret: getOpt("--proxy-secret"),
  };

  const auth = resolveAuth(cliAuth);
  if (!auth) {
    printAuthHelp();
    process.exit(1);
  }

  console.log(`\n=== Auditoria split ${dateStr} (snapshot API: ${new Date().toLocaleString("pt-BR")}) ===`);
  console.log(`Auth: ${auth.label}\n`);
  const queryFn = makeShopeeClient(auth);
  const conversions = await fetchAllConversions(queryFn, dateStr);
  const orders = flattenOrders(conversions);
  const { validated, results } = classify(orders);
  const convAllCompleted = buildConvAllCompleted(validated);

  const convSeen = new Set();
  let totalNodeOnce = 0;
  for (const c of conversions) {
    const allUnpaid = (c.orders || []).every((o) => String(o.orderStatus || "").toUpperCase() === "UNPAID");
    const allCancelled = (c.orders || []).every((o) => {
      const st = String(o.orderStatus || "").toUpperCase();
      return st === "CANCELLED" || st === "CANCELED";
    });
    if (allUnpaid || allCancelled) continue;
    if (convSeen.has(String(c.conversionId))) continue;
    convSeen.add(String(c.conversionId));
    totalNodeOnce += nodeOnceCommission(c);
  }

  console.log(`Conversoes: ${conversions.length} | Pedidos: ${orders.length} | Validados (nao UNPAID/CANCELLED): ${validated.length}`);
  console.log(`Comissao total node_once: R$ ${r2(totalNodeOnce).toFixed(2)}\n`);

  console.log("Hipotese                  | Concl | Pend | Com.Concl   | Com.Pend");
  console.log("--------------------------|-------|------|-------------|------------");
  let best = null;
  for (const [name, r] of Object.entries(results)) {
    console.log(
      `${name.padEnd(26)}| ${String(r.concl).padEnd(6)}| ${String(r.pend).padEnd(5)}| R$ ${r.comConcl.toFixed(2).padEnd(10)}| R$ ${r.comPend.toFixed(2)}`,
    );
    if (targets.pend && targets.concl) {
      const score = scoreTargets(r, targets);
      if (!best || score < best.score) best = { name, score, r };
    }
  }

  if (best) {
    console.log(`\n>>> Hipotese mais proxima do PromosApp (${targets.concl} concl / ${targets.pend} pend): ${best.name} (desvio ${best.score.toFixed(2)})`);
    if (best.score > 0) {
      console.log(">>> Desvio > 0 = provavel diferenca de TIMING entre snapshots, nao de logica.");
    }
    if (best.name.startsWith("H2_conversaoInteira")) {
      console.log(">>> H2 = buildShopeePanelAppDayMap (split nivel conversao / PromosApp).");
    }
  }

  if (csvPath) {
    if (!fs.existsSync(csvPath)) {
      console.error(`CSV nao encontrado: ${csvPath}`);
      process.exit(1);
    }
    console.log(`\n=== Cruzamento com CSV: ${csvPath} ===`);
    const csvRows = parseCsv(csvPath);
    const csvByOrder = new Map(csvRows.map((r) => [r.orderId, r.status]));
    const apiByOrder = new Map(validated.map((o) => [o.orderId, o]));

    const diffs = [];
    for (const [orderId, o] of apiByOrder) {
      const csvStatus = csvByOrder.get(orderId);
      if (!csvStatus) {
        diffs.push({ orderId, api: o.orderStatus, csv: "(ausente no CSV)" });
        continue;
      }
      const convDone = convAllCompleted.get(o.conversionId) === true;
      const apiBucket = convDone ? "COMPLETED" : "PENDING";
      const csvBucket = csvStatus.includes("COMPLET") || csvStatus.includes("CONCLU") ? "COMPLETED" : "PENDING";
      if (apiBucket !== csvBucket) {
        diffs.push({
          orderId,
          api: o.orderStatus,
          csv: csvStatus,
          comissao: o.orderCommission,
          conv: o.conversionId,
          subid: o.subid,
        });
      }
    }
    for (const r of csvRows) {
      if (!apiByOrder.has(r.orderId)) {
        diffs.push({ orderId: r.orderId, api: "(ausente na API)", csv: r.status });
      }
    }

    if (!diffs.length) {
      console.log("Nenhuma divergencia de balde por orderId. Logicas identicas — qualquer diferenca anterior era timing.");
    } else {
      console.log(`${diffs.length} pedido(s) em balde diferente:\n`);
      console.table(diffs);
      const somaDiff = r2(diffs.reduce((s, d) => s + num(d.comissao), 0));
      console.log(`Comissao somada dos divergentes: R$ ${somaDiff.toFixed(2)}`);
      console.log("Se todos divergirem na MESMA direcao (CSV=PENDING, API=COMPLETED), e timing: o CSV e mais antigo.");
    }
  }

  console.log("\nDica: exporte o CSV no PromosApp e rode o script NO MESMO MINUTO para eliminar o fator timing.");
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});

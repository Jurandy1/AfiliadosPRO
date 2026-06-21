/**
 * auditoria_subid_por_dia.cjs
 *
 * Bate um SubID específico dia a dia entre API Shopee e Supabase.
 * NÃO grava nada.
 *
 * Uso:
 *   node auditoria_subid_por_dia.cjs flare01
 *   node auditoria_subid_por_dia.cjs ALL
 *   node auditoria_subid_por_dia.cjs ALL 2026-06-01 2026-06-21
 */

const crypto = require("crypto");
const https = require("https");
const path = require("path");
const fs = require("fs");

// --- Carrega .env ---
function loadEnv() {
  const envFiles = [
    path.join(__dirname, ".env.projetoafiliado-9ff07"),
    path.join(__dirname, ".env"),
  ];
  for (const f of envFiles) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    console.log(`[env] Carregado: ${f}`);
    break;
  }
}
loadEnv();

const SHOPEE_APP_ID = process.env.SHOPEE_APP_ID || "";
const SHOPEE_SECRET = process.env.SHOPEE_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";

if (!SHOPEE_APP_ID || !SHOPEE_SECRET) { console.error("❌ SHOPEE_APP_ID/SECRET não encontrados."); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("❌ SUPABASE_URL/KEY não encontrados."); process.exit(1); }

// --- Args ---
const TARGET_SUBID = process.argv[2] || "flare01";
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const mesInicio = `${hoje.slice(0, 7)}-01`;
const START_DATE = process.argv[3] || mesInicio;
const END_DATE   = process.argv[4] || hoje;

// --- Helpers ---
function brtDateToUnixStart(d) { return Math.floor(Date.parse(`${d}T00:00:00-03:00`) / 1000); }
function brtDateToUnixEnd(d)   { return Math.floor(Date.parse(`${d}T23:59:59-03:00`) / 1000); }
function roundMoney(n) { return Math.round(Number(n || 0) * 100) / 100; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function brtDateFromUnix(ts) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
    .format(new Date(ts * 1000));
}

function normalizeSubId(raw) {
  let s = String(raw || "").trim();
  if (!s) return "_organico";
  if (s.includes("-")) {
    const slot = s.split("-").find(p => p.trim().length > 0);
    if (slot) s = slot.trim();
  }
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 50) || "_organico";
}

function iterDates(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,"0")}-${String(next.getUTCDate()).padStart(2,"0")}`;
  }
  return out;
}

// --- Shopee API ---
async function shopeeFetch(query) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ query });
  const signature = crypto.createHash("sha256")
    .update(SHOPEE_APP_ID + timestamp + body + SHOPEE_SECRET).digest("hex");

  return new Promise((resolve, reject) => {
    const u = new URL("https://open-api.affiliate.shopee.com.br/graphql");
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname,
      method: "POST", family: 4,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.errors?.length) reject(new Error(json.errors.map(e => e.message).join("; ")));
          else resolve(json.data);
        } catch (e) { reject(new Error("JSON inválido: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function shopeeConversionReport(startTs, endTs) {
  const allNodes = [];
  const seenKeys = new Set();
  let scrollId = null;
  let hasNext = true;
  let pageCount = 0;

  while (hasNext && pageCount < 150) {
    pageCount++;
    if (pageCount > 1 && !scrollId) {
      process.stdout.write(`  [Shopee] Aguardando 31s...\n`);
      await sleep(31000);
    }
    const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
    const query = `{
      conversionReport(limit: 500, purchaseTimeStart: ${startTs}, purchaseTimeEnd: ${endTs}${scrollClause}) {
        nodes {
          conversionId purchaseTime utmContent totalCommission netCommission
          orders {
            orderId orderStatus
            items { qty actualAmount itemTotalCommission fraudStatus }
          }
        }
        pageInfo { hasNextPage scrollId }
      }
    }`;

    const data = await shopeeFetch(query);
    const nodes = data?.conversionReport?.nodes || [];
    for (const node of nodes) {
      const cid = String(node?.conversionId || "").trim();
      const oid = String(node?.orders?.[0]?.orderId || "").trim();
      const key = cid && oid ? `${cid}__${oid}` : cid;
      if (key && seenKeys.has(key)) continue;
      if (key) seenKeys.add(key);
      allNodes.push(node);
    }
    const pi = data?.conversionReport?.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    scrollId = pi.scrollId || null;
    process.stdout.write(`  [Shopee] Pág ${pageCount}: +${nodes.length} | total: ${allNodes.length}\n`);
    if (hasNext && !scrollId) break;
  }
  return allNodes;
}

// --- Supabase ---
async function supabaseGet(endpoint, params = {}) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const url = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}${qs ? "?" + qs : ""}`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname, port: 443,
      path: url.pathname + url.search, method: "GET",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "count=none",
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (!Array.isArray(parsed)) reject(new Error(`Supabase: ${parsed?.message || JSON.stringify(parsed).slice(0,200)}`));
          else resolve(parsed);
        } catch (e) { reject(new Error("JSON inválido: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// --- Agregação API por dia para o SubID alvo ---
function agregarApiPorDia(nodes, targetSubId, dates) {
  const byDay = {};
  for (const d of dates) byDay[d] = { comissao: 0, gmv: 0, pedidos: new Set(), itens: 0 };

  for (const node of nodes) {
    const sid = normalizeSubId(node.utmContent);
    if (targetSubId !== "ALL" && sid !== targetSubId) continue;

    const purchaseDay = brtDateFromUnix(Number(node.purchaseTime));
    if (!byDay[purchaseDay]) continue;

    const tc = parseFloat(node.netCommission || "0") > 0
      ? parseFloat(node.netCommission)
      : parseFloat(node.totalCommission || "0") || 0;

    const ord0 = node.orders?.[0];
    if (!ord0) continue;
    const st0 = String(ord0.orderStatus || "").toUpperCase().trim();
    if (st0 === "CANCELLED" || st0 === "CANCELED" || st0 === "UNPAID") continue;

    let nodeValido = false;
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || "").toUpperCase().trim();
      if (st === "CANCELLED" || st === "CANCELED" || st === "UNPAID") continue;
      const oid = String(ord.orderId || "").trim();
      if (!oid) continue;
      nodeValido = true;
      byDay[purchaseDay].pedidos.add(oid);
      for (const it of ord.items || []) {
        if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
        byDay[purchaseDay].gmv += parseFloat(it.actualAmount || "0") || 0;
        byDay[purchaseDay].itens += parseInt(it.qty, 10) || 1;
      }
    }
    if (!nodeValido) continue;
    byDay[purchaseDay].comissao += tc;
  }

  const result = {};
  for (const [d, acc] of Object.entries(byDay)) {
    result[d] = {
      comissao: roundMoney(acc.comissao),
      gmv: roundMoney(acc.gmv),
      pedidos: acc.pedidos.size,
      itens: acc.itens,
    };
  }
  return result;
}

// --- Agregação Supabase por dia para o SubID alvo ---
function agregarSupPorDia(rows, targetSubId, dates) {
  const byDay = {};
  for (const d of dates) byDay[d] = { comissao: 0, gmv: 0, pedidos: 0, itens: 0 };

  for (const row of rows) {
    const sid = normalizeSubId(row.subid);
    if (targetSubId !== "ALL" && sid !== targetSubId) continue;
    const d = row.data;
    if (!byDay[d]) continue;
    byDay[d].comissao += Number(row.comissoes || row.comissoes_estimadas || 0);
    byDay[d].gmv      += Number(row.faturamento || 0);
    byDay[d].pedidos  += Number(row.pedidos || 0);
    byDay[d].itens    += Number(row.qtd_itens || row.vendas || 0);
  }

  const result = {};
  for (const [d, acc] of Object.entries(byDay)) {
    result[d] = {
      comissao: roundMoney(acc.comissao),
      gmv: roundMoney(acc.gmv),
      pedidos: acc.pedidos,
      itens: acc.itens,
    };
  }
  return result;
}

function fmtMoney(n) { return `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`.padStart(14); }
function fmtNum(n)   { return String(n).padStart(6); }
function fmtDate(d)  { const [y,m,day] = d.split("-"); return `${day}/${m}/${y}`; }

// --- Main ---
async function main() {
  const targetNorm = TARGET_SUBID === "ALL" ? "ALL" : normalizeSubId(TARGET_SUBID);
  const dates = iterDates(START_DATE, END_DATE);

  console.log("=".repeat(90));
  console.log(`🔍 BATIDA DIÁRIA: SubID "${TARGET_SUBID}" (normalizado: "${targetNorm}")`);
  console.log(`📅 Período: ${START_DATE} → ${END_DATE} (${dates.length} dias)`);
  console.log("=".repeat(90));
  console.log("");

  // 1) Supabase
  console.log("📦 [1/2] Buscando subid_daily do Supabase...");
  const supRows = await supabaseGet("subid_daily", {
    select: "*",
    data: `gte.${START_DATE}`,
    order: "data.asc",
  });
  const supByDay = agregarSupPorDia(supRows, targetNorm, dates);
  console.log(`  ✅ ${supRows.length} linhas lidas\n`);

  // 2) API Shopee
  console.log("🛒 [2/2] Buscando API Shopee...");
  const startTs = brtDateToUnixStart(START_DATE);
  const endTs   = brtDateToUnixEnd(END_DATE);
  const nodes = await shopeeConversionReport(startTs, endTs);
  const apiByDay = agregarApiPorDia(nodes, targetNorm, dates);
  console.log(`\n  ✅ ${nodes.length} conversões processadas\n`);

  // 3) Comparação dia a dia
  console.log("=".repeat(90));
  console.log(`📊 RESULTADO DIA A DIA — SubID: ${TARGET_SUBID}`);
  console.log("=".repeat(90));
  console.log(
    "Data       " +
    " API Comissão" + "  SUP Comissão" + "    Δ Comissão" +
    "  API GMV      " + "  SUP GMV      " +
    " APIPed" + " SUPPed" + "  Status"
  );
  console.log("-".repeat(90));

  let totApiCom = 0, totSupCom = 0, totApiGmv = 0, totSupGmv = 0;
  let totApiPed = 0, totSupPed = 0;
  let diasOk = 0, diasFail = 0, diasVazios = 0;

  for (const d of dates) {
    const api = apiByDay[d] || { comissao: 0, gmv: 0, pedidos: 0, itens: 0 };
    const sup = supByDay[d] || { comissao: 0, gmv: 0, pedidos: 0, itens: 0 };
    const dCom = roundMoney(api.comissao - sup.comissao);
    const bate = Math.abs(dCom) < 1;
    const vazio = api.comissao === 0 && sup.comissao === 0;

    totApiCom += api.comissao;
    totSupCom += sup.comissao;
    totApiGmv += api.gmv;
    totSupGmv += sup.gmv;
    totApiPed += api.pedidos;
    totSupPed += sup.pedidos;

    let icon;
    if (vazio)       { icon = "⬜ sem dados"; diasVazios++; }
    else if (bate)   { icon = "✅"; diasOk++; }
    else             { icon = "❌"; diasFail++; }

    // Destaca dia 20 e dias com problema
    const highlight = d === "2026-06-20" || !bate && !vazio;

    console.log(
      `${fmtDate(d)}  ` +
      fmtMoney(api.comissao) + fmtMoney(sup.comissao) +
      fmtMoney(dCom) +
      fmtMoney(api.gmv) + fmtMoney(sup.gmv) +
      fmtNum(api.pedidos) + fmtNum(sup.pedidos) +
      `  ${icon}${d === "2026-06-20" ? " ← HOJE" : ""}`
    );
  }

  console.log("=".repeat(90));
  console.log(
    `${"TOTAL".padEnd(11)}` +
    fmtMoney(totApiCom) + fmtMoney(totSupCom) +
    fmtMoney(roundMoney(totApiCom - totSupCom)) +
    fmtMoney(totApiGmv) + fmtMoney(totSupGmv) +
    fmtNum(totApiPed) + fmtNum(totSupPed)
  );
  console.log("=".repeat(90));

  console.log(`\n📈 RESUMO:`);
  console.log(`  ✅ Dias que batem:  ${diasOk}`);
  console.log(`  ❌ Dias divergentes: ${diasFail}`);
  console.log(`  ⬜ Dias sem dados:  ${diasVazios}`);

  // Diagnóstico do dia 20
  const api20 = apiByDay["2026-06-20"];
  const sup20 = supByDay["2026-06-20"];
  console.log(`\n🔎 DIA 20/06/2026:`);
  console.log(`  API Shopee → Comissão: ${fmtMoney(api20?.comissao)} | GMV: ${fmtMoney(api20?.gmv)} | Pedidos: ${api20?.pedidos}`);
  console.log(`  Supabase   → Comissão: ${fmtMoney(sup20?.comissao)} | GMV: ${fmtMoney(sup20?.gmv)} | Pedidos: ${sup20?.pedidos}`);

  if ((api20?.comissao || 0) > 0 && (sup20?.comissao || 0) === 0) {
    console.log(`\n  ⚠️  CAUSA: API tem dados mas Supabase está zerado`);
    console.log(`  → Sync de hoje ainda não rodou para flare01`);
    console.log(`  → Aguarda o sync automático (roda a cada 2h) ou força backfill`);
  } else if ((api20?.comissao || 0) === 0) {
    console.log(`\n  ℹ️  API também não tem dados para hoje ainda`);
    console.log(`  → Normal se o sync ainda não processou o dia corrente`);
  } else {
    console.log(`\n  ✅ Dia 20 está sincronizado`);
  }

  console.log(`\n⏰ Concluído em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
}

main().catch(err => {
  console.error("\n❌ Erro:", err?.message || err);
  process.exit(1);
});

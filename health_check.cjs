/**
 * health_check.cjs
 *
 * Verifica integridade do Supabase em segundos (sem chamar API Shopee).
 * Detecta:
 *   - Divergência shopee_daily vs subid_daily
 *   - Dias zerados/faltando
 *   - Último sync atrasado
 *   - Tabelas vazias
 *
 * Uso:
 *   node health_check.cjs              (mês atual)
 *   node health_check.cjs 2026-06      (mês específico)
 *   node health_check.cjs 2026-06-01 2026-06-20  (período)
 */

const https = require("https");
const path = require("path");
const fs = require("fs");

// --- Carrega .env ---
function loadEnv() {
  for (const f of [
    path.join(__dirname, ".env.projetoafiliado-9ff07"),
    path.join(__dirname, ".env"),
  ]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    break;
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não encontrados.");
  process.exit(1);
}

// --- Helpers ---
function brtDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}
function brtNow() {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date());
}
function roundMoney(n) { return Math.round(Number(n || 0) * 100) / 100; }
function fmtMoney(n) { return `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; }

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

async function fetchAll(endpoint, params = {}) {
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const rows = await supabaseGet(endpoint, { ...params, limit: String(PAGE), offset: String(offset) });
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// --- Main ---
async function main() {
  // Argumentos
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  const hoje = brtDate();
  let mesInicio, mesFim;

  if (arg1 && arg2) {
    mesInicio = arg1;
    mesFim = arg2;
  } else if (arg1 && /^\d{4}-\d{2}$/.test(arg1)) {
    mesInicio = `${arg1}-01`;
    mesFim = `${arg1}-31`;
  } else {
    mesInicio = `${hoje.slice(0, 7)}-01`;
    mesFim = hoje;
  }

  console.log("=".repeat(70));
  console.log(`🏥 HEALTH CHECK — Supabase`);
  console.log(`📅 Período: ${mesInicio} → ${mesFim}`);
  console.log(`🕐 Agora:   ${brtNow()} (BRT)`);
  console.log("=".repeat(70));
  console.log("");

  let alertas = 0;
  let warnings = 0;

  // ────────── CHECK 1: sync_state ──────────
  console.log("🔍 [1/5] Verificando estado dos syncs (sync_state)...");
  const syncStates = await supabaseGet("sync_state", { select: "*" });
  
  const shopeeHealth = syncStates.find(s => s.key === "shopee_health");
  const metaHealth = syncStates.find(s => s.key === "meta_health");
  
  if (!shopeeHealth) {
    console.log("  ❌ shopee_health NÃO existe em sync_state");
    alertas++;
  } else {
    const blob = shopeeHealth.data_blob || {};
    const lastSync = blob.lastSyncAt || blob.lastDailySyncAt || "—";
    console.log(`  ✅ shopee_health | dataVersion: ${blob.dataVersion || "—"} | último sync: ${lastSync}`);
  }
  
  if (!metaHealth) {
    console.log("  ❌ meta_health NÃO existe em sync_state");
    alertas++;
  } else {
    const blob = metaHealth.data_blob || {};
    const lastSync = blob.lastDailySyncAt || blob.lastAdsSyncAt || "—";
    console.log(`  ✅ meta_health   | dataVersion: ${blob.dataVersion || "—"} | último sync: ${typeof lastSync === "object" ? JSON.stringify(lastSync) : lastSync}`);
  }
  console.log("");

  // ────────── CHECK 2: shopee_daily ──────────
  console.log("🔍 [2/5] Verificando shopee_daily...");
  const shopeeDaily = await supabaseGet("shopee_daily", {
    select: "data,comissao,fat_bruto,pedidos,vendas",
    data: `gte.${mesInicio}`,
    order: "data.asc",
  });
  
  const dates = iterDates(mesInicio, mesFim);
  const shopeeByDate = new Map(shopeeDaily.map(r => [r.data, r]));
  const diasFaltando = [];
  const diasZerados = [];
  
  for (const d of dates) {
    const row = shopeeByDate.get(d);
    if (!row) {
      diasFaltando.push(d);
    } else if ((Number(row.comissao || 0) === 0) && (Number(row.pedidos || 0) === 0)) {
      diasZerados.push(d);
    }
  }
  
  console.log(`  📊 ${shopeeDaily.length}/${dates.length} dias com dados`);
  if (diasFaltando.length > 0) {
    console.log(`  ⚠️  ${diasFaltando.length} dias sem registro: ${diasFaltando.join(", ")}`);
    warnings++;
  }
  if (diasZerados.length > 0) {
    console.log(`  ⚠️  ${diasZerados.length} dias zerados: ${diasZerados.join(", ")}`);
    if (diasZerados.includes(hoje)) {
      console.log(`     → Dia ${hoje} é hoje, normal se sync ainda não rodou`);
    } else {
      warnings++;
    }
  }
  console.log("");

  // ────────── CHECK 3: subid_daily vs shopee_daily ──────────
  console.log("🔍 [3/5] Comparando shopee_daily vs subid_daily...");
  const subidRows = await fetchAll("subid_daily", {
    select: "data,comissoes",
    data: `gte.${mesInicio}`,
  });
  
  // Filtra só até mesFim
  const subidFiltered = subidRows.filter(r => r.data <= mesFim);
  
  // Agrega subid_daily por dia
  const subidByDate = new Map();
  for (const row of subidFiltered) {
    const cur = subidByDate.get(row.data) || 0;
    subidByDate.set(row.data, cur + Number(row.comissoes || 0));
  }
  
  const divergentes = [];
  for (const d of dates) {
    const shopee = Number(shopeeByDate.get(d)?.comissao || 0);
    const subid = Number(subidByDate.get(d) || 0);
    const delta = roundMoney(subid - shopee);
    if (Math.abs(delta) > 1) {
      divergentes.push({ data: d, shopee: roundMoney(shopee), subid: roundMoney(subid), delta });
    }
  }
  
  if (divergentes.length === 0) {
    console.log(`  ✅ Todos os dias batendo (Δ < R$ 1)`);
  } else {
    console.log(`  ❌ ${divergentes.length} dias com divergência:`);
    for (const d of divergentes) {
      console.log(`     ${d.data}: shopee_daily ${fmtMoney(d.shopee)} | subid_daily ${fmtMoney(d.subid)} | Δ ${fmtMoney(d.delta)}`);
    }
    alertas++;
  }
  console.log("");

  // ────────── CHECK 4: meta_ads_daily ──────────
  console.log("🔍 [4/5] Verificando meta_ads_daily...");
  const metaRows = await fetchAll("meta_ads_daily", {
    select: "data",
    data: `gte.${mesInicio}`,
  });
  
  const metaFiltered = metaRows.filter(r => r.data <= mesFim);
  const metaDates = new Set(metaFiltered.map(r => r.data));
  
  console.log(`  📊 ${metaFiltered.length} linhas em ${metaDates.size}/${dates.length} dias`);
  
  const metaFaltando = dates.filter(d => !metaDates.has(d));
  if (metaFaltando.length > 0 && metaFaltando.length < 5) {
    console.log(`  ⚠️  ${metaFaltando.length} dias sem meta_ads_daily: ${metaFaltando.join(", ")}`);
    warnings++;
  } else if (metaFaltando.length >= 5) {
    console.log(`  ❌ ${metaFaltando.length} dias sem meta_ads_daily (sync Meta travou?)`);
    alertas++;
  }
  console.log("");

  // ────────── CHECK 5: Totais do período ──────────
  console.log("🔍 [5/5] Resumo do período...");
  const totShopeeCom = roundMoney(shopeeDaily.filter(r => r.data >= mesInicio && r.data <= mesFim).reduce((s, r) => s + Number(r.comissao || 0), 0));
  const totShopeeGmv = roundMoney(shopeeDaily.filter(r => r.data >= mesInicio && r.data <= mesFim).reduce((s, r) => s + Number(r.fat_bruto || 0), 0));
  const totShopeePed = shopeeDaily.filter(r => r.data >= mesInicio && r.data <= mesFim).reduce((s, r) => s + Number(r.pedidos || 0), 0);
  const totSubidCom = roundMoney(Array.from(subidByDate.entries()).filter(([d]) => d >= mesInicio && d <= mesFim).reduce((s, [, v]) => s + v, 0));
  
  console.log(`  shopee_daily  → Comissão: ${fmtMoney(totShopeeCom)} | GMV: ${fmtMoney(totShopeeGmv)} | Pedidos: ${totShopeePed}`);
  console.log(`  subid_daily   → Comissão: ${fmtMoney(totSubidCom)} | Δ: ${fmtMoney(roundMoney(totSubidCom - totShopeeCom))}`);
  console.log("");

  // ────────── VEREDICTO ──────────
  console.log("=".repeat(70));
  if (alertas === 0 && warnings === 0) {
    console.log("✅ TUDO OK — Sistema saudável, dados sincronizados");
  } else if (alertas === 0) {
    console.log(`⚠️  ${warnings} aviso(s) — sistema funcional mas com pontos de atenção`);
  } else {
    console.log(`❌ ${alertas} ALERTA(S) e ${warnings} aviso(s) — PRECISA AÇÃO`);
    console.log("");
    console.log("💡 SUGESTÕES:");
    if (divergentes.length > 0) {
      const dataMin = divergentes[0].data;
      const dataMax = divergentes[divergentes.length - 1].data;
      console.log(`   1. DELETE subid_daily dos dias divergentes:`);
      console.log(`      DELETE FROM subid_daily WHERE data >= '${dataMin}' AND data <= '${dataMax}';`);
      console.log(`   2. Rodar backfill desses dias:`);
      console.log(`      curl.exe -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app/?startDate=${dataMin}&endDate=${dataMax}&force=1" \\`);
      console.log(`        -H "Authorization: Bearer SEU_SECRET" -H "Content-Length: 0" -m 600`);
    }
    if (diasFaltando.length > 0 && !diasFaltando.includes(hoje)) {
      console.log(`   • Rodar backfill dos dias faltando: ${diasFaltando.join(", ")}`);
    }
  }
  console.log("=".repeat(70));
  console.log("");
  
  process.exit(alertas > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\n❌ Erro:", err?.message || err);
  process.exit(2);
});

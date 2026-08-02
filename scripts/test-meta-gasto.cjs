/**
 * Diagnostica sync de gasto Meta sem imprimir secrets.
 * node scripts/test-meta-gasto.cjs [days]
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const root = path.resolve(__dirname, "..");
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, "functions", ".env.mestreafil-53145"));

const META_URL = (process.env.VITE_META_DAILY_URL || "").trim();
const SECRET = (process.env.VITE_BACKFILL_SECRET || process.env.META_SYNC_SECRET || "").trim();
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
const days = String(process.argv[2] || "7");

async function main() {
  console.log("=== Diagnóstico gasto Meta ===");
  console.log("META_URL:", META_URL ? META_URL.replace(/https?:\/\//, "").slice(0, 55) : "(vazio)");
  console.log("hasSecret:", !!SECRET, "hasSupabase:", !!SUPABASE_URL, !!SUPABASE_KEY);

  if (SUPABASE_URL && SUPABASE_KEY) {
    const healthRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_state?select=key,data_blob,updated_at&key=eq.meta_health&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const healthRows = await healthRes.json();
    const h = healthRows?.[0]?.data_blob || {};
    console.log("\n-- sync_state.meta_health --");
    console.log(JSON.stringify({
      lastDailySyncAt: h.lastDailySyncAt || h.last_sync_at || null,
      lastRange: h.lastRange || null,
      linhas: h.linhas ?? null,
      gravados: h.gravados ?? null,
      erros: h.erros || h.errors || null,
      lastDailySyncError: h.lastDailySyncError || null,
      updated_at: healthRows?.[0]?.updated_at || null,
    }, null, 2));

    const today = new Date();
    const d7 = new Date(today);
    d7.setDate(d7.getDate() - 7);
    const start = d7.toISOString().slice(0, 10);
    const end = today.toISOString().slice(0, 10);
    const sumRes = await fetch(
      `${SUPABASE_URL}/rest/v1/meta_ads_daily?select=data,gasto&data=gte.${start}&data=lte.${end}&limit=5000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const rows = await sumRes.json();
    const list = Array.isArray(rows) ? rows : [];
    const total = list.reduce((s, r) => s + Number(r.gasto || 0), 0);
    const byDay = {};
    for (const r of list) {
      byDay[r.data] = (byDay[r.data] || 0) + Number(r.gasto || 0);
    }
    console.log(`\n-- meta_ads_daily últimos 7 dias --`);
    console.log(`linhas=${list.length} gasto_total=R$ ${total.toFixed(2)}`);
    console.log("por dia:", Object.keys(byDay).sort().map((d) => `${d}=${byDay[d].toFixed(2)}`).join(" | ") || "(vazio)");
  }

  if (!META_URL || !SECRET) {
    console.log("\nSem URL/secret — não dá para chamar o backfill.");
    return;
  }

  console.log(`\n-- POST metaBackfillDaily?days=${days} --`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await fetch(`${META_URL}?days=${encodeURIComponent(days)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      body: "",
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    console.log("HTTP", res.status);
    console.log(JSON.stringify({
      success: json.success,
      linhas: json.linhas ?? json.resultado?.linhas,
      gravados: json.gravados ?? json.resultado?.gravados,
      erros: json.erros || json.resultado?.erros || json.error,
      range: json.range || json.resultado?.range,
      message: json.message,
      keys: Object.keys(json || {}),
    }, null, 2));
  } finally {
    clearTimeout(t);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

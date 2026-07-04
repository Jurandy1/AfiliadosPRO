#!/usr/bin/env node
/**
 * Backfill de produto_mensal no Supabase.
 *
 * Reaproveita rebuildMonthlyBuckets (functions/lib/monthlyRollup), que lê tudo
 * do Supabase; o Firestore entra só nas escritas, então passamos um stub que
 * as ignora — os buckets do Firestore continuam sendo mantidos pelas Cloud
 * Functions agendadas. Aqui só o upsert novo em produto_mensal tem efeito.
 *
 * Uso: node scripts/backfill-produto-mensal.cjs
 */
const path = require("path");
const fs = require("fs");

function loadEnv() {
  for (const f of [
    path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", ".env.local"),
  ]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();

const { createClient } = require(path.join(__dirname, "../functions/node_modules/@supabase/supabase-js"));
const { rebuildMonthlyBuckets } = require(path.join(__dirname, "../functions/lib/monthlyRollup"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Firestore stub: batch/collection sem efeito (writes ignorados de propósito).
const dbStub = {
  batch: () => ({ set() {}, commit: async () => {} }),
  collection: () => ({ doc: () => ({}) }),
};

async function listMonths() {
  const months = new Set();
  for (const table of ["shopee_daily", "produto_daily"]) {
    const first = await supabase.from(table).select("data").order("data", { ascending: true }).limit(1);
    const last = await supabase.from(table).select("data").order("data", { ascending: false }).limit(1);
    const start = first.data?.[0]?.data;
    const end = last.data?.[0]?.data;
    if (!start || !end) continue;
    let [y, m] = start.slice(0, 7).split("-").map(Number);
    const [ye, me] = end.slice(0, 7).split("-").map(Number);
    while (y < ye || (y === ye && m <= me)) {
      months.add(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  return [...months].sort();
}

async function main() {
  const months = await listMonths();
  console.log("Meses a reconstruir:", months.join(", "));

  for (const monthKey of months) {
    const summary = await rebuildMonthlyBuckets(dbStub, supabase, monthKey);
    console.log(`[${monthKey}] dias=${summary.diasCount} produtos=${summary.produtoMensalCount} (docs=${summary.produtoDocs})`);
  }

  const { count } = await supabase.from("produto_mensal").select("data", { count: "exact", head: true });
  console.log(`\nOK — produto_mensal agora tem ${count} meses.`);
}

main().catch((e) => { console.error("Backfill falhou:", e); process.exit(1); });

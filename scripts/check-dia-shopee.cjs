#!/usr/bin/env node
/**
 * check-dia-shopee.cjs
 *
 * Diagnóstico completo de um dia específico em TODAS as tabelas relevantes do Supabase.
 * Verifica shopee_daily, subid_daily, meta_ads_daily, clique_daily e sync_state.
 *
 * Uso:
 *   node scripts/check-dia-shopee.cjs 2026-07-03
 */
"use strict";

const path = require("path");
const fs = require("fs");

// ── Carrega .env ──
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
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function fmtMoney(n) { return `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

async function main() {
  const dia = process.argv[2] || "2026-07-03";

  console.log("\n" + "═".repeat(70));
  console.log(`  🔍 DIAGNÓSTICO COMPLETO — Dia: ${dia}`);
  console.log(`  🕐 Agora: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (BRT)`);
  console.log("═".repeat(70));

  // ── 1) shopee_daily ──
  console.log("\n  ── [1/5] shopee_daily ──");
  const { data: shopeeRows, error: shopeeErr } = await supabase
    .from("shopee_daily")
    .select("*")
    .eq("data", dia);

  if (shopeeErr) {
    console.log(`  ❌ Erro: ${shopeeErr.message}`);
  } else if (!shopeeRows || shopeeRows.length === 0) {
    console.log("  ❌ NENHUM registro encontrado para esse dia!");
  } else {
    console.log(`  ✅ ${shopeeRows.length} registro(s) encontrado(s)`);
    for (const row of shopeeRows) {
      console.log("\n  Campos presentes:", Object.keys(row).join(", "));
      console.log(`  → data:              ${row.data}`);
      console.log(`  → comissao:          ${fmtMoney(row.comissao || 0)}`);
      console.log(`  → comissao_estimada: ${fmtMoney(row.comissao_estimada || 0)}`);
      console.log(`  → comissao_total:    ${fmtMoney(row.comissao_total || 0)}`);
      console.log(`  → comissao_concluida:${fmtMoney(row.comissao_concluida || 0)}`);
      console.log(`  → comissao_pendente: ${fmtMoney(row.comissao_pendente || 0)}`);
      console.log(`  → comissao_cancelada:${fmtMoney(row.comissao_cancelada || 0)}`);
      console.log(`  → fat_bruto:         ${fmtMoney(row.fat_bruto || 0)}`);
      console.log(`  → faturamento:       ${fmtMoney(row.faturamento || 0)}`);
      console.log(`  → gmv_total:         ${fmtMoney(row.gmv_total || 0)}`);
      console.log(`  → pedidos:           ${row.pedidos ?? "NULL"}`);
      console.log(`  → vendas:            ${row.vendas ?? "NULL"}`);
      console.log(`  → qtd_itens:         ${row.qtd_itens ?? "NULL"}`);
      console.log(`  → vendas_diretas:    ${row.vendas_diretas ?? "NULL"}`);
      console.log(`  → vendas_indiretas:  ${row.vendas_indiretas ?? "NULL"}`);
      console.log(`  → pedidos_completos: ${row.pedidos_completos ?? "NULL"}`);
      console.log(`  → pedidos_pendentes: ${row.pedidos_pendentes ?? "NULL"}`);
      console.log(`  → pedidos_cancelados:${row.pedidos_cancelados ?? "NULL"}`);

      // Verifica se isDailyMetricsVazio seria TRUE (indicando que o dashboard ignora essa row)
      const comissao = Number(row.comissao_estimada ?? row.comissao_total ?? row.comissao ?? 0);
      const pedidos = Number(row.pedidos ?? 0);
      const vendas = Number(row.qtd_itens ?? row.vendas ?? 0);
      const fat = Number(row.faturamento ?? row.gmv_total ?? row.fat_bruto ?? 0);
      console.log(`\n  ⚙️ Dashboard veria como VAZIO? comissao=${comissao}, pedidos=${pedidos}, vendas=${vendas}, fat=${fat}`);
      if (comissao === 0 && pedidos === 0 && vendas === 0 && fat === 0) {
        console.log("  ⚠️  SIM — isDailyMetricsVazio() retornaria TRUE → dados ignorados pelo dashboard!");
      } else {
        console.log("  ✅ NÃO — o dashboard deveria exibir esses dados.");
      }
    }
  }

  // ── 2) subid_daily ──
  console.log("\n  ── [2/5] subid_daily ──");
  const { data: subidRows, error: subidErr } = await supabase
    .from("subid_daily")
    .select("*")
    .eq("data", dia);

  if (subidErr) {
    console.log(`  ❌ Erro: ${subidErr.message}`);
  } else if (!subidRows || subidRows.length === 0) {
    console.log("  ❌ NENHUM registro encontrado para esse dia!");
  } else {
    console.log(`  ✅ ${subidRows.length} registro(s) (subids) encontrado(s)`);
    let totalCom = 0, totalFat = 0, totalPed = 0;
    for (const row of subidRows) {
      totalCom += Number(row.comissoes || 0);
      totalFat += Number(row.faturamento || 0);
      totalPed += Number(row.pedidos || 0);
    }
    console.log(`  → Total comissões:   ${fmtMoney(totalCom)}`);
    console.log(`  → Total faturamento: ${fmtMoney(totalFat)}`);
    console.log(`  → Total pedidos:     ${totalPed}`);
    console.log(`  → SubIDs: ${[...new Set(subidRows.map(r => r.subid))].join(", ")}`);
  }

  // ── 3) meta_ads_daily ──
  console.log("\n  ── [3/5] meta_ads_daily ──");
  const { data: metaRows, error: metaErr } = await supabase
    .from("meta_ads_daily")
    .select("*")
    .eq("data", dia);

  if (metaErr) {
    console.log(`  ❌ Erro: ${metaErr.message}`);
  } else if (!metaRows || metaRows.length === 0) {
    console.log("  ⚠️  Nenhum registro de Meta Ads para esse dia");
  } else {
    let totalGasto = 0, totalCliques = 0;
    for (const row of metaRows) {
      totalGasto += Number(row.gasto || 0);
      totalCliques += Number(row.cliques || 0);
    }
    console.log(`  ✅ ${metaRows.length} anúncios encontrados`);
    console.log(`  → Gasto total:  ${fmtMoney(totalGasto)}`);
    console.log(`  → Cliques total: ${totalCliques}`);
  }

  // ── 4) Verificar dias vizinhos no shopee_daily (1, 2, 3, 4 de julho) ──
  console.log("\n  ── [4/5] shopee_daily — todos os dias de julho ──");
  const { data: julhoRows, error: julhoErr } = await supabase
    .from("shopee_daily")
    .select("data,comissao,fat_bruto,pedidos,vendas")
    .gte("data", "2026-07-01")
    .lte("data", "2026-07-04")
    .order("data", { ascending: true });

  if (julhoErr) {
    console.log(`  ❌ Erro: ${julhoErr.message}`);
  } else {
    console.log(`  📊 Dias encontrados: ${julhoRows.length}`);
    for (const r of julhoRows || []) {
      console.log(`     ${r.data} → Comissão: ${fmtMoney(r.comissao || 0)} | Fat: ${fmtMoney(r.fat_bruto || 0)} | Pedidos: ${r.pedidos || 0} | Vendas: ${r.vendas || 0}`);
    }
    const diaAlvo = (julhoRows || []).find(r => r.data === dia);
    if (!diaAlvo) {
      console.log(`  ❌ O dia ${dia} NÃO está na lista!`);
    }
  }

  // ── 5) sync_state ──
  console.log("\n  ── [5/5] sync_state — último sync ──");
  const { data: syncRows, error: syncErr } = await supabase
    .from("sync_state")
    .select("*")
    .eq("key", "shopee_health");

  if (syncErr) {
    console.log(`  ❌ Erro: ${syncErr.message}`);
  } else if (!syncRows || syncRows.length === 0) {
    console.log("  ❌ shopee_health NÃO encontrado");
  } else {
    const blob = syncRows[0]?.data_blob || {};
    console.log(`  sync_state.shopee_health:`);
    console.log(`    → dataVersion: ${JSON.stringify(blob.dataVersion)}`);
    console.log(`    → lastDailySyncAt: ${blob.lastDailySyncAt || "—"}`);
    console.log(`    → lastSyncAt: ${blob.lastSyncAt || "—"}`);
    console.log(`    → lastSyncDay: ${blob.lastSyncDay || "—"}`);
    console.log(`    → lastBackfillEnd: ${blob.lastBackfillEnd || "—"}`);
    console.log(`    → Todos os campos:`, JSON.stringify(blob, null, 2));
  }

  console.log("\n" + "═".repeat(70));
  console.log("  DIAGNÓSTICO COMPLETO.");
  console.log("═".repeat(70) + "\n");
}

main().catch(err => {
  console.error("\n❌ Erro:", err?.message || err);
  process.exit(2);
});

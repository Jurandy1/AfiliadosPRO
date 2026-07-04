#!/usr/bin/env node
/**
 * test-shopee-meta-mensal.cjs
 *
 * Teste READ-ONLY: compara dados mensais entre tabelas Supabase:
 *   - shopee_daily vs subid_daily (comissão, faturamento, pedidos)
 *   - meta_ads_daily (gasto, cliques por dia)
 *   - clique_daily vs subid_daily (cliques shopee)
 *
 * NÃO GRAVA NADA — apenas lê e imprime.
 *
 * Uso:
 *   node scripts/test-shopee-meta-mensal.cjs              (mês atual)
 *   node scripts/test-shopee-meta-mensal.cjs 2026-06      (mês específico)
 *   node scripts/test-shopee-meta-mensal.cjs 2026-05 2026-06  (range de meses)
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

// ── Supabase client ──
const { createClient } = require(path.join(__dirname, "../functions/node_modules/@supabase/supabase-js"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ── Helpers ──
function roundMoney(n) { return Math.round(Number(n || 0) * 100) / 100; }
function fmtMoney(n) { return `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function padR(s, len) { return String(s).padStart(len); }

function brtToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const first = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

function iterDates(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

async function fetchAllSupabase(table, first, last, select = "*") {
  let allData = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table)
      .select(select)
      .gte("data", first)
      .lte("data", last)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`[Supabase] ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return allData;
}

// ── Auditoria de um mês ──
async function auditMonth(monthKey) {
  const { first, last } = monthBounds(monthKey);
  const hoje = brtToday();
  const lastDay = last > hoje ? hoje : last;
  const dates = iterDates(first, lastDay);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  📅 MÊS: ${monthKey}  (${first} → ${lastDay})`);
  console.log(`${"═".repeat(70)}`);

  // ── 1) Buscar dados do Supabase ──
  console.log("\n  📥 Buscando dados do Supabase...");
  const [shopeeRows, metaRows, subidRows, cliqueRows] = await Promise.all([
    fetchAllSupabase("shopee_daily", first, lastDay,
      "data,comissao,comissao_concluida,comissao_pendente,comissao_cancelada,fat_bruto,pedidos,vendas,vendas_diretas,vendas_indiretas,pedidos_completos,pedidos_pendentes,pedidos_cancelados,pedidos_nao_pagos,comissao_nao_paga"),
    fetchAllSupabase("meta_ads_daily", first, lastDay,
      "data,subid,gasto,cliques"),
    fetchAllSupabase("subid_daily", first, lastDay,
      "data,subid,comissoes,comissoes_estimadas,faturamento,pedidos,qtd_itens,vendas_diretas,vendas_indiretas,cliques_shopee"),
    fetchAllSupabase("clique_daily", first, lastDay,
      "data,subid,cliques,cliques_unicos"),
  ]);

  console.log(`     shopee_daily:   ${shopeeRows.length} dias`);
  console.log(`     meta_ads_daily: ${metaRows.length} linhas`);
  console.log(`     subid_daily:    ${subidRows.length} linhas`);
  console.log(`     clique_daily:   ${cliqueRows.length} linhas`);

  // ── 2) Indexar shopee_daily por data ──
  const shopeeByDate = {};
  for (const row of shopeeRows) {
    shopeeByDate[row.data] = {
      comissao: roundMoney(Number(row.comissao || 0)),
      comissao_concluida: roundMoney(Number(row.comissao_concluida || 0)),
      comissao_pendente: roundMoney(Number(row.comissao_pendente || 0)),
      comissao_cancelada: roundMoney(Number(row.comissao_cancelada || 0)),
      fat_bruto: roundMoney(Number(row.fat_bruto || 0)),
      pedidos: Number(row.pedidos || 0),
      vendas: Number(row.vendas || 0),
      vendas_diretas: Number(row.vendas_diretas || 0),
      vendas_indiretas: Number(row.vendas_indiretas || 0),
      pedidos_concluidos: Number(row.pedidos_completos || 0),
      pedidos_pendentes: Number(row.pedidos_pendentes || 0),
      pedidos_cancelados: Number(row.pedidos_cancelados || 0),
      pedidos_nao_pagos: Number(row.pedidos_nao_pagos || 0),
      comissao_nao_paga: roundMoney(Number(row.comissao_nao_paga || 0)),
    };
  }

  // ── 3) Agregar meta_ads_daily por dia ──
  const metaByDate = {};
  const metaBySubid = {};
  for (const row of metaRows) {
    const d = row.data;
    if (!d) continue;
    if (!metaByDate[d]) metaByDate[d] = { gasto: 0, cliques: 0, anuncios: 0 };
    metaByDate[d].gasto = roundMoney(metaByDate[d].gasto + Number(row.gasto || 0));
    metaByDate[d].cliques += Number(row.cliques || 0);
    metaByDate[d].anuncios += 1;

    const sid = row.subid || "(sem subid)";
    if (!metaBySubid[sid]) metaBySubid[sid] = { gasto: 0, cliques: 0 };
    metaBySubid[sid].gasto = roundMoney(metaBySubid[sid].gasto + Number(row.gasto || 0));
    metaBySubid[sid].cliques += Number(row.cliques || 0);
  }

  // ── 4) Agregar subid_daily por dia ──
  const subidByDate = {};
  const subidSubids = new Set();
  for (const row of subidRows) {
    const d = row.data;
    if (!d) continue;
    if (!subidByDate[d]) subidByDate[d] = { comissoes: 0, comissoes_est: 0, fat: 0, pedidos: 0, qtd_itens: 0, vendas_dir: 0, vendas_ind: 0 };
    subidByDate[d].comissoes = roundMoney(subidByDate[d].comissoes + Number(row.comissoes || 0));
    subidByDate[d].comissoes_est = roundMoney(subidByDate[d].comissoes_est + Number(row.comissoes_estimadas || row.comissoes || 0));
    subidByDate[d].fat = roundMoney(subidByDate[d].fat + Number(row.faturamento || 0));
    subidByDate[d].pedidos += Number(row.pedidos || 0);
    subidByDate[d].qtd_itens += Number(row.qtd_itens || 0);
    subidByDate[d].vendas_dir += Number(row.vendas_diretas || 0);
    subidByDate[d].vendas_ind += Number(row.vendas_indiretas || 0);
    if (row.subid) subidSubids.add(row.subid);
  }

  // ── 5) Agregar clique_daily por dia ──
  const cliqueByDate = {};
  for (const row of cliqueRows) {
    const d = row.data;
    if (!d) continue;
    if (!cliqueByDate[d]) cliqueByDate[d] = { cliques: 0 };
    cliqueByDate[d].cliques += Number(row.cliques || 0);
  }

  // ── 6) Comparação dia a dia ──
  let totalOk = 0;
  const detalhes = [];

  const totais = {
    shopee:  { comissao: 0, fat: 0, pedidos: 0, vendas: 0, vendas_dir: 0, vendas_ind: 0, com_conc: 0, com_pend: 0, com_canc: 0 },
    meta:    { gasto: 0, cliques: 0 },
    subid:   { comissao: 0, comissao_est: 0, fat: 0, pedidos: 0, qtd_itens: 0 },
    clique:  { cliques: 0 },
  };

  for (const d of dates) {
    const shop = shopeeByDate[d];
    const meta = metaByDate[d];
    const sub = subidByDate[d];
    const cliq = cliqueByDate[d];

    // Acumula totais
    if (shop) {
      totais.shopee.comissao += shop.comissao;
      totais.shopee.fat += shop.fat_bruto;
      totais.shopee.pedidos += shop.pedidos;
      totais.shopee.vendas += shop.vendas;
      totais.shopee.vendas_dir += shop.vendas_diretas;
      totais.shopee.vendas_ind += shop.vendas_indiretas;
      totais.shopee.com_conc += shop.comissao_concluida;
      totais.shopee.com_pend += shop.comissao_pendente;
      totais.shopee.com_canc += shop.comissao_cancelada;
    }
    if (meta) {
      totais.meta.gasto += meta.gasto;
      totais.meta.cliques += meta.cliques;
    }
    if (sub) {
      totais.subid.comissao += sub.comissoes;
      totais.subid.comissao_est += sub.comissoes_est;
      totais.subid.fat += sub.fat;
      totais.subid.pedidos += sub.pedidos;
      totais.subid.qtd_itens += sub.qtd_itens;
    }
    if (cliq) {
      totais.clique.cliques += cliq.cliques;
    }

    // Checa divergências
    const erros = [];

    // shopee_daily vs subid_daily
    if (shop && sub) {
      const deltaCom = roundMoney(sub.comissoes - shop.comissao);
      if (Math.abs(deltaCom) > 1.00) {
        erros.push(`Comissão: shopee_daily=${fmtMoney(shop.comissao)} subid_daily=${fmtMoney(sub.comissoes)} Δ=${fmtMoney(deltaCom)}`);
      }
      const deltaFat = roundMoney(sub.fat - shop.fat_bruto);
      if (Math.abs(deltaFat) > 5.00) {
        erros.push(`Faturamento: shopee_daily=${fmtMoney(shop.fat_bruto)} subid_daily=${fmtMoney(sub.fat)} Δ=${fmtMoney(deltaFat)}`);
      }
      const deltaPed = sub.pedidos - shop.pedidos;
      if (Math.abs(deltaPed) > 2) {
        erros.push(`Pedidos: shopee_daily=${shop.pedidos} subid_daily=${sub.pedidos} Δ=${deltaPed}`);
      }
    } else if (shop && !sub) {
      if (shop.pedidos > 0 || shop.comissao > 0) {
        erros.push(`shopee_daily tem dados mas subid_daily FALTANDO`);
      }
    } else if (!shop && sub) {
      if (sub.pedidos > 0 || sub.comissoes > 0) {
        erros.push(`subid_daily tem dados mas shopee_daily FALTANDO`);
      }
    }

    // Dia faltando shopee
    if (!shop && d < hoje) {
      erros.push(`shopee_daily FALTANDO para ${d}`);
    }

    // Meta — avisa se dia sem meta
    if (!meta && d < hoje) {
      // Não é erro crítico — pode não ter campanha ativa num dia
    }

    if (erros.length > 0) {
      detalhes.push({ data: d, erros });
    } else {
      totalOk++;
    }
  }

  // ── 7) Resultado dia a dia ──
  if (detalhes.length > 0) {
    console.log(`\n  ❌ ${detalhes.length} dia(s) com divergência:\n`);
    for (const { data, erros } of detalhes) {
      console.log(`     📌 ${data}:`);
      for (const e of erros) {
        console.log(`        • ${e}`);
      }
    }
  } else {
    console.log(`\n  ✅ Todos os ${totalOk} dias estão batendo (shopee_daily ↔ subid_daily)!`);
  }

  // ── 8) Resumo Mensal ──
  const tShop = totais.shopee;
  const tMeta = totais.meta;
  const tSub  = totais.subid;
  const tCliq = totais.clique;

  console.log(`\n  ┌──────────────────────────────────────────────────────────────────────┐`);
  console.log(`  │  RESUMO MENSAL ${monthKey}                                              │`);
  console.log(`  ├──────────────────────────────────────────────────────────────────────┤`);
  console.log(`  │                                                                      │`);
  console.log(`  │  📊 SHOPEE_DAILY                                                     │`);
  console.log(`  │    Comissão (estimada): ${padR(fmtMoney(roundMoney(tShop.comissao)), 15)}                            │`);
  console.log(`  │    Concluída: ${padR(fmtMoney(roundMoney(tShop.com_conc)), 12)} Pendente: ${padR(fmtMoney(roundMoney(tShop.com_pend)), 12)} Canc: ${padR(fmtMoney(roundMoney(tShop.com_canc)), 10)} │`);
  console.log(`  │    Faturamento:         ${padR(fmtMoney(roundMoney(tShop.fat)), 15)}                            │`);
  console.log(`  │    Pedidos: ${padR(tShop.pedidos, 6)}  |  Vendas: ${padR(tShop.vendas, 6)}                             │`);
  console.log(`  │    Dir: ${padR(tShop.vendas_dir, 6)}  |  Ind: ${padR(tShop.vendas_ind, 6)}                                │`);
  console.log(`  │                                                                      │`);
  console.log(`  │  📊 SUBID_DAILY (soma de todos subids)                               │`);
  console.log(`  │    Comissão:            ${padR(fmtMoney(roundMoney(tSub.comissao)), 15)}                            │`);
  console.log(`  │    Comissão Estimada:   ${padR(fmtMoney(roundMoney(tSub.comissao_est)), 15)}                            │`);
  console.log(`  │    Faturamento:         ${padR(fmtMoney(roundMoney(tSub.fat)), 15)}                            │`);
  console.log(`  │    Pedidos: ${padR(tSub.pedidos, 6)}  |  Itens: ${padR(tSub.qtd_itens, 6)}                              │`);
  console.log(`  │    SubIDs únicos:       ${padR(subidSubids.size, 6)}                                       │`);
  console.log(`  │                                                                      │`);
  console.log(`  │  📊 META_ADS_DAILY                                                   │`);
  console.log(`  │    Gasto total:         ${padR(fmtMoney(roundMoney(tMeta.gasto)), 15)}                            │`);
  console.log(`  │    Cliques total:       ${padR(tMeta.cliques, 10)}                                  │`);
  console.log(`  │    Dias com dados:      ${padR(Object.keys(metaByDate).length, 4)} / ${dates.length}                                     │`);
  console.log(`  │                                                                      │`);
  console.log(`  │  📊 CLIQUE_DAILY                                                     │`);
  console.log(`  │    Cliques Shopee:      ${padR(tCliq.cliques, 10)}                                  │`);
  console.log(`  │                                                                      │`);
  console.log(`  ├──────────────────────────────────────────────────────────────────────┤`);

  // Deltas
  const dCom = roundMoney(tSub.comissao - tShop.comissao);
  const dFat = roundMoney(tSub.fat - tShop.fat);
  const dPed = tSub.pedidos - tShop.pedidos;
  const statusCom = Math.abs(dCom) < 1.00 ? "✅" : Math.abs(dCom) < 50 ? "⚠️" : "❌";
  const statusFat = Math.abs(dFat) < 5.00 ? "✅" : Math.abs(dFat) < 500 ? "⚠️" : "❌";
  const statusPed = Math.abs(dPed) <= 2 ? "✅" : Math.abs(dPed) < 20 ? "⚠️" : "❌";

  console.log(`  │  DELTAS (subid_daily − shopee_daily)                                 │`);
  console.log(`  │  ${statusCom} Comissão:      ${padR(fmtMoney(dCom), 15)}                                   │`);
  console.log(`  │  ${statusFat} Faturamento:   ${padR(fmtMoney(dFat), 15)}                                   │`);
  console.log(`  │  ${statusPed} Pedidos:       ${padR(dPed, 10)}                                        │`);
  console.log(`  └──────────────────────────────────────────────────────────────────────┘`);

  // ── 9) Top 5 SubIDs por gasto Meta ──
  const topMeta = Object.entries(metaBySubid)
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, 5);

  if (topMeta.length > 0) {
    console.log(`\n  📋 Top 5 SubIDs por gasto Meta:`);
    console.log(`     ${"SubID".padEnd(30)} ${"Gasto".padStart(14)}  ${"Cliques".padStart(8)}`);
    for (const [sid, val] of topMeta) {
      console.log(`     ${sid.padEnd(30)} ${fmtMoney(val.gasto).padStart(14)}  ${String(val.cliques).padStart(8)}`);
    }
  }

  return {
    monthKey,
    ok: detalhes.length === 0,
    divergencias: detalhes.length,
    totais,
    deltas: { dCom, dFat, dPed },
  };
}

// ── Main ──
async function main() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  const hoje = brtToday();

  let months = [];

  if (arg1 && arg2 && /^\d{4}-\d{2}$/.test(arg1) && /^\d{4}-\d{2}$/.test(arg2)) {
    let [y, m] = arg1.split("-").map(Number);
    const [ey, em] = arg2.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  } else if (arg1 && /^\d{4}-\d{2}$/.test(arg1)) {
    months = [arg1];
  } else {
    months = [hoje.slice(0, 7)];
  }

  console.log("\n" + "═".repeat(70));
  console.log("  🧪 TESTE: Shopee + Meta — dados mensais (Supabase, READ-ONLY)");
  console.log(`  📅 Meses: ${months.join(", ")}`);
  console.log(`  🕐 Agora: ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date())} (BRT)`);
  console.log("  ⚠️  NÃO GRAVA NADA — apenas lê e compara tabelas Supabase.");
  console.log("═".repeat(70));

  const resultados = [];
  for (const mk of months) {
    const r = await auditMonth(mk);
    resultados.push(r);
  }

  // ── Veredicto final ──
  console.log("\n" + "═".repeat(70));
  const allOk = resultados.every(r => r.ok);
  const totalDiv = resultados.reduce((s, r) => s + r.divergencias, 0);

  if (allOk) {
    console.log("  ✅ TUDO BATENDO — shopee_daily, subid_daily e meta_ads_daily consistentes!");
  } else {
    console.log(`  ⚠️  ${totalDiv} divergência(s) em: ${resultados.filter(r => !r.ok).map(r => r.monthKey).join(", ")}`);
  }
  console.log("═".repeat(70) + "\n");

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error("\n❌ Erro:", err?.message || err);
  process.exit(2);
});

#!/usr/bin/env node
/**
 * check-shopee-horarios.cjs
 *
 * Consulta a tabela sync_polling_log para mostrar:
 *   1) Histograma: em qual hora BRT a Shopee costuma trazer dados
 *   2) Últimas execuções com dados (nodes > 0)
 *   3) Total de polls nos últimos 7 dias
 */
"use strict";

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
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function main() {
  const dias = Number(process.argv[2] || 7);
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  console.log("\n" + "═".repeat(70));
  console.log(`  📊 SHOPEE — Horários de disponibilidade de dados`);
  console.log(`  📅 Últimos ${dias} dias (desde ${desde.slice(0, 10)})`);
  console.log(`  🕐 Agora: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (BRT)`);
  console.log("═".repeat(70));

  // 1) Verificar se a tabela existe e tem dados
  const { data: allRows, error: allErr } = await supabase
    .from("sync_polling_log")
    .select("*")
    .gte("created_at", desde)
    .order("created_at", { ascending: false });

  if (allErr) {
    console.log(`\n  ❌ Erro ao consultar sync_polling_log: ${allErr.message}`);
    console.log("  💡 A tabela pode não existir ainda. Crie-a com o SQL abaixo:");
    console.log(`
      CREATE TABLE IF NOT EXISTS sync_polling_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        plataforma TEXT NOT NULL,
        label TEXT,
        nodes INTEGER DEFAULT 0,
        duracao_ms INTEGER,
        hora_brt INTEGER,
        dia_semana INTEGER,
        veio_com_dado BOOLEAN GENERATED ALWAYS AS (nodes > 0) STORED
      );
    `);
    process.exit(1);
  }

  if (!allRows || allRows.length === 0) {
    console.log("\n  ⚠️  Nenhum registro encontrado na sync_polling_log.");
    console.log("  💡 O detector ainda não teve tempo de acumular dados.");
    console.log("     Aguarde alguns dias de operação do sync para ver os horários.");
    process.exit(0);
  }

  console.log(`\n  📊 Total de registros nos últimos ${dias} dias: ${allRows.length}`);

  // Separar por plataforma
  const shopeeRows = allRows.filter(r => r.plataforma === "shopee");
  const metaRows = allRows.filter(r => r.plataforma === "meta");

  console.log(`     → Shopee: ${shopeeRows.length} polls`);
  console.log(`     → Meta:   ${metaRows.length} polls`);

  // 2) Shopee — polls com dados (nodes > 0)
  const shopeeComDados = shopeeRows.filter(r => Number(r.nodes || 0) > 0);
  console.log(`\n  ── SHOPEE — ${shopeeComDados.length} polls COM dados (de ${shopeeRows.length} total) ──`);

  if (shopeeComDados.length > 0) {
    // Histograma por hora BRT
    const histograma = {};
    for (let h = 0; h < 24; h++) histograma[h] = 0;
    for (const r of shopeeComDados) {
      const hora = Number(r.hora_brt ?? -1);
      if (hora >= 0 && hora < 24) histograma[hora]++;
    }

    console.log("\n  📈 Histograma — Em qual hora BRT a Shopee trouxe dados:");
    console.log("  " + "─".repeat(50));
    const maxCount = Math.max(...Object.values(histograma), 1);
    for (let h = 0; h < 24; h++) {
      const count = histograma[h];
      const bar = "█".repeat(Math.round((count / maxCount) * 30));
      const label = count > 0 ? ` ${count}x` : "";
      console.log(`  ${String(h).padStart(2, "0")}h  ${bar}${label}`);
    }

    // Últimas 15 execuções com dados
    console.log("\n  📋 Últimas execuções COM dados:");
    console.log("  " + "─".repeat(60));
    console.log("  Data/Hora (UTC)            Label                    Nodes  Duração");
    for (const r of shopeeComDados.slice(0, 15)) {
      const dt = r.created_at ? new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
      const label = (r.label || "—").padEnd(24).slice(0, 24);
      const nodes = String(r.nodes || 0).padStart(6);
      const dur = r.duracao_ms ? `${(r.duracao_ms / 1000).toFixed(1)}s` : "—";
      console.log(`  ${dt}   ${label} ${nodes}  ${dur}`);
    }

    // Padrão detectado
    const horasAtivas = Object.entries(histograma)
      .filter(([, c]) => c > 0)
      .sort(([, a], [, b]) => b - a);
    
    if (horasAtivas.length > 0) {
      console.log("\n  🎯 Padrão detectado:");
      console.log(`     Horas mais frequentes: ${horasAtivas.slice(0, 5).map(([h, c]) => `${h}h (${c}x)`).join(", ")}`);
      const horaPico = horasAtivas[0][0];
      console.log(`     → A Shopee costuma publicar dados mais frequentemente por volta das ${horaPico}h BRT`);
    }
  } else {
    console.log("  ⚠️  Nenhum poll trouxe dados ainda. Aguarde mais dias.");
  }

  // 3) Análise por dia da semana
  if (shopeeComDados.length > 0) {
    const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const porDiaSemana = {};
    for (let d = 0; d < 7; d++) porDiaSemana[d] = 0;
    for (const r of shopeeComDados) {
      const ds = Number(r.dia_semana ?? -1);
      if (ds >= 0 && ds < 7) porDiaSemana[ds]++;
    }

    console.log("\n  📅 Por dia da semana:");
    for (let d = 0; d < 7; d++) {
      const bar = "█".repeat(porDiaSemana[d] * 3);
      console.log(`     ${diasSemana[d]}: ${bar} ${porDiaSemana[d]}x`);
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log("  CONSULTA COMPLETA.");
  console.log("═".repeat(70) + "\n");
}

main().catch(err => {
  console.error("\n❌ Erro:", err?.message || err);
  process.exit(2);
});

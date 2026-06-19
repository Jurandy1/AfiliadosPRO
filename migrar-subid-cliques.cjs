#!/usr/bin/env node
const path = require("path");
const ROOT = process.cwd();
const admin = require(path.join(ROOT, "functions", "node_modules", "firebase-admin"));
const { createClient } = require("@supabase/supabase-js");

// 1) Configurar Firebase
const serviceAccount = require(path.join(ROOT, "serviceAccountKey.json"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

// 2) Configurar Supabase
// (Chave de service_role para ter permissão de bypass RLS em migrações)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://emlsrzqgftoyslharcqd.supabase.co";
const fs = require("fs");
const envPath = path.resolve(ROOT, ".env.local");
let VITE_SUPABASE_URL = "";
let VITE_SUPABASE_ANON_KEY = "";
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf8");
  const matchUrl = envFile.match(/VITE_SUPABASE_URL=([^\s]+)/);
  if (matchUrl) VITE_SUPABASE_URL = matchUrl[1];
  const matchKey = envFile.match(/VITE_SUPABASE_ANON_KEY=([^\s]+)/);
  if (matchKey) VITE_SUPABASE_ANON_KEY = matchKey[1];
}

const url = VITE_SUPABASE_URL || SUPABASE_URL;
const key = VITE_SUPABASE_ANON_KEY || "COLOQUE_A_CHAVE_SE_FALTAR";

const supabase = createClient(url, key);

const SUBID_COLS = new Set([
  'data', 'subid', 'comissoes', 'comissoes_estimadas', 'faturamento',
  'vendas_diretas', 'vendas_indiretas', 'qtd_itens', 'total_vendas',
  'pedidos', 'cliques_anuncio', 'cliques_shopee', 'ultima_sync'
]);

const CLIQUE_COLS = new Set([
  'data', 'subid', 'item_id', 'cliques', 'cliques_unicos', 'ultima_sync'
]);

async function upsertBatch(tabela, rows) {
  if (!rows || rows.length === 0) return;
  const BATCH_SIZE = 1000;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(tabela).upsert(chunk);
    if (error) {
      console.error(`Erro ao upsertar ${tabela}:`, error.message);
    } else {
      console.log(`Upsert ${tabela}: ${i + chunk.length}/${rows.length}`);
    }
  }
}

async function migrarColecao(colName, allowedCols) {
  console.log(`Lendo ${colName} do Firestore...`);
  const snap = await db.collection(colName).get();
  console.log(`Total de documentos em ${colName}: ${snap.size}`);

  const rows = [];
  snap.forEach(doc => {
    const data = doc.data();
    const row = {};
    for (const key of allowedCols) {
      if (data[key] !== undefined) {
        row[key] = data[key];
      }
    }
    
    // Sanitizações específicas
    if (colName === "subid_daily") {
      row.qtd_itens = Math.round(Number(row.qtd_itens || 0));
      row.vendas_diretas = Math.round(Number(row.vendas_diretas || 0));
      row.vendas_indiretas = Math.round(Number(row.vendas_indiretas || 0));
      row.total_vendas = Math.round(Number(row.total_vendas || 0));
      row.pedidos = Math.round(Number(row.pedidos || 0));
      row.cliques_anuncio = Math.round(Number(row.cliques_anuncio || 0));
      row.cliques_shopee = Math.round(Number(row.cliques_shopee || 0));
      row.comissoes = Number(row.comissoes || 0);
      row.comissoes_estimadas = Number(row.comissoes_estimadas || 0);
      row.faturamento = Number(row.faturamento || 0);
    } else if (colName === "clique_daily") {
      row.cliques = Math.round(Number(row.cliques || 0));
      row.cliques_unicos = Math.round(Number(row.cliques_unicos || 0));
      if (!row.item_id) row.item_id = "0";
    }

    // Assegurar campos nulos onde necessário se quiser
    if (!row.ultima_sync) row.ultima_sync = new Date().toISOString();
    rows.push(row);
  });

  if (rows.length > 0) {
    console.log(`Iniciando envio para o Supabase tabela ${colName}...`);
    await upsertBatch(colName, rows);
    console.log(`Migração de ${colName} finalizada!\n`);
  } else {
    console.log(`${colName} estava vazia.\n`);
  }
}

async function run() {
  console.log("Iniciando migração (Firebase -> Supabase) de subid_daily e clique_daily\n");
  try {
    await migrarColecao("subid_daily", SUBID_COLS);
    await migrarColecao("clique_daily", CLIQUE_COLS);
    console.log("Migração completa!");
  } catch (err) {
    console.error("Falha na migração:", err);
  }
}

run();

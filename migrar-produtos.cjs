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

const PRODUTOS_COLS = new Set([
  'doc_id',             'id_item',
  'id_loja',            'loja',
  'link_shopee',        'link_afiliado',
  'plataforma',         'fonte',
  'categoria',          'nome',
  'preco',              'vendas',
  'vendas_diretas',     'vendas_indiretas',
  'cliques',            'gmv',
  'gmv_total',          'comissao_pct',
  'comissao_total',     'comissao_estimada',
  'comissao_concluida', 'comissao_pendente',
  'comissao_cancelada', 'pedidos_concluidos',
  'pedidos_pendentes',  'pedidos_cancelados',
  'fraud_status',       'display_item_status',
  'item_notes',         'unverified_count',
  'fraud_count',        'risco_api_updated_at',
  'sub_ids',            'canais',
  'importacao_id',      'importado_em',
  'updated_at'
]);

async function upsertBatch(tabela, rows) {
  if (!rows || rows.length === 0) return;
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(tabela).upsert(chunk);
    if (error) {
      console.error(`Erro ao upsertar ${tabela}:`, error.message);
    } else {
      console.log(`Upsert ${tabela}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
    }
  }
}

function asISO(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate().toISOString();
  if (val._seconds) return new Date(val._seconds * 1000).toISOString();
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return null;
}

async function migrarColecao(colName, supabaseName, allowedCols) {
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
    
    // Mapeamentos específicos
    row.doc_id = doc.id;
    row.id_item = String(data.itemId || data.id_item || doc.id.replace("item_", ""));
    row.id_loja = String(data.shopId || data.id_loja || "0");
    
    // Sanitização de numéricos
    row.preco = Number(row.preco || 0);
    row.vendas = Math.round(Number(row.vendas || 0));
    row.vendas_diretas = Math.round(Number(row.vendas_diretas || 0));
    row.vendas_indiretas = Math.round(Number(row.vendas_indiretas || 0));
    row.cliques = Math.round(Number(row.cliques || 0));
    row.gmv = Number(row.gmv || 0);
    row.gmv_total = Number(row.gmv_total || 0);
    row.comissao_pct = Number(row.comissao_pct || 0);
    row.comissao_total = Number(row.comissao_total || 0);
    row.comissao_estimada = Number(row.comissao_estimada || 0);
    
    // Novas numéricas
    row.comissao_concluida = Number(data.comissao_concluida || 0);
    row.comissao_pendente = Number(data.comissao_pendente || 0);
    row.comissao_cancelada = Number(data.comissao_cancelada || 0);
    row.pedidos_concluidos = Math.round(Number(data.pedidos_concluidos || 0));
    row.pedidos_pendentes = Math.round(Number(data.pedidos_pendentes || 0));
    row.pedidos_cancelados = Math.round(Number(data.pedidos_cancelados || 0));
    row.unverified_count = Math.round(Number(data.unverified_count || 0));
    row.fraud_count = Math.round(Number(data.fraud_count || 0));

    // Timestamps
    row.importado_em = asISO(data.importado_em) || null;
    row.updated_at = asISO(data.updated_at) || new Date().toISOString();
    row.risco_api_updated_at = asISO(data.risco_api_updated_at) || null;
    
    rows.push(row);
  });

  if (rows.length > 0) {
    console.log(`Iniciando envio para o Supabase tabela ${supabaseName}...`);
    await upsertBatch(supabaseName, rows);
    console.log(`Migração de ${colName} -> ${supabaseName} finalizada!\n`);
  } else {
    console.log(`${colName} estava vazia.\n`);
  }
}

async function run() {
  console.log("Iniciando migração (Firebase -> Supabase) de produtos\n");
  try {
    await migrarColecao("produtos", "produtos", PRODUTOS_COLS);
    console.log("Migração completa!");
  } catch (err) {
    console.error("Falha na migração:", err);
  }
}

run();

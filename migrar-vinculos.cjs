#!/usr/bin/env node
const path = require("path");
const ROOT = process.cwd();
const admin = require(path.join(ROOT, "functions", "node_modules", "firebase-admin"));
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

// Firebase
const serviceAccount = require(path.join(ROOT, "serviceAccountKey.json"));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// Supabase
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
const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY);

async function run() {
  console.log("Lendo produtos com vínculos no Firestore...");
  const snap = await db.collection("produtos").get();
  console.log(`Total docs: ${snap.size}`);

  const updates = [];
  snap.forEach(doc => {
    const data = doc.data();
    const metaAdIds = Array.isArray(data.metaAdIds) ? data.metaAdIds : [];
    const pinterestAdIds = Array.isArray(data.pinterestAdIds) ? data.pinterestAdIds : [];
    const investimento = Number(data.investimento || 0);

    // Só migra se tem algum vínculo (skip docs sem ads)
    if (metaAdIds.length === 0 && pinterestAdIds.length === 0 && investimento === 0) return;

    updates.push({
      doc_id: doc.id,
      meta_ad_ids: metaAdIds,
      pinterest_ad_ids: pinterestAdIds,
      investimento,
    });
  });

  console.log(`Produtos com vínculos a migrar: ${updates.length}`);

  // Update em lote
  const BATCH = 100;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    for (const u of chunk) {
      const { error } = await supabase
        .from("produtos")
        .update({
          meta_ad_ids: u.meta_ad_ids,
          pinterest_ad_ids: u.pinterest_ad_ids,
          investimento: u.investimento,
          updated_at: new Date().toISOString(),
        })
        .eq("doc_id", u.doc_id);
      if (error) {
        fail++;
        console.error(`Falha em ${u.doc_id}:`, error.message);
      } else {
        ok++;
      }
    }
    console.log(`Progresso: ${ok + fail}/${updates.length} (ok=${ok}, fail=${fail})`);
  }

  console.log(`\nFinalizado. ${ok} produtos atualizados, ${fail} falhas.`);
}

run().catch(e => {
  console.error("Erro fatal:", e);
  process.exit(1);
});

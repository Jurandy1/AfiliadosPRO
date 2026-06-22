const fs = require('fs');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const { syncToSupabase } = require('./lib/supabaseSync');

const txt = fs.readFileSync('../.env.local', 'utf8') || fs.readFileSync('../.env', 'utf8');
const env = {};
txt.split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"]/g, '');
});

const sa = JSON.parse(fs.readFileSync('./serviceAccountKey.json.DESABILITADO', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });

const sup = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const start = '2026-06-12';
  const end = '2026-06-21';
  
  console.log(`[1/3] Limpando Supabase entre ${start} e ${end}...`);
  await sup.from('shopee_daily').delete().gte('data', start).lte('data', end);
  await sup.from('subid_daily').delete().gte('data', start).lte('data', end);
  await sup.from('produto_daily').delete().gte('data', start).lte('data', end);
  
  console.log(`[2/3] Lendo do Firestore entre ${start} e ${end}...`);
  const collections = ['shopee_daily', 'subid_daily', 'produto_daily', 'meta_ads_daily'];
  const dataToSync = {};
  
  for (const coll of collections) {
    const snap = await admin.firestore().collection(coll).where('data', '>=', start).where('data', '<=', end).get();
    dataToSync[coll] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    console.log(`  - ${coll}: ${snap.docs.length} docs`);
  }
  
  console.log(`[3/3] Sincronizando (Dual-Write) para Supabase...`);
  await syncToSupabase(sup, dataToSync, []);
  console.log('Finalizado com sucesso!');
}
run().catch(console.error);

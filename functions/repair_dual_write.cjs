const admin = require('firebase-admin');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { syncToSupabase } = require('./lib/supabaseSync');

const txt = fs.existsSync('../.env.local') ? fs.readFileSync('../.env.local', 'utf8') : fs.readFileSync('../.env', 'utf8');
const env = {};
txt.split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"]/g, '');
});

const sa = JSON.parse(fs.readFileSync('./serviceAccountKey.json.DESABILITADO', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });

const sup = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const collections = ['shopee_daily', 'meta_ads_daily', 'subid_daily', 'produto_daily'];
  const dataToSync = {};
  
  for (const coll of collections) {
    const snap = await admin.firestore().collection(coll).where('data', '>=', '2026-06-15').get();
    dataToSync[coll] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  }
  
  await syncToSupabase(sup, dataToSync, []);
  console.log('Dual-write manual repair finished!');
  process.exit(0);
}
run().catch(console.error);

const admin = require('firebase-admin');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

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
  const shopee = await admin.firestore().collection('sync_state').doc('shopee_health').get();
  const meta = await admin.firestore().collection('sync_state').doc('meta_health').get();

  const clean = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(clean);
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.toDate === 'function') {
        res[k] = v.toDate().toISOString();
      } else {
        res[k] = clean(v);
      }
    }
    return res;
  };

  await sup.from('sync_state').upsert([
    { id: 'shopee_health', data_blob: clean(shopee.data()) },
    { id: 'meta_health', data_blob: clean(meta.data()) }
  ]);
  console.log('Migrated sync_state to Supabase!');
  process.exit(0);
}
run().catch(console.error);

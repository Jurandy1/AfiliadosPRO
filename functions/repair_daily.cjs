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
  const cliqueSnap = await admin.firestore().collection('clique_daily').where('data', '>=', '2026-06-15').get();
  const cliqueRows = cliqueSnap.docs.map(d => {
    const data = d.data();
    return {
      data: data.data,
      subid: data.subid || '(sem_subid)',
      item_id: data.item_id || 'total',
      cliques: data.cliques || 0,
      ultima_sync: new Date().toISOString()
    };
  });
  if (cliqueRows.length) {
    for(let i=0; i<cliqueRows.length; i+=500) {
      const { error } = await sup.from('clique_daily').upsert(cliqueRows.slice(i, i+500), { onConflict: 'data,subid,item_id' });
      if (error) console.error('clique error:', error);
    }
    console.log('clique_daily fixed! rows:', cliqueRows.length);
  }
  process.exit(0);
}
run().catch(console.error);

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const txt = fs.readFileSync('../.env.local', 'utf8') || fs.readFileSync('../.env', 'utf8');
const env = {};
txt.split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"]/g, '');
});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const date = '2026-06-21';
  
  const { data: sd } = await s.from('shopee_daily').select('*').eq('data', date).single();
  const { data: subids } = await s.from('subid_daily').select('*').eq('data', date);
  
  const sumSubid = subids.reduce((acc, row) => acc + (row.comissoes || 0), 0);
  
  console.log(`[Supabase] shopee_daily comissao_total: ${sd?.comissao_total}`);
  console.log(`[Supabase] shopee_daily comissao_pendente: ${sd?.comissao_pendente}`);
  console.log(`[Supabase] Soma subid_daily comissoes: ${sumSubid.toFixed(2)}`);
  
  // Let's also check Firestore just to see if the drift is in Firestore as well.
  const admin = require('firebase-admin');
  const sa = JSON.parse(fs.readFileSync('./serviceAccountKey.json.DESABILITADO', 'utf8'));
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
  
  const fireSd = await admin.firestore().collection('shopee_daily').where('data', '==', date).get();
  const fireSub = await admin.firestore().collection('subid_daily').where('data', '==', date).get();
  
  const fireSdData = fireSd.docs.map(d => d.data())[0];
  const sumFireSub = fireSub.docs.reduce((acc, d) => acc + (d.data().comissoes || 0), 0);
  
  console.log(`[Firestore] shopee_daily comissao_total: ${fireSdData?.comissao_total}`);
  console.log(`[Firestore] Soma subid_daily comissoes: ${sumFireSub.toFixed(2)}`);
  
  console.log(`Supabase rows: ${subids.length}, Firestore rows: ${fireSub.docs.length}`);
}
run().catch(console.error);

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const txt = fs.existsSync('../.env.local') ? fs.readFileSync('../.env.local', 'utf8') : fs.readFileSync('../.env', 'utf8');
const env = {};
txt.split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"]/g, '');
});

const s = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const today = '2026-06-22';
  const yesterday = '2026-06-21';
  const { data: shopee } = await s.from('shopee_daily').select('*').in('data', [today, yesterday]);
  console.log(`Shopee Daily for ${yesterday} and ${today}:`, shopee);
  
  const { data: syncState } = await s.from('sync_state').select('id, data_blob');
  console.log('Sync State:', JSON.stringify(syncState, null, 2));
}
run().catch(console.error);

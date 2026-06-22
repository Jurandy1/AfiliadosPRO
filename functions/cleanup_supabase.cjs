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
  console.log(`Deletando dados do Supabase para ${date}...`);
  await s.from('shopee_daily').delete().eq('data', date);
  await s.from('subid_daily').delete().eq('data', date);
  await s.from('produto_daily').delete().eq('data', date);
  console.log('Limpeza concluída!');
}
run().catch(console.error);

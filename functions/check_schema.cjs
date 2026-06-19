const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const txt = fs.existsSync('../.env.local') ? fs.readFileSync('../.env.local', 'utf8') : fs.readFileSync('../.env', 'utf8');
const env = {};
txt.split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0) env[l.substring(0, i).trim()] = l.substring(i + 1).trim().replace(/['"]/g, '');
});

const sup = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const collections = ['shopee_daily', 'meta_ads_daily', 'subid_daily', 'produto_daily'];
  for (const coll of collections) {
    const { data } = await sup.from(coll).select('*').limit(1);
    console.log(coll, 'cols in Supabase:', Object.keys(data[0] || {}));
  }
  process.exit(0);
}
run().catch(console.error);

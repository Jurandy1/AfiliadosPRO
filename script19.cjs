const fs = require('fs');
const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
let env = {};
for (const line of lines) {
  const m = line.match(/^VITE_SUPABASE_(URL|ANON_KEY)=(.*)/);
  if (m) env['VITE_SUPABASE_' + m[1]] = m[2].trim();
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const tables = ['meta_ads_daily', 'subid_daily', 'subid_vendas', 'produto_daily', 'produto_mensal', 'log_perdas', 'garimpo_alertas'];
  for (const t of tables) {
    const { error: insErr } = await supabase.from(t).insert({}).select('*');
    if (insErr && insErr.code === '23502') {
       const m = insErr.message.match(/column "(.*?)"/);
       console.log(t, 'PK:', m ? m[1] : insErr.message);
    } else {
       console.log(t, 'Error:', JSON.stringify(insErr));
    }
  }
}
run();

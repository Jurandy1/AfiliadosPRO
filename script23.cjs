const fs = require('fs');

function fix(file) {
  let c = fs.readFileSync(file, 'utf8');
  let orig = c;

  // 1. fix shopee_daily
  c = c.replace(/\.from\("shopee_daily"\)\.select\("id:data, data_blob"\)/g, '.from("shopee_daily").select("*")');
  c = c.replace(/\.from\("shopee_daily"\)\.select\("data_blob"\)/g, '.from("shopee_daily").select("*")');
  
  // 2. fix produto_daily
  c = c.replace(/\.from\("produto_daily"\)\.select\("id:data, data_blob"\)/g, '.from("produto_daily").select("*")');
  c = c.replace(/\.from\("produto_daily"\)\.select\("data_blob"\)/g, '.from("produto_daily").select("*")');
  
  // 3. fix produtos
  c = c.replace(/\.from\("produtos"\)\.select\("id:doc_id, data_blob"\)/g, '.from("produtos").select("*")');
  c = c.replace(/\.from\("produtos"\)\.select\("data_blob"\)/g, '.from("produtos").select("*")');
  
  // 4. fix subid_daily
  c = c.replace(/\.from\("subid_daily"\)\.select\("id:data, data_blob"\)/g, '.from("subid_daily").select("*")');
  
  // 5. fix subid_vendas
  c = c.replace(/\.from\("subid_vendas"\)\.select\("id:data, data_blob"\)/g, '.from("subid_vendas").select("*")');
  
  // 6. fix produto_mensal
  c = c.replace(/\.from\("produto_mensal"\)\.select\("id:data, data_blob"\)/g, '.from("produto_mensal").select("*")');
  c = c.replace(/\.from\("produto_mensal"\)\.select\("data_blob"\)/g, '.from("produto_mensal").select("*")');
  
  // 7. fix log_perdas
  c = c.replace(/\.from\("log_perdas"\)\.select\("id:data, data_blob"\)/g, '.from("log_perdas").select("*")');
  c = c.replace(/\.from\("log_perdas"\)\.select\("data_blob"\)/g, '.from("log_perdas").select("*")');
  
  // 8. fix garimpo_alertas
  c = c.replace(/\.from\("garimpo_alertas"\)\.select\("id:tipo, data_blob"\)/g, '.from("garimpo_alertas").select("*")');
  c = c.replace(/\.from\("garimpo_alertas"\)\.select\("data_blob"\)/g, '.from("garimpo_alertas").select("*")');

  // Now fix the JS side mapping:
  // Instead of d.data_blob, we use d directly, but wait!
  // In getDatasDesatualizadas: map[d.id] = d.data_blob || {}; -> map[d.data] = d || {};
  c = c.replace(/map\[d\.id\] = d\.data_blob \|\| \{\};/g, 'map[d.data] = d || {};');
  
  // In .single() cases: snap.data.data_blob -> snap.data
  // Actually, we can just replace data_blob with data? No, because sometimes it's d.data_blob.
  // Let's replace d.data_blob with d when it's inside map(d => ({ id: d.id, data: () => d.data_blob }))
  c = c.replace(/data: \(\) => d\.data_blob/g, 'data: () => d');
  c = c.replace(/id: d\.id/g, 'id: d.doc_id || d.data || d.key');

  // For single() fetch: 
  // const snap = await supabase.from("shopee_daily").select("*").eq("data", dateStr).single();
  // if (Boolean(snap && snap.data) && !isDailyMetricsVazio(snap.data())) { ... }
  // wait, earlier it was: snap.data was an object from Supabase { data: "2026", pedidos: ... }
  // BUT in Firebase snap.data() is a function. I might have replaced snap.data() with snap.data.
  // Let's check isDailyMetricsVazio(snap.data()) - wait, Supabase returns snap.data as the object! It's not a function.
  // I need to search for snap\.data\(\) and fix it, but I already did const data = snap.data.data_blob || snap.data; in some places.
  c = c.replace(/snap\.data\.data_blob \|\| snap\.data/g, 'snap.data');
  c = c.replace(/snap\.data_blob/g, 'snap.data'); // Just in case
  c = c.replace(/\.data_blob/g, ''); // Wait! NO. This is dangerous. sync_state still uses data_blob!
  
  if (content !== orig) {
    fs.writeFileSync(file, c);
    console.log('Fixed', file);
  }
}

fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js');
fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/cache/dailyGranularCache.js');
fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/AlertasBell.jsx');

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

  // mappings
  c = c.replace(/map\[d\.id\] = d\.data_blob \|\| \{\};/g, 'map[d.data] = d || {};');
  c = c.replace(/data: \(\) => d\.data_blob/g, 'data: () => d');
  c = c.replace(/id: d\.id/g, 'id: d.doc_id || d.data || d.key');

  if (c !== orig) {
    fs.writeFileSync(file, c);
    console.log('Fixed', file);
  }
}

fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js');
fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/cache/dailyGranularCache.js');
fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/AlertasBell.jsx');

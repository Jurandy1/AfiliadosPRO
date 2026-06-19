const fs = require('fs');

function fixFile(file) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Aliases for selects
  content = content.replace(/\.from\("produtos"\)\.select\("id, data_blob"\)/g, '.from("produtos").select("id:doc_id, data_blob")');
  content = content.replace(/\.from\("produtos"\)\.select\("data_blob"\)/g, '.from("produtos").select("data_blob")'); // no id needed
  content = content.replace(/\.from\("produtos"\)\.eq\("id",/g, '.from("produtos").eq("doc_id",');
  content = content.replace(/\.from\("produtos"\)\.in\("id",/g, '.from("produtos").in("doc_id",');

  content = content.replace(/\.from\("shopee_daily"\)\.select\("id, data_blob"\)/g, '.from("shopee_daily").select("id:data, data_blob")');
  content = content.replace(/\.from\("shopee_daily"\)\.select\("data_blob"\)/g, '.from("shopee_daily").select("data_blob")');
  content = content.replace(/\.from\("shopee_daily"\)\.eq\("id",/g, '.from("shopee_daily").eq("data",');
  content = content.replace(/\.from\("shopee_daily"\)\.gte\("id",/g, '.from("shopee_daily").gte("data",');
  content = content.replace(/\.from\("shopee_daily"\)\.lte\("id",/g, '.from("shopee_daily").lte("data",');

  content = content.replace(/\.from\("sync_state"\)\.select\("id, data_blob"\)/g, '.from("sync_state").select("id:key, data_blob")');
  content = content.replace(/\.from\("sync_state"\)\.select\("data_blob"\)/g, '.from("sync_state").select("data_blob")');
  content = content.replace(/\.from\("sync_state"\)\.eq\("id",/g, '.from("sync_state").eq("key",');

  content = content.replace(/\.from\("produto_daily"\)\.select\("id, data_blob"\)/g, '.from("produto_daily").select("id:data, data_blob")');
  content = content.replace(/\.from\("produto_daily"\)\.select\("data_blob"\)/g, '.from("produto_daily").select("data_blob")');
  content = content.replace(/\.from\("produto_daily"\)\.eq\("id",/g, '.from("produto_daily").eq("data",');

  content = content.replace(/\.from\("subid_daily"\)\.select\("id, data_blob"\)/g, '.from("subid_daily").select("id:data, data_blob")');
  
  content = content.replace(/\.from\("subid_vendas"\)\.select\("id, data_blob"\)/g, '.from("subid_vendas").select("id:data, data_blob")');
  content = content.replace(/\.from\("subid_vendas"\)\.in\("id",/g, '.from("subid_vendas").in("data",');

  content = content.replace(/\.from\("produto_mensal"\)\.select\("id, data_blob"\)/g, '.from("produto_mensal").select("id:data, data_blob")');
  content = content.replace(/\.from\("produto_mensal"\)\.select\("data_blob"\)/g, '.from("produto_mensal").select("data_blob")');
  content = content.replace(/\.from\("produto_mensal"\)\.eq\("id",/g, '.from("produto_mensal").eq("data",');

  content = content.replace(/\.from\("log_perdas"\)\.select\("id, data_blob"\)/g, '.from("log_perdas").select("id:data, data_blob")');
  
  content = content.replace(/\.from\("garimpo_alertas"\)\.select\("id, data_blob"\)/g, '.from("garimpo_alertas").select("id:tipo, data_blob")');
  content = content.replace(/\.from\("garimpo_alertas"\)\.select\("data_blob"\)/g, '.from("garimpo_alertas").select("data_blob")');
  content = content.replace(/\.from\("garimpo_alertas"\)\.eq\("id",/g, '.from("garimpo_alertas").eq("tipo",');

  // Any raw supabase updates
  content = content.replace(/await supabase.from\("(.*?)"\)\.update\(\{(.*?)\}\)\.eq\("id", (.*?)\)/g, (match, table, updates, idVar) => {
     let pk = "id";
     if(table==="produtos") pk="doc_id";
     else if(table==="shopee_daily"||table==="produto_daily"||table==="meta_ads_daily"||table==="subid_daily"||table==="produto_mensal"||table==="subid_vendas") pk="data";
     else if(table==="sync_state") pk="key";
     else if(table==="garimpo_alertas") pk="tipo";
     return 'await supabase.from("'+table+'").update({'+updates+'}).eq("'+pk+'", '+idVar+')';
  });

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  }
}

fixFile('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js');
fixFile('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/cache/dailyGranularCache.js');
fixFile('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/cache/dataVersions.js');
fixFile('C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/AlertasBell.jsx');

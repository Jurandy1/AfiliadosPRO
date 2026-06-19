const fs = require('fs');

function fix(file) {
  let content = fs.readFileSync(file, 'utf8');
  let orig = content;
  
  content = content.replace(/supabase\.from\("sync_state"\)\.select\("data_blob"\)\.eq\("id",/g, 'supabase.from("sync_state").select("data_blob").eq("key",');
  
  if (content !== orig) {
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  }
}

fix('C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/cache/dataVersions.js');

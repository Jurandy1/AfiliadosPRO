const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js';
let content = fs.readFileSync(file, 'utf8');

// Replace imports
const firebaseImportRegex = /import\s*\{[\s\S]*?\}\s*from\s*"firebase\/firestore";/;
content = content.replace(firebaseImportRegex, 'import { supabase } from "../../../services/supabase/client";\nconst documentId = () => "id";');
content = content.replace(/import { db } from "..\/..\/..\/services\/firebase\/client";\n/, '');

// Replace getDoc
content = content.replace(/await getDoc\(doc\(db, "sync_state", "shopee_health"\)\)/g, 'await supabase.from("sync_state").select("data_blob").eq("id", "shopee_health").single()');
content = content.replace(/await getDoc\(doc\(db, "sync_state", "meta_health"\)\)/g, 'await supabase.from("sync_state").select("data_blob").eq("id", "meta_health").single()');
content = content.replace(/await getDoc\(doc\(db, "produto_mensal", monthKey\)\)/g, 'await supabase.from("produto_mensal").select("data_blob").eq("id", monthKey).single()');
content = content.replace(/await getDoc\(doc\(db, "shopee_daily", dateStr\)\)/g, 'await supabase.from("shopee_daily").select("data_blob").eq("id", dateStr).single()');
content = content.replace(/await getDoc\(ref\)/g, 'await supabase.from("shopee_daily").select("data_blob").eq("id", hojeStr).single()');

// Replace exist() checks
content = content.replace(/snap\.exists\(\)/g, 'Boolean(snap && snap.data)');
content = content.replace(/shopeeSnap\?\.exists\?\.\(\) \? shopeeSnap\.data\(\)\?\.dataVersion : 0/g, 'shopeeSnap?.data ? shopeeSnap.data.data_blob?.dataVersion : 0');
content = content.replace(/metaSnap\?\.exists\?\.\(\) \? \(metaSnap\.data\(\) \|\| \{\}\) : \{\}/g, 'metaSnap?.data ? (metaSnap.data.data_blob || {}) : {}');
content = content.replace(/snap\?\.exists\?\.\(\) \? snap\.data\(\) : null/g, 'snap?.data ? snap.data.data_blob : null');
content = content.replace(/const data = snap\.data\(\);/g, 'const data = snap.data.data_blob || snap.data;');

fs.writeFileSync(file, content);
console.log('Replacements done');

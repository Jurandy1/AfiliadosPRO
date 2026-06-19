const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/AlertasBell.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace imports
content = content.replace(/import { doc, updateDoc } from "firebase\/firestore";\n/, 'import { supabase } from "../services/supabase/client";\n');
content = content.replace(/import { db } from "..\/services\/firebase\/client";\n/, '');

// Replace updateDoc
content = content.replace(/await updateDoc\(doc\(db, "garimpo_alertas", id\), \{ lido: true \}\);/g, 'await supabase.from("garimpo_alertas").update({ data_blob: { lido: true } }).eq("id", id); // simplificado');
content = content.replace(/await updateDoc\(doc\(db, "garimpo_alertas", id\), \{ arquivado: true \}\);/g, 'await supabase.from("garimpo_alertas").update({ data_blob: { arquivado: true } }).eq("id", id); // simplificado');

fs.writeFileSync(file, content);
console.log('Done AlertasBell');

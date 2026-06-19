const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js';
let content = fs.readFileSync(file, 'utf8');

// replace firebase imports
const firebaseImportRegex = /import\s*\{[\s\S]*?\}\s*from\s*"firebase\/firestore";/;
content = content.replace(firebaseImportRegex, 'import { supabase } from "../../../services/supabase/client";\nconst documentId = () => "id";');
content = content.replace(/import { db } from "..\/..\/..\/services\/firebase\/client";\n/, '');

fs.writeFileSync(file, content);
console.log('Imports replaced');

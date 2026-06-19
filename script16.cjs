const fs = require('fs');

const file1 = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/shopee/repositories/produtosCache.js';
let c1 = fs.readFileSync(file1, 'utf8');
c1 = c1.replace(/import \{ trackCacheHit \} from "\.\.\/\.\.\/\.\.\/services\/firebase\/readTracker";\n/g, '');
c1 = c1.replace(/trackCacheHit\(\{[\s\S]*?\}\);\n/g, '');
fs.writeFileSync(file1, c1);

const file2 = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/diagnostics/FirestoreReadDiagnostics.jsx';
let c2 = fs.readFileSync(file2, 'utf8');
c2 = c2.replace(/import \{.*\} from "\.\.\/services\/firebase\/readTracker";\n/g, '');
fs.writeFileSync(file2, c2);


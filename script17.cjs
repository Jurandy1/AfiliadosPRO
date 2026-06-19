const fs = require('fs');
const file2 = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/diagnostics/FirestoreReadDiagnostics.jsx';
let c2 = fs.readFileSync(file2, 'utf8');
c2 = c2.replace(/import \{.*\} from "\.\.\/\.\.\/services\/firebase\/readTracker";\n/g, '');
fs.writeFileSync(file2, c2);

const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/diagnostics/FirestoreReadDiagnostics.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/import \{ .* \} from "\.\.\/\.\.\/services\/firebase\/readTracker";\n/g, '');

fs.writeFileSync(file, content);
console.log('Fixed FirestoreReadDiagnostics readTracker');

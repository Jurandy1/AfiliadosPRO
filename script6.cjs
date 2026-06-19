const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/diagnostics/FirestoreReadDiagnostics.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace imports
content = content.replace(/import { subscribeGlobalUsage } from "..\/..\/services\/firebase\/firestoreUsageSync";\n/, '');
content = content.replace(/import { clearLocalUsage } from "..\/..\/services\/firebase\/firestoreUsageSync";\n/, '');

// Replace hooks usage (mock it out)
content = content.replace(/useEffect\(\(\) => \{\n\s*return subscribeGlobalUsage\(setUsage\);\n\s*\}, \[\]\);/g, 'useEffect(() => {}, []);');

// Replace clear button action
content = content.replace(/clearLocalUsage\(\);/g, 'setUsage({ totalReads: 0, byCollection: {}, byOp: {}, queryHistory: [], recentEvents: [] });');

fs.writeFileSync(file, content);
console.log('Done FirestoreReadDiagnostics');

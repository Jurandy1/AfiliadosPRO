const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/diagnostics/FirestoreUsageBadge.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace imports and hooks
content = content.replace(/import \{ subscribeGlobalUsage \} from "\.\.\/\.\.\/services\/firebase\/readTracker";\n/g, '');
content = content.replace(/useEffect\(\(\) => \{\n\s*return subscribeGlobalUsage\(setUsage\);\n\s*\}, \[\]\);/g, 'useEffect(() => {}, []);');

fs.writeFileSync(file, content);
console.log('Fixed FirestoreUsageBadge');

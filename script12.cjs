const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/components/diagnostics/FirestoreUsageBadge.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace imports and hooks
content = content.replace(/import \{ subscribeReadTracker \} from "\.\.\/\.\.\/services\/firebase\/readTracker";\n/g, '');
content = content.replace(/useEffect\(\(\) => subscribeReadTracker\(setStats\), \[\]\);/g, 'useEffect(() => {}, []);');

fs.writeFileSync(file, content);
console.log('Fixed FirestoreUsageBadge again');

const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/main.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/import \{ initFirestoreTracker, exposeReadTrackerGlobally \} from '\.\/services\/firebase\/readTracker\.js'\n/g, '');
content = content.replace(/exposeReadTrackerGlobally\(\);\n/g, '');
content = content.replace(/initFirestoreTracker\(\);\n/g, '');

fs.writeFileSync(file, content);
console.log('Fixed main.jsx completely');

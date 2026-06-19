const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/main.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/import { startFirestoreUsageSync } from '\.\/services\/firebase\/firestoreUsageSync\.js'\n/g, '');
content = content.replace(/startFirestoreUsageSync\(\);\n/g, '');

fs.writeFileSync(file, content);
console.log('Done main.jsx');

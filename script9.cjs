const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/main.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/import \{ setupGlobalReadTracking \} from '\.\/services\/firebase\/readTracker\.js'\n/g, '');
content = content.replace(/setupGlobalReadTracking\(\);\n/g, '');

fs.writeFileSync(file, content);
console.log('Fixed main.jsx');

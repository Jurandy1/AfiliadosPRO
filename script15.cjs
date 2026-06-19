const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/cache/periodSessionCache.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/import \{ trackCacheHit \} from "\.\.\/\.\.\/\.\.\/services\/firebase\/readTracker";\n/g, '');
content = content.replace(/trackCacheHit\(\{[\s\S]*?\}\);\n/g, '');

fs.writeFileSync(file, content);
console.log('Fixed periodSessionCache');

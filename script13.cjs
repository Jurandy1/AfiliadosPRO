const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/imports/pages/ImportsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/import \{ .* \} from "\.\.\/\.\.\/\.\.\/services\/firebase\/storage";\n/g, '');

fs.writeFileSync(file, content);
console.log('Fixed ImportsPage.jsx');

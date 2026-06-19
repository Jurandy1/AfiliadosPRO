const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/package.json';
let content = fs.readFileSync(file, 'utf8');
let pkg = JSON.parse(content);

if (pkg.dependencies && pkg.dependencies.firebase) {
    delete pkg.dependencies.firebase;
}

fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
console.log('Firebase removed from package.json');

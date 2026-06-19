const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/const data = snap\.data\.data_blob \|\| snap\.data;/g, 'const data = snap.data;');
c = c.replace(/const data = snap\?\.data \? snap\.data\.data_blob : null;/g, 'const data = snap?.data ? snap.data : null;');
c = c.replace(/const data = snap\.data\(\) \|\| \{\};/g, 'const data = snap.data || {};');
c = c.replace(/snap\.data\.data_blob/g, 'snap.data');

fs.writeFileSync(file, c);
console.log('Cleaned up data assignments');

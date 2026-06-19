const fs = require('fs');
const lines = fs.readFileSync('./index.js', 'utf8').split('\n');
const reqs = lines.filter(l => l.includes('require(') && l.includes('./')).map(l => l.match(/require\(['"](.*?)['"]\)/)?.[1]).filter(Boolean);
reqs.forEach(r => {
  const p = r + (r.endsWith('.js') ? '' : '.js');
  if(!fs.existsSync(p) && !fs.existsSync(p.replace('.js', '/index.js'))) console.log('MISSING:', r, '->', p);
});

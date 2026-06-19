const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js';
let content = fs.readFileSync(file, 'utf8');

// L644
content = content.replace(/const subSnap = await getDocs\(query\(\s*collection\(db, "subid_daily"\),\s*where\("data", "==", dateStr\),\s*limit\(3\),\s*\)\);/g, 'const { data: subData } = await supabase.from("subid_daily").select("id, data_blob").eq("data_blob->>data", dateStr).limit(3);\n          const subSnap = { docs: (subData||[]).map(d => ({ data: () => d.data_blob })) };');

// L1151
content = content.replace(/const snap = await getDocs\(query\(\s*collection\(db, "subid_vendas"\),\s*where\(documentId\(\), "in", chunk\),\s*\)\)\.catch\(\(\) => \(\{ docs: \[\] \}\)\);/g, 'const { data: subVendasData } = await supabase.from("subid_vendas").select("id, data_blob").in("id", chunk);\n      const snap = { docs: (subVendasData||[]).map(d => ({ data: () => d.data_blob })) };');

// L2181
content = content.replace(/snap = await getDocs\(query\(\s*dailyRef,\s*where\(documentId\(\), ">=", startStr\),\s*where\(documentId\(\), "<=", endStr\),\s*\)\);/g, 'const { data: rangeData } = await supabase.from("shopee_daily").select("id, data_blob").gte("id", startStr).lte("id", endStr);\n    snap = { forEach: (cb) => (rangeData||[]).forEach(d => cb({ id: d.id, data: () => d.data_blob })) };');

fs.writeFileSync(file, content);
console.log('Third pass replacements done');

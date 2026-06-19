const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js';
let content = fs.readFileSync(file, 'utf8');

// Replace remaining getDocs / query / collection
content = content.replace(/const q = query\(produtosRef, order, limit\(pageSize\)\);/g, 'let q = supabase.from("produtos").select("id, data_blob").limit(pageSize);');
content = content.replace(/const q = cursor\s*\?\s*query\(produtosRef, order, startAfter\(cursor\), limit\(pageSize\)\)\s*:\s*query\(produtosRef, order, limit\(pageSize\)\);/g, 'let q = supabase.from("produtos").select("id, data_blob").limit(pageSize);');

content = content.replace(/const snap = await getDocs\(q\);/g, 'const { data: snapDocs } = await q;\n  const snap = { docs: (snapDocs || []).map(d => ({ id: d.id, data: () => d.data_blob })) };');

content = content.replace(/const subSnap = await getDocs\(query\(\s*collection\(db, "subid_daily"\),\s*where\("data", "==", dateStr\),\s*\)\);/g, 'const { data: subData } = await supabase.from("subid_daily").select("id, data_blob").eq("data_blob->>data", dateStr);\n          const subSnap = { docs: (subData||[]).map(d => ({ data: () => d.data_blob })) };');

content = content.replace(/const q = query\(\s*collection\(db, "subid_daily"\),\s*where\("data", "in", dates\)\s*\);/g, 'const q = supabase.from("subid_daily").select("id, data_blob").in("data_blob->>data", dates);');
content = content.replace(/const q = query\(\s*collection\(db, "subid_daily"\),\s*where\(documentId\(\), ">=", dates\[0\]\),\s*where\(documentId\(\), "<=", dates\[dates\.length - 1\]\)\s*\);/g, 'const q = supabase.from("subid_daily").select("id, data_blob").gte("id", dates[0]).lte("id", dates[dates.length - 1]);');

content = content.replace(/const snap = await getDocs\(query\(\s*collection\(db, "subid_vendas"\),\s*where\(documentId\(\), "in", chunk\),\s*\)\);/g, 'const { data: subVendasData } = await supabase.from("subid_vendas").select("id, data_blob").in("id", chunk);\n      const snap = { forEach: (cb) => (subVendasData||[]).forEach(d => cb({ id: d.id, data: () => d.data_blob })) };');

content = content.replace(/const snap = await getDocs\(query\(collection\(db, "subid_vendas"\), limit\(500\)\)\);/g, 'const { data: svData } = await supabase.from("subid_vendas").select("id, data_blob").limit(500);\n  const snap = { forEach: (cb) => (svData||[]).forEach(d => cb({ id: d.id, data: () => d.data_blob })) };');

content = content.replace(/const q = query\(\s*collection\(db, "shopee_daily"\),\s*where\("data", ">=", startStr\),\s*where\("data", "<=", endStr\),\s*\);/g, 'const q = supabase.from("shopee_daily").select("id, data_blob").gte("id", startStr).lte("id", endStr);');
content = content.replace(/const snap = await getDocs\(q\)\.catch\(\(\) => \(\{ forEach: \(\) => \{\} \}\)\);/g, 'const { data: sdData } = await q;\n  let snap = { forEach: (cb) => (sdData||[]).forEach(d => cb({ id: d.id, data: () => d.data_blob })) };');

content = content.replace(/snap = await getDocs\(query\(\s*dailyRef,\s*where\(documentId\(\), ">=", startStr\),\s*where\(documentId\(\), "<=", endStr\)\s*\)\);/g, 'const { data: rangeData } = await supabase.from("shopee_daily").select("id, data_blob").gte("id", startStr).lte("id", endStr);\n    snap = { forEach: (cb) => (rangeData||[]).forEach(d => cb({ id: d.id, data: () => d.data_blob })) };');

content = content.replace(/const countSnap = await getCountFromServer\(q\);/g, 'const countSnap = { data: () => ({ count: 0 }) };');
content = content.replace(/const agg = await getAggregateFromServer\(q, \{[\s\S]*?\}\);/g, 'const agg = { data: () => ({ countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 }) };');

fs.writeFileSync(file, content);
console.log('Second pass replacements done');

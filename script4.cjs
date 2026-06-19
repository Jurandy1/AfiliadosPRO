const fs = require('fs');
const file = 'C:/Users/PC/Music/Afiliadoteste-Superbase/src/platforms/dashboard/repositories/metricsRepository.js';
let content = fs.readFileSync(file, 'utf8');

// remove remaining db collection declarations
content = content.replace(/const produtosRef = collection\(db, "produtos"\);\n/g, '');
content = content.replace(/const dailyRef = collection\(db, "shopee_daily"\);\n/g, '');

// getPerdasKpiFallbackLeve and getPerdasKpiByPeriod
content = content.replace(/const q = query\(\s*collection\(db, "log_perdas"\),\s*where\("data", ">=", startStr\),\s*where\("data", "<=", endStr\),\s*\);/g, 'let q = supabase.from("log_perdas").select("data_blob").gte("data_blob->>data", startStr).lte("data_blob->>data", endStr);');
content = content.replace(/const countSnap = await getCountFromServer\(q\);/g, 'const { data: countData } = await supabase.from("log_perdas").select("id").gte("data_blob->>data", startStr).lte("data_blob->>data", endStr);');
content = content.replace(/return \{\n\s*countPerdas: Number\(countSnap\.data\(\)\.count \|\| 0\),\n\s*totalFatPerdido: 0,\n\s*totalComissaoPerdida: 0,\n\s*\};/g, 'return { countPerdas: countData ? countData.length : 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };');

content = content.replace(/const agg = await getAggregateFromServer\(q, \{\n\s*countPerdas: count\(\),\n\s*totalFatPerdido: sum\("faturamento_perdido"\),\n\s*totalComissaoPerdida: sum\("comissao_perdida"\),\n\s*\}\);/g, 'const { data: aggData } = await q;');
content = content.replace(/const res = agg\.data\(\);/g, 'const res = (aggData||[]).reduce((acc, curr) => ({ countPerdas: acc.countPerdas + 1, totalFatPerdido: acc.totalFatPerdido + Number(curr.data_blob?.faturamento_perdido || 0), totalComissaoPerdida: acc.totalComissaoPerdida + Number(curr.data_blob?.comissao_perdida || 0) }), { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 });');

// getProdutosByPeriod (remove query/limit logic)
content = content.replace(/let q = cursor\s*\?\s*query\(produtosRef, order, startAfter\(cursor\), limit\(pageSize\)\)\s*:\s*query\(produtosRef, order, limit\(pageSize\)\);/g, 'let q = supabase.from("produtos").select("id, data_blob").limit(pageSize);');

// update query(collection(db, "shopee_daily") ... limit(1)
content = content.replace(/const q = query\(\s*collection\(db, "shopee_daily"\),\s*where\(documentId\(\), ">=", startStr\),\s*limit\(1\),\s*\);/g, 'const q = supabase.from("shopee_daily").select("id, data_blob").gte("id", startStr).limit(1);');

content = content.replace(/const q2 = query\(\s*collection\(db, "produto_daily"\),\s*where\("data", ">=", startStr\),\s*limit\(1\),\s*\);/g, 'const q2 = supabase.from("produto_daily").select("id, data_blob").gte("data_blob->>data", startStr).limit(1);');

fs.writeFileSync(file, content);
console.log('Fourth pass done');

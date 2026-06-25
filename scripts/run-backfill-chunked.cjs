const fs = require('fs');
const path = require('path');

let secret = "";
const candidates = ['.env.local', '.env'];
for (const envPath of candidates) {
  if (!fs.existsSync(envPath)) continue;
  const txt = fs.readFileSync(envPath, 'utf8');
  const match = txt.match(/VITE_BACKFILL_SECRET=([^\r\n]+)/);
  if (match) {
    secret = match[1].trim();
    break;
  }
}

if (!secret) {
  console.error("VITE_BACKFILL_SECRET não encontrado no .env");
  process.exit(1);
}

const START_DATE = "2026-06-01";
const END_DATE = "2026-06-25";

function getDatesRange(start, end) {
  const d1 = new Date(start + "T00:00:00-03:00");
  const d2 = new Date(end + "T00:00:00-03:00");
  const arr = [];
  while (d1 <= d2) {
    arr.push(d1.toISOString().split("T")[0]);
    d1.setDate(d1.getDate() + 1);
  }
  return arr;
}

const dates = getDatesRange(START_DATE, END_DATE);

// Chunk em grupos de 3 dias
const CHUNK_SIZE = 3;
const chunks = [];
for (let i = 0; i < dates.length; i += CHUNK_SIZE) {
  const chunk = dates.slice(i, i + CHUNK_SIZE);
  chunks.push({
    start: chunk[0],
    end: chunk[chunk.length - 1],
  });
}

async function runChunks() {
  console.log(`Iniciando backfill para ${dates.length} dias em ${chunks.length} chunks...`);
  
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    console.log(`[${i+1}/${chunks.length}] Backfill de ${start} até ${end}...`);
    
    try {
      const url = `https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app/?startDate=${start}&endDate=${end}&force=1`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + secret }
      });
      const data = await res.text();
      console.log(`  Resposta (${res.status}): ${data.slice(0, 100)}...`);
      
      if (res.status >= 500 || data.includes("lock_busy")) {
        console.error("  Lock ocupado ou erro. Tentando novamente este chunk em 30 segundos...");
        i--; // Retry the same chunk
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
    } catch (e) {
      console.error(`  Erro na requisição: ${e.message}`);
    }
    
    // Aguarda um pouco antes do próximo chunk para não estourar a API da Shopee
    await new Promise(r => setTimeout(r, 10000));
  }
  
  console.log("Backfill concluído!");
}

runChunks();

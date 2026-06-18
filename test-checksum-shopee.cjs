#!/usr/bin/env node
/**
 * test-checksum-shopee.cjs
 *
 * Script STANDALONE para validar a estrategia de hash incremental
 * da puxada mensal da Shopee Affiliate API, SEM tocar no Firestore.
 *
 * O que faz:
 * 1. Puxa conversionReport direto da API Shopee (assinatura SHA256)
 * 2. Para cada dia no range, calcula um checksum dos dados retornados
 * 3. Salva os checksums em arquivo JSON local (.checksums-test.json)
 * 4. Numa segunda execucao, compara e mostra exatamente quais dias mudaram
 *
 * Como usar:
 *   1. Crie um arquivo .env nesta pasta (ou na pasta acima) com:
 *        SHOPEE_APP_ID=seu_app_id
 *        SHOPEE_SECRET=seu_secret
 *   2. Rode:
 *        node test-checksum-shopee.cjs --start 2026-06-01 --end 2026-06-17
 *      ou (mes inteiro):
 *        node test-checksum-shopee.cjs --month 2026-06
 *   3. Espere alguns minutos (rate limit Shopee = 30s entre queries sem scrollId)
 *   4. Rode de novo umas horas depois pra ver quais dias mudaram de fato
 *
 * Flags opcionais:
 *   --no-wait              ignora os 30s de espera entre dias (so pra teste rapido com 1-2 dias)
 *   --save-snapshots       salva o JSON bruto de cada dia em ./snapshots/YYYY-MM-DD.json
 *   --output FILE          nome do arquivo de checksums (padrao: .checksums-test.json)
 *   --verbose              mostra detalhes de cada conversao
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- ENV ----------
function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "..", ".env"),
    path.join(process.cwd(), "functions", ".env"),
    path.join(process.cwd(), "..", "functions", ".env"),
    path.join(process.cwd(), "..", "functions", ".env.projetoafiliado-9ff07"),
    path.join(process.cwd(), "functions", ".env.projetoafiliado-9ff07"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) {
          const v = m[2].replace(/^["']|["']$/g, "");
          if (!process.env[m[1]]) process.env[m[1]] = v;
        }
      }
      console.log(`[env] carregado de ${p}`);
    }
  }
}

// ---------- CLI ARGS ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    start: null,
    end: null,
    noWait: false,
    saveSnapshots: false,
    output: ".checksums-test.json",
    verbose: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--start") out.start = args[++i];
    else if (a === "--end") out.end = args[++i];
    else if (a === "--month") {
      const m = args[++i]; // YYYY-MM
      const [y, mo] = m.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      out.start = `${m}-01`;
      out.end = `${m}-${String(lastDay).padStart(2, "0")}`;
    } else if (a === "--no-wait") out.noWait = true;
    else if (a === "--save-snapshots") out.saveSnapshots = true;
    else if (a === "--output") out.output = args[++i];
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(fs.readFileSync(__filename, "utf-8").split("\n").slice(1, 30).join("\n"));
      process.exit(0);
    }
  }
  if (!out.start || !out.end) {
    console.error("Faltam argumentos. Use --start YYYY-MM-DD --end YYYY-MM-DD ou --month YYYY-MM");
    process.exit(1);
  }
  return out;
}

// ---------- DATE HELPERS (BRT = UTC-3) ----------
function dateBRTStartUnix(yyyymmdd) {
  // Inicio do dia em BRT = 00:00:00 BRT = 03:00:00 UTC
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 3, 0, 0) / 1000);
}
function dateBRTEndUnix(yyyymmdd) {
  // Fim do dia em BRT = 23:59:59 BRT = 02:59:59 UTC do dia seguinte
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d + 1, 2, 59, 59) / 1000);
}
function daysBetween(startStr, endStr) {
  const out = [];
  const [y0, m0, d0] = startStr.split("-").map(Number);
  const [y1, m1, d1] = endStr.split("-").map(Number);
  let t = Date.UTC(y0, m0 - 1, d0);
  const tEnd = Date.UTC(y1, m1 - 1, d1);
  while (t <= tEnd) {
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
    t += 86400000;
  }
  return out;
}

// ---------- SHOPEE AUTH ----------
function buildShopeeHeaders(appId, secret, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha256")
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
  };
}

const SHOPEE_URL = "https://open-api.affiliate.shopee.com.br/graphql";

async function shopeeQuery(appId, secret, query) {
  const payload = JSON.stringify({ query });
  const headers = buildShopeeHeaders(appId, secret, payload);
  const res = await fetch(SHOPEE_URL, { method: "POST", headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Resposta nao-JSON: ${text.slice(0, 300)}`);
  }
  if (json.errors?.length) {
    const msg = json.errors.map((e) => `${e.extensions?.code || ""}: ${e.message}`).join(" | ");
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json.data;
}

// ---------- PULL DE UM DIA ----------
async function pullDayConversions(appId, secret, dateStr, { verbose }) {
  const startTs = dateBRTStartUnix(dateStr);
  const endTs = dateBRTEndUnix(dateStr);
  let scrollId = null;
  const allNodes = [];
  let pageCount = 0;

  while (true) {
    pageCount++;
    const scrollClause = scrollId ? `, scrollId: "${scrollId}"` : "";
    const query = `{
      conversionReport(
        purchaseTimeStart: ${startTs}
        purchaseTimeEnd: ${endTs}
        limit: 500
        ${scrollClause}
      ) {
        nodes {
          conversionId
          purchaseTime
          totalCommission
          shopeeCommissionCapped
          sellerCommission
          orders {
            orderId
            orderStatus
            items {
              shopId
              itemId
              actualAmount
              qty
              itemTotalCommission
              fraudStatus
              completeTime
            }
          }
        }
        pageInfo { hasNextPage scrollId }
      }
    }`;
    const data = await shopeeQuery(appId, secret, query);
    const r = data.conversionReport;
    const nodes = r.nodes || [];
    allNodes.push(...nodes);
    if (verbose) {
      console.log(`    pagina ${pageCount}: +${nodes.length} (total ${allNodes.length})`);
    }
    if (!r.pageInfo.hasNextPage) break;
    scrollId = r.pageInfo.scrollId;
    if (!scrollId) {
      console.warn(`    ⚠ hasNextPage=true mas scrollId vazio, parando`);
      break;
    }
    // scrollId expira em 30s, mas nao precisa esperar entre paginas do mesmo scroll
  }
  return allNodes;
}

// ---------- CHECKSUM ----------
function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function computeDailyChecksum(conversoes) {
  // Agregados financeiros (devem ser estaveis se nada mudou)
  let totalCommission = 0;
  let totalGMV = 0;
  let totalItems = 0;
  const orderIds = new Set();
  const statusPairs = []; // orderId:orderStatus
  const fraudPairs = []; // itemId:fraudStatus
  const completeTimes = []; // itemId:completeTime

  for (const c of conversoes) {
    totalCommission += Number(c.totalCommission || 0);
    for (const o of c.orders || []) {
      orderIds.add(o.orderId);
      statusPairs.push(`${o.orderId}:${o.orderStatus || ""}`);
      for (const it of o.items || []) {
        totalGMV += Number(it.actualAmount || 0);
        totalItems += Number(it.qty || 0);
        fraudPairs.push(`${it.itemId}:${it.fraudStatus || ""}`);
        completeTimes.push(`${it.itemId}:${it.completeTime || 0}`);
      }
    }
  }

  // Hashes de subconjuntos (pra entender o QUE mudou se hash geral mudar)
  const hashOf = (arr) =>
    crypto.createHash("sha1").update(arr.sort().join("|")).digest("hex").slice(0, 16);

  const fingerprint = {
    conversoes: conversoes.length,
    pedidosDistintos: orderIds.size,
    comissaoTotal: roundMoney(totalCommission),
    gmvTotal: roundMoney(totalGMV),
    itensTotal: totalItems,
    hashStatus: hashOf(statusPairs),
    hashFraud: hashOf(fraudPairs),
    hashCompleteTime: hashOf(completeTimes),
    hashConversionIds: hashOf(conversoes.map((c) => String(c.conversionId))),
  };

  const hashGeral = crypto
    .createHash("sha1")
    .update(JSON.stringify(fingerprint))
    .digest("hex")
    .slice(0, 16);

  return { hash: hashGeral, fingerprint };
}

// ---------- DIFF ENTRE FINGERPRINTS ----------
function diffFingerprints(antigo, novo) {
  const diff = [];
  const fields = [
    "conversoes",
    "pedidosDistintos",
    "comissaoTotal",
    "gmvTotal",
    "itensTotal",
    "hashStatus",
    "hashFraud",
    "hashCompleteTime",
    "hashConversionIds",
  ];
  for (const f of fields) {
    if (antigo[f] !== novo[f]) {
      diff.push({ field: f, antes: antigo[f], depois: novo[f] });
    }
  }
  return diff;
}

// ---------- MAIN ----------
async function main() {
  loadEnv();
  const args = parseArgs();
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;
  if (!appId || !secret) {
    console.error("SHOPEE_APP_ID ou SHOPEE_SECRET nao encontrados no .env");
    process.exit(1);
  }
  console.log(`[shopee] APP_ID=${appId}, secret=${"*".repeat(secret.length - 4) + secret.slice(-4)}`);

  const days = daysBetween(args.start, args.end);
  console.log(`[range] ${args.start} -> ${args.end} (${days.length} dias)`);

  // Carrega checksums anteriores se existirem
  const outFile = path.resolve(args.output);
  let prev = {};
  if (fs.existsSync(outFile)) {
    try {
      prev = JSON.parse(fs.readFileSync(outFile, "utf-8"));
      console.log(`[checksums] arquivo anterior carregado: ${outFile}`);
    } catch {
      console.warn(`[checksums] arquivo corrompido, comecando do zero`);
    }
  } else {
    console.log(`[checksums] primeira execucao, nada pra comparar ainda`);
  }

  if (args.saveSnapshots) {
    fs.mkdirSync(path.resolve("snapshots"), { recursive: true });
  }

  const novo = {};
  const resumo = []; // { data, status, fingerprint, diff }
  let totalReadsApi = 0;

  for (let i = 0; i < days.length; i++) {
    const dia = days[i];
    console.log(`\n[${i + 1}/${days.length}] ${dia}`);
    const t0 = Date.now();
    let conversoes;
    try {
      conversoes = await pullDayConversions(appId, secret, dia, { verbose: args.verbose });
    } catch (err) {
      console.error(`  ✗ erro: ${err.message}`);
      resumo.push({ data: dia, status: "ERROR", err: err.message });
      continue;
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    totalReadsApi += conversoes.length;
    const { hash, fingerprint } = computeDailyChecksum(conversoes);
    novo[dia] = { hash, fingerprint, pulledAt: new Date().toISOString() };

    if (args.saveSnapshots) {
      const snapPath = path.resolve("snapshots", `${dia}.json`);
      fs.writeFileSync(snapPath, JSON.stringify(conversoes, null, 2));
    }

    const prevEntry = prev[dia];
    let status;
    let diff = null;
    if (!prevEntry) {
      status = "NOVO";
    } else if (prevEntry.hash === hash) {
      status = "INALTERADO";
    } else {
      status = "MUDOU";
      diff = diffFingerprints(prevEntry.fingerprint, fingerprint);
    }
    resumo.push({ data: dia, status, fingerprint, diff, elapsedSec: dt });

    const fp = fingerprint;
    console.log(
      `  ${status === "MUDOU" ? "🔴" : status === "INALTERADO" ? "✅" : "🆕"} ${status}` +
        ` | ${fp.conversoes} conv, ${fp.pedidosDistintos} pedidos` +
        ` | comissao=R$ ${fp.comissaoTotal.toFixed(2)}` +
        ` | gmv=R$ ${fp.gmvTotal.toFixed(2)}` +
        ` | hash=${hash}` +
        ` | ${dt}s`,
    );
    if (diff?.length) {
      console.log("    Campos que mudaram:");
      for (const d of diff) {
        console.log(`      • ${d.field}: ${d.antes}  →  ${d.depois}`);
      }
    }

    // Rate limit: 30s entre queries sem scrollId, EXCETO no ultimo dia
    if (!args.noWait && i < days.length - 1) {
      const waitMs = 31000 - (Date.now() - t0);
      if (waitMs > 0) {
        console.log(`  ... aguardando ${(waitMs / 1000).toFixed(1)}s (rate limit Shopee)`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  // Salva
  fs.writeFileSync(outFile, JSON.stringify(novo, null, 2));
  console.log(`\n[saved] checksums em ${outFile}`);

  // Resumo final
  console.log("\n" + "=".repeat(80));
  console.log("RESUMO");
  console.log("=".repeat(80));
  const counts = { NOVO: 0, INALTERADO: 0, MUDOU: 0, ERROR: 0 };
  for (const r of resumo) counts[r.status]++;
  console.log(`  Total dias processados: ${resumo.length}`);
  console.log(`  Novos: ${counts.NOVO}`);
  console.log(`  Inalterados: ${counts.INALTERADO}  ← esses pulariam o processamento`);
  console.log(`  Mudaram: ${counts.MUDOU}  ← esses precisariam reprocessar`);
  console.log(`  Erros: ${counts.ERROR}`);
  console.log(`  Total conversoes puxadas da API: ${totalReadsApi}`);

  if (counts.INALTERADO > 0) {
    const economizado = Math.round((counts.INALTERADO / resumo.length) * 100);
    console.log(
      `\n  💰 Estimativa: numa segunda execucao ${economizado}% dos dias seriam SKIPADOS,`,
    );
    console.log(`     o que reduziria reads do Firestore em proporcao similar.`);
  }

  if (counts.MUDOU > 0) {
    console.log("\n  Dias que mudaram:");
    for (const r of resumo.filter((r) => r.status === "MUDOU")) {
      const causas = (r.diff || [])
        .filter((d) => d.field.startsWith("hash") === false)
        .map((d) => `${d.field}: ${d.antes}→${d.depois}`)
        .join("; ");
      console.log(`    • ${r.data}  ${causas || "(so hashes internos)"}`);
    }
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err.stack || err.message);
  process.exit(1);
});

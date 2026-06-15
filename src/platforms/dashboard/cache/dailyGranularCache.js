/**
 * dailyGranularCache.js
 *
 * Motor de Cache Diferencial Diário.
 * Compara versões do manifesto sync_state/daily_versions com o IndexedDB
 * para decidir quais dias precisam ser re-buscados no Firestore.
 *
 * Garantia de dados frescos:
 *   - O backend bumpa daily_versions após cada sync (Shopee e Meta).
 *   - O manifesto é lido com TTL de 30s em memória.
 *   - Se a versão do IDB divergir da versão do manifesto, o dia é
 *     considerado stale e vai ao Firestore antes de servir os dados.
 */
import { doc, getDoc, documentId } from "firebase/firestore";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { idbGet, idbSet } from "./indexedDbCache";
import { trackCacheHit } from "../../../services/firebase/readTracker";

// TTL do manifesto em memória: 30s — curto o suficiente para detectar
// um sync recente sem gerar leitura a cada operação.
const MANIFEST_TTL_MS = 30_000;

let _manifestCache = null;
let _manifestCacheTs = 0;

/**
 * Retorna o manifesto unificado com as versões diárias.
 * force=true → ignora o TTL e relê do Firestore imediatamente.
 */
export async function getDailyVersionsManifest(force = false) {
  const agora = Date.now();
  if (!force && _manifestCache && (agora - _manifestCacheTs < MANIFEST_TTL_MS)) {
    return _manifestCache;
  }
  const snap = await getDoc(doc(db, "sync_state", "daily_versions")).catch(() => null);
  _manifestCache = snap?.exists() ? snap.data() : {};
  _manifestCacheTs = agora;
  return _manifestCache;
}

/** Força a invalidação do cache em memória do manifesto. */
export function invalidateDailyVersionsManifestCache() {
  _manifestCache = null;
  _manifestCacheTs = 0;
}

export async function getDailyCache(colName, dateStr) {
  const key = `daily_v2_${colName}_${dateStr}`;
  return idbGet(key);
}

export async function setDailyCache(colName, dateStr, payload, version) {
  const key = `daily_v2_${colName}_${dateStr}`;
  await idbSet(key, { payload, version, savedAt: Date.now() });
}

function iterDates(startStr, endStr) {
  const out = [];
  let cur = startStr;
  while (cur <= endStr) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

/**
 * Busca dados de uma coleção usando a estratégia de Cache Diferencial.
 *
 * Fluxo por dia:
 *   1. Lê versão do manifesto  (1 leitura leve — compartilhada entre todos os dias)
 *   2. Lê IDB — se versão bate → serve do IDB (zero leituras Firestore)
 *   3. Se versão difere ou IDB vazio → marca como "missing"
 *   4. Busca todos os "missing" de uma vez com range query
 *   5. Salva no IDB com a versão atual do manifesto
 *
 * Garantia de frescor: se o backend rodou um sync e bumpou daily_versions,
 * a versão do IDB vai divergir na próxima leitura após o TTL do manifesto (30s).
 * O dia é então re-buscado do Firestore e o IDB é atualizado.
 */
export async function fetchSmartDailyCollection(colName, startStr, endStr) {
  const manifest = await getDailyVersionsManifest();
  const dates = iterDates(startStr, endStr);
  const resultByDate = {};   // data → [docs]
  const missingDates = [];

  // Fase 1: verificar IDB para cada dia
  for (const date of dates) {
    const manifestVersion = manifest[`${colName}_${date}`] ?? 0;
    const cached = await getDailyCache(colName, date);

    const idbValido =
      cached &&
      cached.version !== undefined &&
      cached.version === manifestVersion;

    if (idbValido) {
      resultByDate[date] = cached.payload || [];
      if (cached.payload?.length > 0) {
        trackCacheHit({
          collection: `cache_${colName}_daily`,
          docs: cached.payload.length,
          source: "dailyGranularCache",
        });
      }
    } else {
      missingDates.push(date);
    }
  }

  // Fase 2: buscar no Firestore apenas os dias que faltam/estão stale
  if (missingDates.length > 0) {
    missingDates.sort();
    const minDate = missingDates[0];
    const maxDate = missingDates[missingDates.length - 1];

    // shopee_daily usa documentId() como data; as demais têm campo "data"
    const isShopeeDaily = colName === "shopee_daily";
    const q = query(
      collection(db, colName),
      where(isShopeeDaily ? documentId() : "data", ">=", minDate),
      where(isShopeeDaily ? documentId() : "data", "<=", maxDate),
    );

    const snap = await getDocs(q).catch(() => ({ empty: true, forEach: () => {} }));

    // Agrupa docs por data
    const fetchedByDate = {};
    snap.forEach((d) => {
      const data = d.data();
      const dt = data.data || d.id;
      if (dt) {
        if (!data.data) data.data = dt;
        if (!fetchedByDate[dt]) fetchedByDate[dt] = [];
        fetchedByDate[dt].push(data);
      }
    });

    // Salva no IDB e adiciona ao resultado
    for (const date of missingDates) {
      const payload = fetchedByDate[date] || [];
      const manifestVersion = manifest[`${colName}_${date}`] ?? 0;
      await setDailyCache(colName, date, payload, manifestVersion);
      resultByDate[date] = payload;
    }
  }

  // Retorna todos os docs na ordem de data
  return dates.flatMap((date) => resultByDate[date] || []);
}

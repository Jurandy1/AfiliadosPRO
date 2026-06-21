/**
 * dailyRangeCache.js
 *
 * Cache LRU + in-flight dedup para coleções "date-bucketed" lidas por range.
 * Aplica o mesmo padrão do metaAdsDailyCache.js a shopee_daily, subid_daily
 * e clique_daily — coleções lidas múltiplas vezes na mesma sessão por
 * caminhos paralelos do dashboard.
 *
 * Cada coleção tem seu próprio Map LRU. TTL curto (60s) protege contra
 * repico no mesmo render cycle sem segurar dados velhos.
 *
 * Para invalidar (ex.: após backfill manual), chame
 * invalidateDailyRangeCache() ou invalidateDailyRangeCache("subid_daily").
 */
import { supabase } from "../../../services/supabase/client";
import { fetchDataVersions } from "./dataVersions";

const TTL_MS = 30_000;
const MAX_SLOTS = 4;

const _caches = new Map();   // collectionName → Map<key, {data, ts}>
const _inFlight = new Map(); // `${collectionName}|${key}` → Promise

function getCache(collectionName) {
  if (!_caches.has(collectionName)) _caches.set(collectionName, new Map());
  return _caches.get(collectionName);
}

function lruGet(collectionName, key) {
  const cache = getCache(collectionName);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function lruSet(collectionName, key, data) {
  const cache = getCache(collectionName);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { data, ts: Date.now() });
  while (cache.size > MAX_SLOTS) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export function invalidateDailyRangeCache(collectionName = null) {
  if (collectionName) {
    _caches.delete(collectionName);
    for (const k of [..._inFlight.keys()]) {
      if (k.startsWith(`${collectionName}|`)) _inFlight.delete(k);
    }
  } else {
    _caches.clear();
    _inFlight.clear();
  }
}

/**
 * Lê coleção range-bucketed por `data` (campo) entre startDate/endDate (YYYY-MM-DD).
 * Retorna array de objetos `{ id, ...data }`. NÃO retorna snapshot do Firestore.
 */
async function fetchByDataField(collectionName, startDate, endDate) {
  // Nota: subid_daily e clique_daily ainda não estão no Supabase, então retornarão array vazio
  // se consultados até que o backfill dessas tabelas seja feito.
  const { data, error } = await supabase
    .from(collectionName)
    .select("*")
    .gte("data", startDate)
    .lte("data", endDate);
    
  if (error) {
    console.warn(`[Supabase] Erro ao buscar ${collectionName}:`, error.message);
    return [];
  }
  
  // O código legado espera objetos que possivelmente têm 'id', e no Firebase o id era o documentId (ou a própria data).
  // No Supabase, se não vier um 'id', adicionamos um campo 'id' pra não quebrar a lógica.
  return (data || []).map((row) => ({ id: row.data || row.id, ...row }));
}

/**
 * Wrapper genérico com LRU + in-flight dedup.
 * fetchFn deve retornar array de objetos.
 */
async function cachedFetch(collectionName, key, fetchFn) {
  const cached = lruGet(collectionName, key);
  if (cached) return cached;

  const flightKey = `${collectionName}|${key}`;
  const pending = _inFlight.get(flightKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const data = await fetchFn();
      lruSet(collectionName, key, data);
      return data;
    } finally {
      _inFlight.delete(flightKey);
    }
  })();

  _inFlight.set(flightKey, promise);
  return promise;
}

/** subid_daily com cache. */
export async function fetchSubIdDailyForRange(startDate, endDate) {
  if (!startDate || !endDate) return [];

  let versionSuffix = "";
  try {
    const v = await fetchDataVersions();
    versionSuffix = `|${v.versionKey}`;
  } catch {}

  const key = `${startDate}|${endDate}${versionSuffix}`;
  return cachedFetch("subid_daily", key, () => fetchByDataField("subid_daily", startDate, endDate));
}

/** clique_daily com cache. */
export async function fetchCliqueDailyForRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const key = `${startDate}|${endDate}`;
  return cachedFetch("clique_daily", key, () => fetchByDataField("clique_daily", startDate, endDate));
}

/**
 * shopee_daily com cache. Indexado por documentId (não por campo `data`).
 * Retorna array de `{ id, ...data }` filtrando docs com métricas reais
 * (preserva o behavior de fetchShopeeDailyDocsForRange).
 */
export async function fetchShopeeDailyForRange(startDate, endDate, isDailyMetricsVazio) {
  if (!startDate || !endDate) return [];

  let versionSuffix = "";
  try {
    const v = await fetchDataVersions();
    versionSuffix = `|${v.versionKey}`;
  } catch {}

  const key = `${startDate}|${endDate}${versionSuffix}`;
  return cachedFetch("shopee_daily", key, async () => {
    const { data, error } = await supabase
      .from("shopee_daily")
      .select("*")
      .gte("data", startDate)
      .lte("data", endDate);

    if (error) {
      console.warn("[Supabase] Erro ao buscar shopee_daily:", error.message);
      return [];
    }

    const out = [];
    (data || []).forEach((row) => {
      // isDailyMetricsVazio é opcional, garantindo que não retorne linhas vazias
      if (!isDailyMetricsVazio || !isDailyMetricsVazio(row)) {
        out.push({ id: row.data || row.id, ...row });
      }
    });

    return out;
  });
}

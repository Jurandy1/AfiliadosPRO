/**
 * metaAdsDailyCache.js
 *
 * Cache de meta_ads_daily com duas camadas:
 *   L1 — LRU em memória (4 slots): suporta múltiplos períodos paralelos.
 *   L2 — IndexedDB via dailyGranularCache: persiste entre recarregamentos.
 *
 * PATCH M:
 *   - L1 vira Map LRU (4 períodos diferentes podem coexistir).
 *   - In-flight dedup: 2 chamadas paralelas com mesmo range → 1 fetch só.
 *   - Warn em DEV quando range > 7 dias for chamado (rastreio do "635 docs bug").
 */
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import {
  fetchSmartDailyCollection,
  invalidateDailyVersionsManifestCache,
} from "./dailyGranularCache";

const SMART_CACHE_ATIVO = String(import.meta.env.VITE_SMART_CACHE_META ?? "0") === "1";
const EMPTY_SNAP = { empty: true, forEach: () => {}, docs: [] };

const L1_MAX_SLOTS = 4;
const L1_TTL_MS = 60_000;  // 60s — protege contra repico no mesmo render cycle

// L1: Map LRU. Key = `${startDate}|${endDate}`, value = { snap, ts }.
const _l1 = new Map();

// In-flight dedup: 2 chamadas simultâneas com mesma key viram 1 fetch.
const _inFlight = new Map();

let _invalidateTimer = null;

function arrayToSnapLike(dataArray) {
  if (!dataArray || dataArray.length === 0) return EMPTY_SNAP;
  const docs = dataArray.map((d) => ({ data: () => d }));
  return {
    empty: false,
    docs,
    forEach: (cb) => docs.forEach(cb),
  };
}

function lruTouch(key, snap) {
  // Remove e re-insere pra ir pro topo (Map mantém ordem de inserção).
  if (_l1.has(key)) _l1.delete(key);
  _l1.set(key, { snap, ts: Date.now() });
  // Evict do mais antigo se passou do limite.
  while (_l1.size > L1_MAX_SLOTS) {
    const oldestKey = _l1.keys().next().value;
    _l1.delete(oldestKey);
  }
}

function lruGet(key) {
  const entry = _l1.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > L1_TTL_MS) {
    _l1.delete(key);
    return null;
  }
  // Touch: move pro topo
  _l1.delete(key);
  _l1.set(key, entry);
  return entry.snap;
}

export function invalidateMetaAdsDailyCache(delayMs = 0) {
  if (_invalidateTimer) clearTimeout(_invalidateTimer);

  const doInvalidate = () => {
    _l1.clear();
    _inFlight.clear();
    if (SMART_CACHE_ATIVO) {
      invalidateDailyVersionsManifestCache();
    }
  };

  if (delayMs > 0) {
    _invalidateTimer = setTimeout(doInvalidate, delayMs);
  } else {
    doInvalidate();
  }
}

/**
 * Calcula dias entre duas datas YYYY-MM-DD inclusivo.
 * Só pra warn em DEV — não afeta runtime.
 */
function diasInclusivos(start, end) {
  if (!start || !end) return 0;
  const a = Date.parse(`${start}T12:00:00-03:00`);
  const b = Date.parse(`${end}T12:00:00-03:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export async function fetchMetaAdsDailySnapshot(startDate, endDate) {
  if (!startDate || !endDate) return EMPTY_SNAP;

  const key = `${startDate}|${endDate}`;

  // L1 hit
  const cached = lruGet(key);
  if (cached) return cached;

  // In-flight: outra chamada com mesma key já está em andamento? Pega a promise.
  const pending = _inFlight.get(key);
  if (pending) return pending;

  // PATCH M: warn quando range é estranhamente grande pra ajudar a rastrear
  // chamadas com parâmetro errado (ex.: "Ontem" carregando 13 dias).
  if (import.meta.env.DEV) {
    const dias = diasInclusivos(startDate, endDate);
    if (dias > 35) {
      console.warn(
        `[metaAdsDailyCache] range grande: ${dias} dias (${startDate} → ${endDate}). ` +
        "Stack:",
        new Error().stack?.split("\n").slice(1, 6).join("\n"),
      );
    }
  }

  // Promise compartilhada entre todos os callers paralelos
  const fetchPromise = (async () => {
    let result;
    if (SMART_CACHE_ATIVO) {
      const dataArray = await fetchSmartDailyCollection("meta_ads_daily", startDate, endDate);
      result = arrayToSnapLike(dataArray);
    } else {
      const q = query(
        collection(db, "meta_ads_daily"),
        where("data", ">=", startDate),
        where("data", "<=", endDate),
      );
      const snap = await getDocs(q).catch(() => EMPTY_SNAP);
      result = (!snap || snap.empty) ? EMPTY_SNAP : snap;
    }
    lruTouch(key, result);
    return result;
  })();

  _inFlight.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    _inFlight.delete(key);
  }
}

import { idbGet, idbSet, idbClear } from "./indexedDbCache";

export const CACHE_DISABLE_KEY = "afilia:disable-cache";

const store = new Map();

export function isPeriodCacheDisabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("nocache")) return true;
    return window.localStorage.getItem(CACHE_DISABLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function settingsCacheKey(settings = {}) {
  return `${Number(settings.impostoMeta ?? 0)}_${Number(settings.impostoNf ?? 0)}`;
}

export function buildPeriodCacheKey(kind, startDate, endDate, versionKey, settings = {}) {
  return `${kind}|${startDate}|${endDate}|${versionKey}|${settingsCacheKey(settings)}`;
}

// TTL máximo: 5 min — mesmo que o versionKey não mude, o cache expira
const PERIOD_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getPeriodCacheEntry(key) {
  if (isPeriodCacheDisabled()) return null;

  let entry = store.get(key);
  if (!entry) {
    entry = await idbGet(key);
    if (entry) store.set(key, entry);
  }

  if (!entry) return null;

  // TTL: descarta entradas antigas mesmo que o versionKey seja igual
  if (entry.storedAt && Date.now() - entry.storedAt > PERIOD_CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }

  return entry.payload;
}

export function setPeriodCacheEntry(key, payload, meta = {}) {
  if (isPeriodCacheDisabled()) return;

  const entry = {
    payload,
    storedAt: Date.now(),
    ...meta,
  };

  store.set(key, entry);
  idbSet(key, entry).catch(() => {});
}

export function invalidatePeriodSessionCache() {
  store.clear();
  idbClear().catch(() => {});
}

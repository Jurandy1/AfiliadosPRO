import { formatDateBRTYYYYMMDD } from "../../utils/dates";

const STORAGE_KEY = "afilia:read_tracker";
const SESSION_PERSIST_KEY = "afilia:firestore_tracker_session";
const SESSION_REGISTERED_PREFIX = "afilia:usage_session_registered:";
const MAX_EVENTS = 400;
const FREE_TIER_DAILY_READS = 50_000;
const FREE_TIER_DAILY_WRITES = 20_000;
export const TRACKER_IGNORE_COLLECTION = "firestore_usage";

const listeners = new Set();
let flushCallback = null;
let globalTodayCache = null;

function readEnabledFlag() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return true;
}

let enabled = typeof window !== "undefined" ? readEnabledFlag() : false;

const emptyBucket = () => ({ reads: 0, writes: 0 });

const session = {
  startedAt: Date.now(),
  dayKey: formatDateBRTYYYYMMDD(),
  totalReads: 0,
  totalWrites: 0,
  totalCacheHits: 0,
  events: [],
  byCollection: {},
  bySource: {},
  byOp: {},
  byPeriod: {},
};

// Mapeamento amigável dos presets de período
const PERIOD_LABELS = {
  all: "Todo período",
  ontem: "Ontem",
  "7d": "7 dias",
  "14d": "14 dias",
  "30d": "30 dias",
  mes_atual: "Este mês",
  mes_anterior: "Mês anterior",
  custom: "Personalizado",
};

function getActivePeriodFilter() {
  if (typeof window === "undefined") return "mes_atual";
  try {
    const raw = window.localStorage.getItem("afilia:periodoFiltro");
    return raw || "mes_atual";
  } catch {
    return "mes_atual";
  }
}

// Ouvinte para atualizar o período ativo dinamicamente em tempo de execução
if (typeof window !== "undefined") {
  window.addEventListener("afilia:periodo-change", () => {
    // Forçar atualização do período ou snapshot se necessário
  });
}

function touchCollection(col) {
  if (!session.byCollection[col]) session.byCollection[col] = emptyBucket();
  return session.byCollection[col];
}

function touchSource(src) {
  if (!session.bySource[src]) session.bySource[src] = emptyBucket();
  return session.bySource[src];
}

function touchOp(op) {
  if (!session.byOp[op]) session.byOp[op] = emptyBucket();
  return session.byOp[op];
}

function touchPeriod(period) {
  const label = PERIOD_LABELS[period] || period || "desconhecido";
  if (!session.byPeriod[label]) session.byPeriod[label] = emptyBucket();
  return session.byPeriod[label];
}

function shouldSkipCollection(collection) {
  return collection === TRACKER_IGNORE_COLLECTION;
}

function persistSessionDebounced() {
  if (typeof window === "undefined" || !enabled) return;
  clearTimeout(persistSessionDebounced._t);
  persistSessionDebounced._t = setTimeout(() => {
    try {
      window.localStorage.setItem(SESSION_PERSIST_KEY, JSON.stringify({
        startedAt: session.startedAt,
        dayKey: session.dayKey,
        totalReads: session.totalReads,
        totalWrites: session.totalWrites,
        totalCacheHits: session.totalCacheHits,
        byCollection: session.byCollection,
        bySource: session.bySource,
        byOp: session.byOp,
        byPeriod: session.byPeriod,
      }));
    } catch {
      /* ignore */
    }
  }, 400);
}

function loadSessionFromStorage() {
  if (typeof window === "undefined") return;
  const today = formatDateBRTYYYYMMDD();
  try {
    const raw = window.localStorage.getItem(SESSION_PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.dayKey !== today) return;
    session.startedAt = parsed.startedAt || session.startedAt;
    session.dayKey = today;
    session.totalReads = Number(parsed.totalReads) || 0;
    session.totalWrites = Number(parsed.totalWrites) || 0;
    session.totalCacheHits = Number(parsed.totalCacheHits) || 0;
    session.byCollection = parsed.byCollection || {};
    session.bySource = parsed.bySource || {};
    session.byOp = parsed.byOp || {};
    session.byPeriod = parsed.byPeriod || {};
  } catch {
    /* ignore */
  }
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(getFirestoreTrackerSnapshot());
    } catch {
      /* ignore */
    }
  });
}

function queueGlobalFlush(delta) {
  if (flushCallback) flushCallback(delta);
}

export function isReadTrackerEnabled() {
  return enabled;
}

export function setReadTrackerEnabled(value) {
  enabled = !!value;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
  notify();
}

export function subscribeReadTracker(callback) {
  listeners.add(callback);
  callback(getFirestoreTrackerSnapshot());
  return () => listeners.delete(callback);
}

export function resetReadTracker() {
  session.startedAt = Date.now();
  session.dayKey = formatDateBRTYYYYMMDD();
  session.totalReads = 0;
  session.totalWrites = 0;
  session.totalCacheHits = 0;
  session.events = [];
  session.byCollection = {};
  session.bySource = {};
  session.byOp = {};
  try {
    window.localStorage.removeItem(SESSION_PERSIST_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function inferCollectionFromQuery(refOrQuery) {
  try {
    if (refOrQuery?.path && typeof refOrQuery.path === "string") {
      const parts = refOrQuery.path.split("/").filter(Boolean);
      if (parts.length >= 2) return parts[0];
      if (parts.length === 1) return parts[0];
    }
    const segments = refOrQuery?._query?.path?.segments;
    if (Array.isArray(segments) && segments.length > 0) return String(segments[0]);
    const canonical = refOrQuery?._query?.path?.canonicalString?.();
    if (canonical) {
      const first = String(canonical).replace(/^\//, "").split("/")[0];
      if (first) return first;
    }
  } catch {
    /* ignore */
  }
  return "desconhecido";
}

export function captureSource() {
  try {
    const stack = new Error().stack || "";
    const lines = stack.split("\n").slice(2, 24);
    for (const line of lines) {
      if (
        line.includes("readTracker")
        || line.includes("firestoreInstrumented")
        || line.includes("firestoreUsageSync")
        || line.includes("readProbe")
        || line.includes("node_modules")
        || line.includes("@firebase")
      ) continue;
      const viteMatch = line.match(/(?:[/\\]|@https?:\/\/[^/]+[/\\])src[/\\]([^:?]+\.(jsx|js|tsx|ts))/i);
      if (viteMatch) return viteMatch[1].replace(/\\/g, "/");
      const repoMatch = line.match(/((?:platforms|services|components|pages|domain|utils)[/\\][^:?]+\.(jsx|js|tsx|ts))/);
      if (repoMatch) return repoMatch[1].replace(/\\/g, "/");
      const match = line.match(/[/\\]([^/\\:?]+\.(jsx|js|tsx|ts))(?:\?|:|\)|$)/);
      if (match && !match[1].includes("chunk")) return match[1];
    }
  } catch {
    /* ignore */
  }
  return "desconhecido";
}

function pushEvent(ev) {
  const lastEv = session.events[0];
  if (
    lastEv && 
    lastEv.kind === ev.kind && 
    lastEv.op === ev.op && 
    lastEv.collection === ev.collection &&
    lastEv.source === ev.source &&
    lastEv.period === ev.period &&
    (ev.ts - lastEv.ts) < 300 // Agrupamento de rajadas de até 300ms
  ) {
    lastEv.docs += ev.docs;
    lastEv.burstCount = (lastEv.burstCount || 1) + 1;
    lastEv.durationMs = Math.max(lastEv.durationMs || 0, ev.durationMs || 0);
    lastEv.ts = ev.ts; // Atualiza pro último timestamp da rajada
    if (lastEv.burstCount >= 20 && lastEv.op === "getDoc") {
      lastEv.nPlusOneAlert = true;
    }
  } else {
    session.events.unshift(ev);
    if (session.events.length > MAX_EVENTS) session.events.length = MAX_EVENTS;
  }
}

export function trackCacheHit({ collection, docs, source }) {
  if (!enabled) return;
  const col = collection || "desconhecido";
  const count = Math.max(0, Number(docs) || 0);
  if (count === 0) return;
  const src = source || captureSource();
  const activePeriod = getActivePeriodFilter();

  session.totalCacheHits = (session.totalCacheHits || 0) + count;
  
  pushEvent({
    ts: Date.now(),
    kind: "cache",
    op: "idbGet",
    collection: col,
    docs: count,
    source: src,
    period: activePeriod,
    durationMs: 0
  });

  persistSessionDebounced();
  notify();
}

export function trackFirestoreRead({ op, collection, docs, source, durationMs }) {
  if (!enabled) return;
  const col = collection || "desconhecido";
  if (shouldSkipCollection(col)) return;

  const count = Math.max(0, Number(docs) || 0);
  if (count === 0 && op !== "getDoc") return;

  const src = source || captureSource();
  const operation = op || "read";
  const activePeriod = getActivePeriodFilter();

  session.totalReads += count;
  touchCollection(col).reads += count;
  touchSource(src).reads += count;
  touchOp(operation).reads += count;
  touchPeriod(activePeriod).reads += count;

  pushEvent({
    ts: Date.now(),
    kind: "read",
    op: operation,
    collection: col,
    docs: count,
    source: src,
    period: activePeriod,
    durationMs,
  });

  queueGlobalFlush({
    reads: count,
    writes: 0,
    collections: { [col]: { reads: count, writes: 0 } },
    sources: { [src]: { reads: count, writes: 0 } },
    ops: { [operation]: { reads: count, writes: 0 } },
  });

  persistSessionDebounced();
  notify();
}

export function trackFirestoreWrite({ op, collection, docs, source, durationMs }) {
  if (!enabled) return;
  const col = collection || "desconhecido";
  if (shouldSkipCollection(col)) return;

  const count = Math.max(1, Number(docs) || 1);
  const src = source || captureSource();
  const operation = op || "write";
  const activePeriod = getActivePeriodFilter();

  session.totalWrites += count;
  touchCollection(col).writes += count;
  touchSource(src).writes += count;
  touchOp(operation).writes += count;
  touchPeriod(activePeriod).writes += count;

  pushEvent({
    ts: Date.now(),
    kind: "write",
    op: operation,
    collection: col,
    docs: count,
    source: src,
    period: activePeriod,
    durationMs,
  });

  queueGlobalFlush({
    reads: 0,
    writes: count,
    collections: { [col]: { reads: 0, writes: count } },
    sources: { [src]: { reads: 0, writes: count } },
    ops: { [operation]: { reads: 0, writes: count } },
  });

  persistSessionDebounced();
  notify();
}

function sortCollectionEntries(map) {
  return Object.entries(map || {})
    .map(([key, bucket]) => ({
      key,
      reads: bucket?.reads || 0,
      writes: bucket?.writes || 0,
      total: (bucket?.reads || 0) + (bucket?.writes || 0),
    }))
    .sort((a, b) => b.total - a.total);
}

function sortOpEntries(map) {
  return Object.entries(map || {})
    .map(([key, bucket]) => ({
      key,
      reads: bucket?.reads || 0,
      writes: bucket?.writes || 0,
      total: (bucket?.reads || 0) + (bucket?.writes || 0),
    }))
    .sort((a, b) => b.total - a.total);
}

export function getFirestoreTrackerSnapshot(globalToday = null) {
  const global = globalToday ?? globalTodayCache;
  const elapsedMin = Math.max(1 / 60, (Date.now() - session.startedAt) / 60000);
  const sessionOps = session.totalReads + session.totalWrites;
  const globalReads = global?.reads ?? 0;
  const globalWrites = global?.writes ?? 0;
  const globalOps = globalReads + globalWrites;

  return {
    enabled,
    startedAt: session.startedAt,
    dayKey: session.dayKey,
    totalReads: session.totalReads,
    totalWrites: session.totalWrites,
    totalCacheHits: session.totalCacheHits || 0,
    totalOps: sessionOps,
    readsPerMinute: Math.round(session.totalReads / elapsedMin),
    writesPerMinute: Math.round(session.totalWrites / elapsedMin),
    projectedDailyReads: Math.round((session.totalReads / elapsedMin) * 60 * 24),
    projectedDailyWrites: Math.round((session.totalWrites / elapsedMin) * 60 * 24),
    freeTierDailyReads: FREE_TIER_DAILY_READS,
    freeTierDailyWrites: FREE_TIER_DAILY_WRITES,
    pctReadsOfFreeTier: Math.round((session.totalReads / FREE_TIER_DAILY_READS) * 1000) / 10,
    pctWritesOfFreeTier: Math.round((session.totalWrites / FREE_TIER_DAILY_WRITES) * 1000) / 10,
    globalToday: global || null,
    globalPctReadsOfFreeTier: Math.round((globalReads / FREE_TIER_DAILY_READS) * 1000) / 10,
    globalPctWritesOfFreeTier: Math.round((globalWrites / FREE_TIER_DAILY_WRITES) * 1000) / 10,
    globalProjectedDailyReads: global?.projectedDailyReads ?? null,
    globalProjectedDailyWrites: global?.projectedDailyWrites ?? null,
    byCollection: sortCollectionEntries(session.byCollection),
    bySource: sortCollectionEntries(session.bySource),
    byOp: sortOpEntries(session.byOp),
    byPeriod: sortCollectionEntries(session.byPeriod), // Exposição ordenada do novo agrupamento
    recentEvents: session.events.slice(0, 40),
    // compat legado
    totalReadsLegacy: session.totalReads,
    projectedDaily: Math.round((session.totalReads / elapsedMin) * 60 * 24),
    freeTierDaily: FREE_TIER_DAILY_READS,
    pctOfFreeTier: Math.round((globalReads / FREE_TIER_DAILY_READS) * 1000) / 10,
    globalOps,
  };
}

export function getReadTrackerSnapshot(globalToday = null) {
  return getFirestoreTrackerSnapshot(globalToday);
}

export function setGlobalTodayCache(data) {
  globalTodayCache = data;
  notify();
}

export function registerFlushCallback(fn) {
  flushCallback = fn;
}

export function initFirestoreTracker() {
  if (typeof window === "undefined") return;
  loadSessionFromStorage();
  session.dayKey = formatDateBRTYYYYMMDD();
  notify();
}

export function markSessionRegisteredForDay(dayKey) {
  try {
    window.localStorage.setItem(`${SESSION_REGISTERED_PREFIX}${dayKey}`, "1");
  } catch {
    /* ignore */
  }
}

export function isSessionRegisteredForDay(dayKey) {
  try {
    return window.localStorage.getItem(`${SESSION_REGISTERED_PREFIX}${dayKey}`) === "1";
  } catch {
    return false;
  }
}

/** Exposto no console: window.__afiliaReadTracker */
export function exposeReadTrackerGlobally() {
  if (typeof window === "undefined") return;
  const api = {
    snapshot: () => getFirestoreTrackerSnapshot(),
    reset: resetReadTracker,
    enable: () => setReadTrackerEnabled(true),
    disable: () => setReadTrackerEnabled(false),
  };
  window.__afiliaReadTracker = api;
  window.__afiliaFirestoreTracker = api;
}

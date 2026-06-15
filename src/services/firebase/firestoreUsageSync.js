/**
 * Agrega uso do Firestore (leituras/gravações) em firestore_usage/{YYYY-MM-DD}.
 * Usa SDK nativo para não contar as próprias operações do diagnóstico.
 */

import {
  doc,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "@firebase/firestore-native";
import { db } from "./client.js";
import { formatDateBRTYYYYMMDD } from "../../utils/dates";
import {
  isSessionRegisteredForDay,
  markSessionRegisteredForDay,
  registerFlushCallback,
  setGlobalTodayCache,
  TRACKER_IGNORE_COLLECTION,
} from "./readTracker.js";

const COLLECTION = TRACKER_IGNORE_COLLECTION;
const FLUSH_INTERVAL_MS = 15_000;

let pending = createEmptyPending();
let flushTimer = null;
let globalUnsub = null;
let globalToday = null;
const globalListeners = new Set();

function createEmptyPending() {
  return {
    reads: 0,
    writes: 0,
    collections: {},
    sources: {},
    ops: {},
    registerSession: false,
  };
}

function sanitizeMapKey(key) {
  return String(key || "desconhecido").replace(/\//g, "__").slice(0, 120);
}

function desanitizeMapKey(key) {
  return String(key).replace(/__/g, "/");
}

function mergeBucket(target, key, delta) {
  if (!target[key]) target[key] = { reads: 0, writes: 0 };
  target[key].reads += delta.reads || 0;
  target[key].writes += delta.writes || 0;
}

function mergePendingDelta(delta) {
  if (!delta) return;
  pending.reads += delta.reads || 0;
  pending.writes += delta.writes || 0;
  for (const [col, bucket] of Object.entries(delta.collections || {})) {
    mergeBucket(pending.collections, col, bucket);
  }
  for (const [src, bucket] of Object.entries(delta.sources || {})) {
    mergeBucket(pending.sources, src, bucket);
  }
  for (const [op, bucket] of Object.entries(delta.ops || {})) {
    mergeBucket(pending.ops, op, bucket);
  }
  if (delta.registerSession) pending.registerSession = true;
}

function hasPendingData() {
  return pending.reads > 0
    || pending.writes > 0
    || pending.registerSession
    || Object.keys(pending.collections).length > 0;
}

function dayDocRef(dayKey = formatDateBRTYYYYMMDD()) {
  return doc(db, COLLECTION, dayKey);
}

function parseGlobalDoc(data, dayKey) {
  if (!data) {
    return {
      dayKey,
      reads: 0,
      writes: 0,
      sessions: 0,
      collections: [],
      sources: [],
      ops: [],
      updatedAt: null,
      projectedDailyReads: 0,
    };
  }

  const reads = Number(data.reads) || 0;
  const writes = Number(data.writes) || 0;
  const startedMs = data.startedAt?.toMillis?.() || data.startedAt || Date.now();
  const elapsedMin = Math.max(1 / 60, (Date.now() - startedMs) / 60000);

  const mapToRows = (map = {}) => Object.entries(map)
    .map(([key, bucket]) => ({
      key: desanitizeMapKey(key),
      reads: Number(bucket?.reads) || 0,
      writes: Number(bucket?.writes) || 0,
      total: (Number(bucket?.reads) || 0) + (Number(bucket?.writes) || 0),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    dayKey,
    reads,
    writes,
    sessions: Number(data.sessions) || 0,
    collections: mapToRows(data.collections),
    sources: mapToRows(data.sources),
    ops: mapToRows(data.ops),
    updatedAt: data.updatedAt?.toDate?.() || null,
    projectedDailyReads: Math.round((reads / elapsedMin) * 60 * 24),
    projectedDailyWrites: Math.round((writes / elapsedMin) * 60 * 24),
  };
}

function notifyGlobalListeners() {
  setGlobalTodayCache(globalToday);
  globalListeners.forEach((fn) => {
    try {
      fn(globalToday);
    } catch {
      /* ignore */
    }
  });
}

async function flushPendingToFirestore() {
  if (!hasPendingData()) return;

  const dayKey = formatDateBRTYYYYMMDD();
  const payload = pending;
  pending = createEmptyPending();

  const ref = dayDocRef(dayKey);
  const patch = {
    date: dayKey,
    reads: increment(payload.reads || 0),
    writes: increment(payload.writes || 0),
    updatedAt: serverTimestamp(),
  };

  if (payload.registerSession) {
    patch.sessions = increment(1);
  }

  for (const [col, bucket] of Object.entries(payload.collections)) {
    if (bucket.reads) patch[`collections.${col}.reads`] = increment(bucket.reads);
    if (bucket.writes) patch[`collections.${col}.writes`] = increment(bucket.writes);
  }
  for (const [src, bucket] of Object.entries(payload.sources)) {
    const safe = sanitizeMapKey(src);
    if (bucket.reads) patch[`sources.${safe}.reads`] = increment(bucket.reads);
    if (bucket.writes) patch[`sources.${safe}.writes`] = increment(bucket.writes);
  }
  for (const [op, bucket] of Object.entries(payload.ops)) {
    if (bucket.reads) patch[`ops.${op}.reads`] = increment(bucket.reads);
    if (bucket.writes) patch[`ops.${op}.writes`] = increment(bucket.writes);
  }

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, patch);
    } else {
      const initial = {
        date: dayKey,
        reads: payload.reads || 0,
        writes: payload.writes || 0,
        sessions: payload.registerSession ? 1 : 0,
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        collections: {},
        sources: {},
        ops: {},
      };
      for (const [col, bucket] of Object.entries(payload.collections)) {
        initial.collections[col] = { reads: bucket.reads || 0, writes: bucket.writes || 0 };
      }
      for (const [src, bucket] of Object.entries(payload.sources)) {
        initial.sources[sanitizeMapKey(src)] = { reads: bucket.reads || 0, writes: bucket.writes || 0 };
      }
      for (const [op, bucket] of Object.entries(payload.ops)) {
        initial.ops[op] = { reads: bucket.reads || 0, writes: bucket.writes || 0 };
      }
      await setDoc(ref, initial);
    }
  } catch (err) {
    console.warn("[firestoreUsageSync] flush falhou, re-enfileirando:", err?.message || err);
    mergePendingDelta({
      reads: payload.reads,
      writes: payload.writes,
      collections: payload.collections,
      sources: Object.fromEntries(
        Object.entries(payload.sources).map(([k, v]) => [k.replace(/__/g, "/"), v]),
      ),
      ops: payload.ops,
      registerSession: payload.registerSession,
    });
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushPendingToFirestore();
  }, FLUSH_INTERVAL_MS);
}

function registerBrowserSessionOnce() {
  const dayKey = formatDateBRTYYYYMMDD();
  if (isSessionRegisteredForDay(dayKey)) return;
  markSessionRegisteredForDay(dayKey);
  mergePendingDelta({ registerSession: true });
  scheduleFlush();
}

export function subscribeGlobalUsage(callback) {
  globalListeners.add(callback);
  if (globalToday) callback(globalToday);
  return () => globalListeners.delete(callback);
}

export function getGlobalUsageToday() {
  return globalToday;
}

function startGlobalListener() {
  if (globalUnsub) return;
  const dayKey = formatDateBRTYYYYMMDD();
  globalUnsub = onSnapshot(dayDocRef(dayKey), (snap) => {
    globalToday = parseGlobalDoc(snap.exists() ? snap.data() : null, dayKey);
    notifyGlobalListeners();
  }, (err) => {
    console.warn("[firestoreUsageSync] listener global:", err?.message || err);
  });
}

export function startFirestoreUsageSync() {
  if (typeof window === "undefined") return () => {};

  registerFlushCallback((delta) => {
    mergePendingDelta(delta);
    scheduleFlush();
  });

  registerBrowserSessionOnce();
  startGlobalListener();

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      void flushPendingToFirestore();
    }
  };
  const onUnload = () => {
    void flushPendingToFirestore();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onUnload);

  const interval = setInterval(() => {
    void flushPendingToFirestore();
    const today = formatDateBRTYYYYMMDD();
    if (globalToday?.dayKey && globalToday.dayKey !== today) {
      globalUnsub?.();
      globalUnsub = null;
      startGlobalListener();
    }
  }, FLUSH_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    clearTimeout(flushTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onUnload);
    globalUnsub?.();
    globalUnsub = null;
    void flushPendingToFirestore();
  };
}

export async function fetchGlobalUsageForDay(dayKey = formatDateBRTYYYYMMDD()) {
  const snap = await getDoc(dayDocRef(dayKey));
  return parseGlobalDoc(snap.exists() ? snap.data() : null, dayKey);
}

/**
 * Meta Ads — leitura Firestore (sync via Cloud Functions).
 */

import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { idbGet, idbSet } from "../../dashboard/cache/indexedDbCache";
import { trackCacheHit } from "../../../services/firebase/readTracker";
import { COLLECTIONS } from "../../../services/firebase/firestore";

const metaAdsCache = new Map();
const IDB_PREFIX = "metaAds:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getMetaAds(importacaoId = null) {
  const cacheKey = importacaoId || "all";
  
  if (metaAdsCache.has(cacheKey)) {
    const mem = metaAdsCache.get(cacheKey);
    if (Date.now() - mem.ts < CACHE_TTL_MS) return mem.data;
  }
  
  const idbKey = IDB_PREFIX + cacheKey;
  const idbEntry = await idbGet(idbKey);
  if (idbEntry && Date.now() - idbEntry.ts < CACHE_TTL_MS) {
    metaAdsCache.set(cacheKey, idbEntry);
    trackCacheHit({ collection: "meta_ads", docs: idbEntry.data.length, source: "metaRepository.js" });
    return idbEntry.data;
  }

  const base = collection(db, COLLECTIONS.META_ADS);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  const result = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  
  const entry = { data: result, ts: Date.now() };
  metaAdsCache.set(cacheKey, entry);
  idbSet(idbKey, entry).catch(() => {});
  
  return result;
}

export function clearMetaAdsCache() {
  metaAdsCache.clear();
  // Letting TTL or forced clear handle IDB
}

export async function getMetaDemographics() {
  const base = collection(db, COLLECTIONS.META_DEMOGRAPHICS);
  const snap = await getDocs(query(base, orderBy("importadoEm", "desc"), limit(1)));
  const docSnap = snap.docs[0];
  return docSnap ? { id: docSnap.id, ...docSnap.data() } : null;
}

/**
 * Meta Ads - leitura do Supabase.
 */

import { supabase } from "../../../services/supabase/client";
import { idbGet, idbSet } from "../../dashboard/cache/indexedDbCache";

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
    return idbEntry.data;
  }

  let query = supabase.from("meta_ads").select("id, data_blob");
  if (importacaoId) {
    query = query.eq("data_blob->>importacaoId", importacaoId);
  }
  
  const { data: snap, error } = await query;
  if (error) {
    console.warn("Erro lendo meta_ads:", error);
    return [];
  }
  
  const result = (snap || []).map((d) => ({ id: d.id, ...(d.data_blob || {}) }));
  
  const entry = { data: result, ts: Date.now() };
  metaAdsCache.set(cacheKey, entry);
  idbSet(idbKey, entry).catch(() => {});
  
  return result;
}

export function clearMetaAdsCache() {
  metaAdsCache.clear();
}

export async function getMetaDemographics() {
  const { data: snap, error } = await supabase
    .from("meta_demographics")
    .select("id, data_blob")
    .order("data_blob->>importadoEm", { ascending: false })
    .limit(1);
    
  if (error || !snap || snap.length === 0) return null;
  const docSnap = snap[0];
  return { id: docSnap.id, ...(docSnap.data_blob || {}) };
}

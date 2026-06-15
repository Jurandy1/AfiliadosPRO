import { idbGet, idbSet, idbClear } from "../../dashboard/cache/indexedDbCache";
import { trackCacheHit } from "../../../services/firebase/readTracker";

const TTL_MS = 30 * 60 * 1000;
export const CADASTRO_TTL_MS = 24 * 60 * 60 * 1000;
const SS_PREFIX = "prodCadastro:";

let fullScanCache = null;
const cadastroMem = new Map();

export function getProdutosFullScanCache() {
  if (!fullScanCache) return null;
  if (Date.now() - fullScanCache.ts > TTL_MS) {
    fullScanCache = null;
    return null;
  }
  return fullScanCache.data;
}

export function setProdutosFullScanCache(data) {
  fullScanCache = { data, ts: Date.now() };
}

export async function cadastroGet(docId) {
  const m = cadastroMem.get(docId);
  if (m && Date.now() - m.ts < CADASTRO_TTL_MS) return m.data;
  
  const idbKey = SS_PREFIX + docId;
  const e = await idbGet(idbKey);
  if (e && Date.now() - e.ts < CADASTRO_TTL_MS) {
    cadastroMem.set(docId, e);
    trackCacheHit({ collection: "produtos", docs: 1, source: "produtosCache.js" });
    return e.data;
  }
  
  return null;
}

export function cadastroSet(docId, data) {
  const e = { data, ts: Date.now() };
  cadastroMem.set(docId, e);
  const idbKey = SS_PREFIX + docId;
  idbSet(idbKey, e).catch(() => {});
}

export function invalidateProdutosCache() {
  fullScanCache = null;
  cadastroMem.clear();
  // We won't clear the entire IDB here because it holds dashboard data too.
  // Instead we let TTL handle expired products, or they will be refreshed as needed.
}

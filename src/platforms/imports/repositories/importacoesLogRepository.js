import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";

const IMPORTACOES_LIMIT = 120;
const LATEST_IMPORTS_DOC = "importacoes_latest";
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

const TIPO_TO_FIELD = {
  meta_ads: "metaAds",
  pinterest: "pinterest",
  shopee_venda: "shopeeVenda",
  shopee_clique: "shopeeClique",
};

let sessionCache = null;
let sessionCacheTs = 0;

export function pickLatestImport(importacoes, tipo) {
  return [...(importacoes || [])]
    .filter((item) => item.tipo === tipo)
    .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0] || null;
}

/** Atualiza ponteiro de última importação por tipo (1 write). */
export async function touchImportacoesLatest(tipo, importId) {
  const field = TIPO_TO_FIELD[tipo];
  if (!field || !importId) return;
  try {
    await setDoc(doc(db, "sync_state", LATEST_IMPORTS_DOC), {
      [field]: importId,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    sessionCache = null;
  } catch (err) {
    console.warn("[touchImportacoesLatest]", err?.message || err);
  }
}

/** IDs das últimas importações — 1 read em sync_state/importacoes_latest. */
export async function getLatestImportIds() {
  const now = Date.now();
  if (sessionCache && now - sessionCacheTs < SESSION_CACHE_TTL_MS) {
    return sessionCache;
  }

  try {
    const snap = await getDoc(doc(db, "sync_state", LATEST_IMPORTS_DOC));
    if (snap.exists()) {
      const d = snap.data() || {};
      sessionCache = {
        metaAds: d.metaAds || null,
        pinterest: d.pinterest || null,
        shopeeVenda: d.shopeeVenda || null,
        shopeeClique: d.shopeeClique || null,
      };
      sessionCacheTs = now;
      return sessionCache;
    }
  } catch {
    /* fallback abaixo */
  }

  const importacoes = await getImportacoes(50);
  sessionCache = {
    metaAds: pickLatestImport(importacoes, "meta_ads")?.id || null,
    pinterest: pickLatestImport(importacoes, "pinterest")?.id || null,
    shopeeVenda: pickLatestImport(importacoes, "shopee_venda")?.id || null,
    shopeeClique: pickLatestImport(importacoes, "shopee_clique")?.id || null,
  };
  sessionCacheTs = now;
  return sessionCache;
}

/** Leitura leve do log de importações — sem dependência de xlsx/parsers. */
export async function getImportacoes(maxDocs = IMPORTACOES_LIMIT) {
  const cap = Math.max(1, Number(maxDocs) || IMPORTACOES_LIMIT);
  try {
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.IMPORTACOES),
        orderBy("importadoEm", "desc"),
        limit(cap),
      ),
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(collection(db, COLLECTIONS.IMPORTACOES), limit(cap)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

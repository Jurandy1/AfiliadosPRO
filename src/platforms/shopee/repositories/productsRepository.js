import {
  collection, doc, documentId, getDoc, getDocs, deleteDoc, setDoc, serverTimestamp, query, where,
} from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";
import {
  cadastroGet,
  cadastroSet,
  getProdutosFullScanCache,
  invalidateProdutosCache,
} from "./produtosCache";
import { dedupeAdIds } from "../../../utils/adLinkIds";

export { invalidateProdutosCache };

/** Busca cadastro só dos IDs necessários (30 por query) — evita scan de 20k+ docs. */
export async function getProdutosByItemIds(itemIds = []) {
  const docIds = [...new Set(
    (itemIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .map((id) => (id.startsWith("item_") ? id : `item_${id}`)),
  )];
  if (!docIds.length) return [];

  const hits = [];
  const missing = [];
  for (const docId of docIds) {
    const cached = await cadastroGet(docId);
    if (cached != null) {
      if (!cached._notFound) hits.push({ id: docId, ...cached });
    } else {
      missing.push(docId);
    }
  }

  const fetched = [];
  for (let i = 0; i < missing.length; i += 30) {
    const chunk = missing.slice(i, i + 30);
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.PRODUTOS),
      where(documentId(), "in", chunk),
    )).catch(() => ({ docs: [] }));
    const foundIds = new Set(snap.docs.map((d) => d.id));
    snap.docs.forEach((d) => {
      const data = d.data();
      cadastroSet(d.id, data);
      fetched.push({ id: d.id, ...data });
    });
    for (const docId of chunk) {
      if (!foundIds.has(docId)) {
        cadastroSet(docId, { _notFound: true });
      }
    }
  }
  return [...hits, ...fetched];
}

export async function getProdutos(importacaoId = null) {
  if (!importacaoId) {
    return getProdutosFullScanCache() || [];
  }
  const base = collection(db, COLLECTIONS.PRODUTOS);
  const q = query(base, where("importacaoId", "==", importacaoId));
  const snap = await getDocs(q);
  if (snap.empty) {
    return [];
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteProduto(id) {
  await deleteDoc(doc(db, COLLECTIONS.PRODUTOS, id));
  invalidateProdutosCache();
}

export async function getCliques(importacaoId = null) {
  const base = collection(db, COLLECTIONS.CLIQUES);
  const q = importacaoId ? query(base, where("importacaoId", "==", importacaoId)) : base;
  const snap = await getDocs(q);
  if (importacaoId && snap.empty) {
    const fallback = await getDocs(base);
    return fallback.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSubIdVendas() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.SUBID_VENDAS));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn("[subid_vendas] Leitura falhou:", error?.code, error?.message);
    throw error;
  }
}

export async function saveProductLink(produtoId, link_afiliado) {
  await setDoc(
    doc(db, COLLECTIONS.PRODUTOS, produtoId),
    { link_afiliado: (link_afiliado || "").trim(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  invalidateProdutosCache();
}

async function loadAdSpendIndex(collectionName, adIds = []) {
  const index = {};
  const unique = dedupeAdIds(adIds);
  await Promise.all(unique.map(async (id) => {
    const snap = await getDoc(doc(db, collectionName, id)).catch(() => null);
    if (snap?.exists()) index[id] = snap.data();
  }));
  return index;
}

export async function saveAdLink(produtoId, { metaAdIds = [], pinterestAdIds = [] }) {
  const metaUnique = dedupeAdIds(metaAdIds);
  const pinUnique = dedupeAdIds(pinterestAdIds);

  const [metaIndex, pinIndex] = await Promise.all([
    loadAdSpendIndex(COLLECTIONS.META_ADS, metaUnique),
    loadAdSpendIndex(COLLECTIONS.PINTEREST, pinUnique),
  ]);

  const investimentoMeta = metaUnique.reduce((sum, id) => sum + (metaIndex[id]?.valorUsado || 0), 0);
  const investimentoPin  = pinUnique.reduce((sum, id) => sum + (pinIndex[id]?.spend || 0), 0);
  const investimento     = Math.round((investimentoMeta + investimentoPin) * 100) / 100;

  await setDoc(
    doc(db, COLLECTIONS.PRODUTOS, produtoId),
    { metaAdIds: metaUnique, pinterestAdIds: pinUnique, investimento, updatedAt: serverTimestamp() },
    { merge: true },
  );
  invalidateProdutosCache();

  return { investimento, metaAdIds: metaUnique, pinterestAdIds: pinUnique };
}

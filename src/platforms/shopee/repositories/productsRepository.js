import { supabase } from "../../../services/supabase/client";
import { dedupeAdIds } from "../../../utils/adLinkIds";
import {
  cadastroGet,
  cadastroSet,
  getProdutosFullScanCache,
  invalidateProdutosCache,
} from "./produtosCache";

export { invalidateProdutosCache };

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
    const { data: snap, error } = await supabase
      .from("produtos")
      .select("*")
      .in("doc_id", chunk);

    if (error) {
      console.warn("[produtos] Erro getProdutosByItemIds:", error);
      continue;
    }

    const foundIds = new Set((snap || []).map((d) => d.doc_id));
    (snap || []).forEach((d) => {
      cadastroSet(d.doc_id, d);
      fetched.push({ id: d.doc_id, ...d });
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
  const { data: snap, error } = await supabase
    .from("produtos")
    .select("*")
    .eq("importacao_id", importacaoId);

  if (error || !snap) return [];
  return snap.map((d) => ({ id: d.doc_id, ...d }));
}

export async function deleteProduto(id) {
  await supabase.from("produtos").delete().eq("doc_id", id);
  invalidateProdutosCache();
}

export async function getCliques(importacaoId = null) {
  return [];
}

export async function getSubIdVendas() {
  return [];
}

export async function saveProductLink(produtoId, link_afiliado) {
  await supabase
    .from("produtos")
    .update({
      link_afiliado: (link_afiliado || "").trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("doc_id", produtoId);
  invalidateProdutosCache();
}

export async function saveAdLink(produtoId, { metaAdIds = [], pinterestAdIds = [] }) {
  const metaUnique = dedupeAdIds(metaAdIds);
  const pinUnique = dedupeAdIds(pinterestAdIds);

  let investimentoMeta = 0;
  if (metaUnique.length > 0) {
    const { data: mData } = await supabase.from("meta_ads").select("data_blob").in("ad_id", metaUnique);
    (mData || []).forEach(d => { investimentoMeta += (d.data_blob?.valorUsado || 0); });
  }

  let investimentoPin = 0;
  if (pinUnique.length > 0) {
    const { data: pData } = await supabase.from("pinterest_ads").select("data_blob").in("ad_id", pinUnique);
    (pData || []).forEach(d => { investimentoPin += (d.data_blob?.spend || 0); });
  }

  const investimento = Math.round((investimentoMeta + investimentoPin) * 100) / 100;

  await supabase
    .from("produtos")
    .update({
      canais: { metaAdIds: metaUnique, pinterestAdIds: pinUnique, investimento },
      updated_at: new Date().toISOString(),
    })
    .eq("doc_id", produtoId);

  invalidateProdutosCache();

  return { investimento, metaAdIds: metaUnique, pinterestAdIds: pinUnique };
}

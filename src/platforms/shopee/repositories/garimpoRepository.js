import { supabase } from "../../../services/supabase/client";

export async function getUltimaDataGarimpo() {
  const { data: snap } = await supabase
    .from("garimpo_produtos")
    .select("data_blob")
    .order("data_blob->>data_garimpo", { ascending: false })
    .limit(1);
    
  if (!snap || snap.length === 0) return null;
  return snap[0].data_blob?.data_garimpo || null;
}

export async function fetchProdutosGarimpoByData(ultimaData, maxDocs = 500) {
  if (!ultimaData) return [];

  const { data: snap } = await supabase
    .from("garimpo_produtos")
    .select("id, data_blob")
    .eq("data_blob->>data_garimpo", ultimaData)
    .order("data_blob->>score_oportunidade", { ascending: false })
    .limit(maxDocs);

  const produtos = [];
  (snap || []).forEach(d => {
    produtos.push({ id: d.id, ...(d.data_blob || {}) });
  });
  return produtos;
}

export async function getProdutosGarimpoUltimoDia(maxDocs = 500) {
  const ultimaData = await getUltimaDataGarimpo();
  if (!ultimaData) return { data: null, produtos: [] };

  const produtos = await fetchProdutosGarimpoByData(ultimaData, maxDocs);
  return { data: ultimaData, produtos };
}

export function separarPorCategoria(produtos) {
  const jaVendo = produtos.filter((p) => p.ja_vendi);
  const descoberta = produtos.filter((p) => !p.ja_vendi);
  return { jaVendo, descoberta };
}

export async function fetchRecompraGarimpoByData(ultimaData, maxDocs = 50) {
  if (!ultimaData) return { data: null, produtos: [] };

  const { data: snap, error } = await supabase
    .from("garimpo_recompra")
    .select("id, data_blob")
    .eq("data_blob->>data_garimpo", ultimaData)
    .limit(maxDocs);

  if (error || !snap || snap.length === 0) {
    const todos = await fetchProdutosGarimpoByData(ultimaData, Math.max(maxDocs * 3, 150));
    const produtos = todos.filter((p) => p.ja_vendi).slice(0, maxDocs);
    produtos.sort((a, b) => Number(b.minha_comissao_historica || 0) - Number(a.minha_comissao_historica || 0));
    return { data: ultimaData, produtos, fallback: true };
  }

  const produtos = [];
  snap.forEach(d => {
    produtos.push({ id: d.id, ...(d.data_blob || {}) });
  });
  produtos.sort((a, b) => Number(b.minha_comissao_historica || 0) - Number(a.minha_comissao_historica || 0));
  return { data: ultimaData, produtos };
}

export async function getProdutosGarimpoRecompra(maxDocs = 50) {
  const ultimaData = await getUltimaDataGarimpo();
  return fetchRecompraGarimpoByData(ultimaData, maxDocs);
}

export async function getAlertasGarimpoRecentes(limitN = 8) {
  const { data: snap } = await supabase
    .from("garimpo_alertas")
    .select("id, data_blob")
    .eq("data_blob->>arquivado", "false")
    .order("data_blob->>createdAt", { ascending: false })
    .limit(limitN);

  const list = [];
  (snap || []).forEach(d => {
    list.push({ id: d.id, ...(d.data_blob || {}) });
  });
  list.sort((a, b) => {
    const aVal = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
    const bVal = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
    return bVal - aVal;
  });
  return list;
}

export async function arquivarAlertaGarimpo(alertaId) {
  if (!alertaId) return;
  const { data: d } = await supabase.from("garimpo_alertas").select("data_blob").eq("id", alertaId).single();
  if (d) {
    d.data_blob.arquivado = true;
    await supabase.from("garimpo_alertas").update({ data_blob: d.data_blob }).eq("id", alertaId);
  }
}

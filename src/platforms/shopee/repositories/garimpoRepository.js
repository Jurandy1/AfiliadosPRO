import { supabase } from "../../../services/supabase/client";
import { getProdutosByItemIds } from "./productsRepository";


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

export function diasRestantesPeriodo(periodoFim) {
  if (!periodoFim) return null;
  const diff = Number(periodoFim) - Math.floor(Date.now() / 1000);
  return Math.floor(diff / 86400);
}


async function buildHistoricoMapForItemIds(itemIds = []) {
  const produtos = await getProdutosByItemIds(itemIds);
  const map = {};
  for (const x of produtos) {
    const id = String(x.id_item || x.id?.replace(/^item_/, "") || "").trim();
    if (!id) continue;
    const concl = Number(x.pedidos_concluidos || 0);
    const canc = Number(x.pedidos_cancelados || 0);
    const totalPed = concl + canc;
    map[id] = {
      vendas: Number(x.vendas || 0),
      comissao_total: Number(x.comissao_total || 0),
      gmv_total: Number(x.gmv_total || 0),
      pedidos_cancelados: canc,
      pedidos_pendentes: Number(x.pedidos_pendentes || 0),
      pedidos_concluidos: concl,
      taxa_cancelamento: totalPed > 0 ? canc / totalPed : 0,
      loja: x.loja || "",
      nome: x.nome || "",
    };
  }
  return map;
}

function calcScoreHistorico(produto, historico) {
  let score = Number(produto.score_oportunidade || 0);
  const vendas = Number(historico?.vendas ?? produto.minhas_vendas ?? 0);
  const comissao = Number(historico?.comissao_total ?? produto.minha_comissao_historica ?? 0);
  if (vendas >= 3) score += 12;
  if (vendas >= 10) score += 8;
  if (comissao >= 30) score += 10;
  if ((historico?.taxa_cancelamento || 0) >= 0.25) score -= 18;
  if (Number(produto.delta_comissao_pct || 0) > 0) score += 6;
  return Math.round(Math.min(100, Math.max(0, score)));
}

export async function getGarimpoInteligenteHistorico(maxDocs = 300) {
  const { data, produtos } = await getProdutosGarimpoUltimoDia(maxDocs);
  const histMap = await buildHistoricoMapForItemIds(produtos.map((p) => p.itemId));

  const enriquecidos = produtos.map((p) => {
    const h = histMap[String(p.itemId || "")];
    const ja_vendi = Boolean(p.ja_vendi || (h && h.vendas > 0));
    return {
      ...p,
      ja_vendi,
      minhas_vendas: h?.vendas ?? p.minhas_vendas ?? 0,
      minha_comissao_historica: h?.comissao_total ?? p.minha_comissao_historica ?? 0,
      taxa_cancelamento: h?.taxa_cancelamento ?? 0,
      pedidos_cancelados: h?.pedidos_cancelados ?? 0,
      score_historico: calcScoreHistorico(p, h),
    };
  });

  enriquecidos.sort((a, b) => b.score_historico - a.score_historico);
  return {
    data,
    jaVendo: enriquecidos.filter((p) => p.ja_vendi),
    descoberta: enriquecidos.filter((p) => !p.ja_vendi),
  };
}

export async function getRadarRecompraEnriquecido(maxDocs = 40) {
  const { data, produtos } = await getProdutosGarimpoRecompra(maxDocs);
  const histMap = await buildHistoricoMapForItemIds(produtos.map((p) => p.itemId));

  const itens = produtos.map((p) => {
    const h = histMap[String(p.itemId || "")];
    const comissaoAtual = Number(p.comissao_pct || 0);
    const comissaoHistPct = h?.comissao_total && h?.vendas
      ? (h.comissao_total / Math.max(h.vendas, 1)) / Math.max(Number(p.preco_min || p.preco || 1), 1) * 100
      : 0;
    return {
      ...p,
      minhas_vendas: h?.vendas ?? p.minhas_vendas ?? 0,
      minha_comissao_historica: h?.comissao_total ?? p.minha_comissao_historica ?? 0,
      taxa_cancelamento: h?.taxa_cancelamento ?? 0,
      comissao_subiu: comissaoAtual > comissaoHistPct * 1.1,
      prioridade: Number(p.minha_comissao_historica || h?.comissao_total || 0),
    };
  });

  itens.sort((a, b) => b.prioridade - a.prioridade);
  return { data, produtos: itens };
}

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { getProdutosByItemIds } from "./productsRepository";

export async function getUltimaDataGarimpo() {
  const q = query(
    collection(db, "garimpo_produtos"),
    orderBy("data_garimpo", "desc"),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data().data_garimpo || null;
}

export async function fetchProdutosGarimpoByData(ultimaData, maxDocs = 500) {
  if (!ultimaData) return [];

  const q = query(
    collection(db, "garimpo_produtos"),
    where("data_garimpo", "==", ultimaData),
    orderBy("score_oportunidade", "desc"),
    limit(maxDocs),
  );
  const snap = await getDocs(q);
  const produtos = [];
  snap.forEach((docSnap) => produtos.push({ id: docSnap.id, ...docSnap.data() }));
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

  const q = query(
    collection(db, "garimpo_recompra"),
    where("data_garimpo", "==", ultimaData),
    limit(maxDocs),
  );
  try {
    const snap = await getDocs(q);
    const produtos = [];
    snap.forEach((docSnap) => produtos.push({ id: docSnap.id, ...docSnap.data() }));
    produtos.sort((a, b) => Number(b.minha_comissao_historica || 0) - Number(a.minha_comissao_historica || 0));
    return { data: ultimaData, produtos };
  } catch (err) {
    const denied = err?.code === "permission-denied"
      || String(err?.message || "").toLowerCase().includes("permission");
    if (!denied) throw err;
    const todos = await fetchProdutosGarimpoByData(ultimaData, Math.max(maxDocs * 3, 150));
    const produtos = todos
      .filter((p) => p.ja_vendi)
      .slice(0, maxDocs);
    produtos.sort((a, b) => Number(b.minha_comissao_historica || 0) - Number(a.minha_comissao_historica || 0));
    return { data: ultimaData, produtos, fallback: true };
  }
}

export async function getProdutosGarimpoRecompra(maxDocs = 50) {
  const ultimaData = await getUltimaDataGarimpo();
  return fetchRecompraGarimpoByData(ultimaData, maxDocs);
}
export async function getAlertasGarimpoRecentes(limitN = 8) {
  const colRef = collection(db, "garimpo_alertas");
  const primaryQuery = query(
    colRef,
    where("arquivado", "==", false),
    orderBy("createdAt", "desc"),
    limit(limitN),
  );
  try {
    const snap = await getDocs(primaryQuery);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    return list;
  } catch {
    const snap = await getDocs(query(colRef, where("arquivado", "==", false), limit(limitN)));
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const ta = a?.createdAt?.toMillis?.() || 0;
      const tb = b?.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    return list;
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

/** Garimpo enriquecido com histórico real (conversionReport → produtos). */
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

/** Radar de recompra com histórico + comissão atual da API. */
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

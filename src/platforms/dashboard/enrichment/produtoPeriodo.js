import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";
import { calcMetrics } from "../../../domain/metrics/productMetrics";
import { dedupeAdIds } from "../../../utils/adLinkIds";
import { normalizeSubId } from "../../../utils/normalizeSubId";
import { getMetaAds } from "../../meta/repositories/metaRepository";
import { getPinterest } from "../../pinterest/repositories/pinterestRepository";
import { getLatestImportIds } from "../../imports/repositories/importacoesLogRepository";
import { getProdutosByItemIds } from "../../shopee/repositories/productsRepository";
import {
  buildMetaBySubForPeriod,
  buildMetaBySubLifetime,
  buildPinBySubForPeriod,
  buildPinBySubLifetime,
} from "./adsPeriodSpend";

const CADASTRO_SKIP_IDS = new Set(["", "_cauda_longa", "desconhecido"]);

/** Índice `${data}__${subid}` → cliques (Tier 2). */
export async function fetchCliqueDailyIndex(startDate, endDate) {
  if (!startDate || !endDate) return {};
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.CLIQUE_DAILY),
    where("data", ">=", startDate),
    where("data", "<=", endDate),
  )).catch(() => ({ empty: true, forEach: () => {} }));

  const index = {};
  snap.forEach((d) => {
    const x = d.data() || {};
    const sid = normalizeSubId(x.subid || x.sub_id_norm || "");
    const data = x.data;
    if (!sid || !data) return;
    index[`${data}__${sid}`] = (index[`${data}__${sid}`] || 0) + Number(x.cliques || 0);
  });
  return index;
}

function cliquesParaProdutoNoPeriodo(row, cliqueDailyIndex, cadastroSubIds = []) {
  const fromDaily = Number(row.cliques || 0);
  if (fromDaily > 0) return fromDaily;

  const subs = new Set();
  (row.sub_ids || []).forEach((s) => subs.add(normalizeSubId(s)));
  if (row.sub_id) subs.add(normalizeSubId(row.sub_id));
  cadastroSubIds.forEach((s) => subs.add(normalizeSubId(s)));

  const datas = row._datas || (row._data ? [row._data] : []);
  if (!datas.length || !Object.keys(cliqueDailyIndex).length) return 0;

  let total = 0;
  for (const data of datas) {
    for (const sid of subs) {
      if (!sid || sid === "organico") continue;
      total += cliqueDailyIndex[`${data}__${sid}`] || 0;
    }
  }
  return total;
}

export function mapProdutosPeriodoParaPainel(produtosPeriodo, cadastroPorId = {}) {
  return (produtosPeriodo || []).map((p) => {
    const pid = String(p.produto_id || "");
    const cad = cadastroPorId[pid]
      || cadastroPorId[p.nome]
      || (pid && /^\d+$/.test(pid) ? cadastroPorId[`item_${pid}`] : null)
      || {};
    const comissaoEst = Number(p.comissao_estimada ?? p.comissoes ?? 0);
    const hasCad = Boolean(cad.id || cad.item_id || cad.id_item || cad.produto_id);
    const cliques = Number(p.cliques || 0);

    return {
      id: pid || p.nome,
      produto_id: pid,
      nome: p.nome || cad.nome || "Produto",
      comissao_concluida: comissaoEst,
      comissao_pendente: Number(p.comissoes_pendentes || 0),
      comissao_estimada: comissaoEst,
      vendas: Number(p.qtd_itens || 0),
      faturamento: Number(p.faturamento || 0),
      cliques,
      conv_rate: cliques > 0 ? Number(p.qtd_itens || 0) / cliques : 0,
      roi: 0,
      investimento: 0,
      sub_ids: p.sub_ids || cad.sub_ids || (cad.sub_id ? [cad.sub_id] : []),
      sub_id: p.sub_id || cad.sub_id || null,
      metaAdIds: cad.metaAdIds || [],
      pinterestAdIds: cad.pinterestAdIds || [],
      origem: "Shopee",
      status: hasCad ? (cad.status || "Validando") : "Validando",
      link_afiliado: cad.link_afiliado || null,
      loja: cad.loja || null,
      fonte: "produto_daily",
      semCadastro: !hasCad && pid && !CADASTRO_SKIP_IDS.has(pid),
      _datas: p._datas || null,
      _data: p._data || null,
    };
  });
}

export function buildCadastroIndex(produtos) {
  const byId = {};
  const byNome = {};
  (produtos || []).forEach((p) => {
    const rawId = p.item_id || p.id_item || p.produto_id;
    if (rawId) {
      const s = String(rawId);
      byId[s] = p;
      if (s.startsWith("item_")) byId[s.slice(5)] = p;
    }
    if (p.nome) byNome[p.nome] = p;
  });
  return { byId, byNome };
}

function cadastroDocIdsFromPeriodo(produtosPeriodo) {
  const ids = new Set();
  for (const row of produtosPeriodo || []) {
    const pid = String(row.produto_id || "").trim();
    if (!pid || CADASTRO_SKIP_IDS.has(pid)) continue;
    if (/^\d+$/.test(pid)) ids.add(`item_${pid}`);
    else if (pid.startsWith("item_")) ids.add(pid);
    else ids.add(pid);
  }
  return [...ids];
}

async function fetchCadastroByDocIds(docIds) {
  if (!docIds?.length) return [];
  return getProdutosByItemIds(docIds);
}

function lookupCadastro(produtoId, nome, byId, byNome) {
  const pid = String(produtoId || "").trim();
  if (pid && byId[pid]) return byId[pid];
  if (pid && /^\d+$/.test(pid) && byId[`item_${pid}`]) return byId[`item_${pid}`];
  if (nome && byNome[nome]) return byNome[nome];
  return null;
}

function hasCadastro(cad) {
  return Boolean(cad && (cad.id || cad.item_id || cad.id_item || cad.produto_id));
}

/** Mesmo produto pode aparecer 2x após merge cadastro + período. */
export function dedupeProdutoRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const k = String(row.produto_id || row.id || row.nome || "").trim();
    if (!k) continue;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...row });
      continue;
    }
    const sum = (a, b) => (Number(a) || 0) + (Number(b) || 0);
    prev.comissao_concluida = sum(prev.comissao_concluida, row.comissao_concluida);
    prev.comissao_pendente = sum(prev.comissao_pendente, row.comissao_pendente);
    prev.comissao_estimada = sum(prev.comissao_estimada, row.comissao_estimada);
    prev.vendas = sum(prev.vendas, row.vendas);
    prev.cliques = sum(prev.cliques, row.cliques);
    prev.faturamento = sum(prev.faturamento, row.faturamento);
    prev.investimento = sum(prev.investimento, row.investimento);
    if (!prev.link_afiliado && row.link_afiliado) prev.link_afiliado = row.link_afiliado;
    if (!prev.loja && row.loja) prev.loja = row.loja;
    if (row.semCadastro === false) prev.semCadastro = false;
    Object.assign(prev, calcMetrics(prev));
  }
  return [...map.values()];
}

/**
 * Atribui gasto Meta/Pin ao produto via sub_ids e recalcula métricas.
 * Linhas produto_daily usam sempre gasto do período (não investimento lifetime do cadastro).
 */
export function enrichComMeta(produto, { metaBySub = {}, pinBySub = {} } = {}) {
  const p = produto || {};
  const isPeriodRow = p.fonte === "produto_daily";
  const subIds = p.sub_ids || (p.sub_id ? [p.sub_id] : []);
  const autoMeta = [];
  const autoPin = [];
  let autoInvest = 0;

  subIds.forEach((sid) => {
    const norm = normalizeSubId(sid);
    if (metaBySub[norm]) {
      autoMeta.push(...(metaBySub[norm].ids || []));
      autoInvest += metaBySub[norm].spend || 0;
    }
    if (pinBySub[norm]) {
      autoPin.push(...(pinBySub[norm].ids || []));
      autoInvest += pinBySub[norm].spend || 0;
    }
  });

  const metaAdIds = dedupeAdIds(p.metaAdIds?.length ? p.metaAdIds : autoMeta);
  const pinterestAdIds = dedupeAdIds(p.pinterestAdIds?.length ? p.pinterestAdIds : autoPin);
  const investimentoPeriodo = Math.round(autoInvest * 100) / 100;
  const investimento = isPeriodRow
    ? investimentoPeriodo
    : ((p.investimento && p.investimento > 0) ? p.investimento : investimentoPeriodo);

  return {
    ...p,
    metaAdIds,
    pinterestAdIds,
    investimento,
    ...calcMetrics({ ...p, investimento }),
  };
}

/** Enriquece lista de cadastro (todo período) com gasto ads. */
export function enrichProdutosCadastroComAds(produtos, metaAds, pinterestAds) {
  const metaBySub = buildMetaBySubLifetime(metaAds);
  const pinBySub = buildPinBySubLifetime(pinterestAds);
  return dedupeProdutoRows(
    (produtos || []).map((p) => enrichComMeta(p, { metaBySub, pinBySub })),
  );
}

/**
 * produto_daily do período + cadastro parcial + gasto Meta/Pin do período + cliques (Tier 2).
 */
export async function enrichProdutosPeriodoParaPainel(
  produtosPeriodo,
  startDate,
  endDate,
  { settings: _settings = {} } = {},
) {
  const rows = [...(produtosPeriodo || [])];
  if (!rows.length || !startDate || !endDate) return [];

  const docIds = cadastroDocIdsFromPeriodo(rows);
  const cadastroDocs = docIds.length ? await fetchCadastroByDocIds(docIds) : [];
  const { byId, byNome } = buildCadastroIndex(cadastroDocs);
  const cliqueDailyIndex = await fetchCliqueDailyIndex(startDate, endDate);

  const cadastroMerged = { ...byId };
  cadastroDocs.forEach((p) => {
    if (p.nome) cadastroMerged[p.nome] = p;
  });

  const importIds = await getLatestImportIds().catch(() => ({}));
  const metaAdsFallback = importIds.metaAds
    ? await getMetaAds(importIds.metaAds).catch(() => [])
    : [];
  const pinterest = importIds.pinterest
    ? await getPinterest(importIds.pinterest).catch(() => [])
    : [];

  let metaBySub = await buildMetaBySubForPeriod(startDate, endDate, metaAdsFallback);
  let pinBySub = buildPinBySubForPeriod(startDate, endDate, pinterest);

  const merged = mapProdutosPeriodoParaPainel(rows, cadastroMerged).map((p) => {
    const cad = lookupCadastro(p.produto_id, p.nome, byId, byNome);
    const semCadastro = !hasCadastro(cad)
      && p.produto_id
      && !CADASTRO_SKIP_IDS.has(String(p.produto_id));

    const cadSubIds = cad?.sub_ids || (cad?.sub_id ? [cad.sub_id] : []);
    const cliques = cliquesParaProdutoNoPeriodo(p, cliqueDailyIndex, cadSubIds);

    return enrichComMeta({
      ...(cad || {}),
      ...p,
      id: p.produto_id || cad?.id || p.id,
      nome: p.nome || cad?.nome,
      comissao_concluida: p.comissao_estimada ?? p.comissao_concluida,
      cliques,
      semCadastro,
    }, { metaBySub, pinBySub });
  });

  return dedupeProdutoRows(merged);
}

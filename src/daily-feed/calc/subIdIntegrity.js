import { normalizeSubId } from "../../utils/normalizeSubId";
import { reconcileSubIdsGastoComKpis, isGastoGapSubIdRow } from "./financeiroMetrics.js";

export function emptySubIdRow(sid) {
  return {
    id: sid,
    subid: sid,
    comissoes: 0,
    comissoes_estimadas: 0,
    faturamento: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
    qtd_itens: 0,
    total_vendas: 0,
    pedidos: 0,
    gasto: 0,
    meta_gasto: 0,
    pin_gasto: 0,
    lucro: 0,
    roi: 0,
    cliques_anuncio: 0,
    cliques_shopee: 0,
    batimento: 0,
    ticket_medio: 0,
  };
}

export function subIdRowHasActivity(row) {
  if (!row) return false;
  if (isGastoGapSubIdRow(row)) return true;
  return (
    (row.comissoes || 0) > 0
    || (row.comissoes_estimadas || 0) > 0
    || (row.gasto || 0) > 0
    || (row.meta_gasto || 0) > 0
    || (row.pin_gasto || 0) > 0
    || (row.faturamento || 0) > 0
    || (row.total_vendas || 0) > 0
    || (row.qtd_itens || 0) > 0
    || (row.pedidos || 0) > 0
    || (row.cliques_anuncio || 0) > 0
    || (row.cliques_shopee || 0) > 0
  );
}

export function filterSubIdRowsWithActivity(rows) {
  return (rows || []).filter(subIdRowHasActivity);
}

export function sortSubIdRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const score = (r) =>
      (r.comissoes_estimadas || r.comissoes || 0)
      + (r.gasto || 0)
      + (r.faturamento || 0) * 0.001;
    return score(b) - score(a);
  });
}

export function extractGastoKpisFromTarget(kpiTarget) {
  if (!kpiTarget) return { gastoMeta: 0, gastoPin: 0 };
  return {
    gastoMeta: Number(kpiTarget.gastoMeta ?? kpiTarget.metaTotalGasto ?? 0),
    gastoPin: Number(kpiTarget.gastoPin ?? kpiTarget.pinTotalGasto ?? 0),
  };
}

export function finalizeSubIdRowsForPainel(rows, {
  settings = {},
  gastoMeta = 0,
  gastoPin = 0,
} = {}) {
  let out = filterSubIdRowsWithActivity(rows);
  const meta = Number(gastoMeta || 0);
  const pin = Number(gastoPin || 0);
  if (meta > 0 || pin > 0) {
    out = reconcileSubIdsGastoComKpis(out, { gastoMeta: meta, gastoPin: pin }, settings);
  }
  return sortSubIdRows(filterSubIdRowsWithActivity(out));
}

export function subIdRowKey(row) {
  return normalizeSubId(row?.subid || row?.id || "") || "";
}

export function mergeSubIdRowsByKey(...lists) {
  const map = new Map();
  const touch = (r) => {
    const sid = subIdRowKey(r);
    if (!sid) return;
    const prev = map.get(sid);
    if (!prev) {
      map.set(sid, { ...r, subid: sid, id: sid });
      return;
    }
    map.set(sid, {
      ...prev,
      ...r,
      subid: sid,
      id: sid,
      comissoes: (prev.comissoes || 0) + (r.comissoes || 0),
      comissoes_estimadas: (prev.comissoes_estimadas || 0) + (r.comissoes_estimadas || 0),
      faturamento: (prev.faturamento || 0) + (r.faturamento || 0),
      vendas_diretas: (prev.vendas_diretas || 0) + (r.vendas_diretas || 0),
      vendas_indiretas: (prev.vendas_indiretas || 0) + (r.vendas_indiretas || 0),
      qtd_itens: (prev.qtd_itens || 0) + (r.qtd_itens || 0),
      total_vendas: (prev.total_vendas || 0) + (r.total_vendas || 0),
      pedidos: (prev.pedidos || 0) + (r.pedidos || 0),
      gasto: (prev.gasto || 0) + (r.gasto || 0),
      meta_gasto: (prev.meta_gasto || 0) + (r.meta_gasto || 0),
      pin_gasto: (prev.pin_gasto || 0) + (r.pin_gasto || 0),
      cliques_anuncio: (prev.cliques_anuncio || 0) + (r.cliques_anuncio || 0),
      cliques_shopee: (prev.cliques_shopee || 0) + (r.cliques_shopee || 0),
    });
  };
  for (const list of lists) {
    for (const r of list || []) touch(r);
  }
  return [...map.values()];
}

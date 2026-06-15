/**
 * Bundle SubID híbrido: dias frios de subid_mensal/painel_resumo (bucket),
 * janela quente (hoje - HOT_WINDOW_DAYS .. endStr) granular.
 */

import { normalizeSubId } from "../../../utils/normalizeSubId";
import { roundMoney } from "../../shopee/config/shopeeOficialRef.js";
import { splitColdHot, HOT_WINDOW_DAYS } from "../utils/coldHotRange.js";
import {
  buildSubIdBundleFromBucketsRaw,
  distribuirPinNoPorDia,
} from "./monthlyBucketPanel";
import { applySubIdFinanceiroRow } from "../../../domain/metrics/financeiroMetrics.js";
import {
  finalizarSubIdPeriodoBundle,
  montarBundleGranular,
} from "./metricsRepository";

export { HOT_WINDOW_DAYS };

const HOT_TTL_MS = 30 * 1000;
const hotCache = new Map();

export function invalidateSubIdHotCache() {
  hotCache.clear();
}

function emptySubIdRow(subid) {
  return {
    id: subid,
    subid,
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
    cliques_anuncio: 0,
    cliques_shopee: 0,
    batimento: 0,
    ticket_medio: 0,
  };
}

function mergeSubIdMapEntry(target, source) {
  if (!source) return target;
  if (!target) return { ...source };
  const addFields = [
    "comissoes", "comissoes_estimadas", "faturamento", "vendas_diretas", "vendas_indiretas",
    "qtd_itens", "total_vendas", "pedidos", "gasto", "meta_gasto", "cliques_anuncio", "cliques_shopee",
  ];
  for (const f of addFields) {
    target[f] = (target[f] || 0) + (source[f] || 0);
  }
  return target;
}

function mergePorDiaEntry(target, source) {
  if (!source) return target;
  if (!target) {
    return {
      ...source,
      bySubId: { ...(source.bySubId || {}) },
    };
  }
  target.comissoes = (target.comissoes || 0) + (source.comissoes || 0);
  target.comissoes_estimadas = (target.comissoes_estimadas || 0) + (source.comissoes_estimadas || 0);
  target.faturamento = (target.faturamento || 0) + (source.faturamento || 0);
  target.total_vendas = (target.total_vendas || 0) + (source.total_vendas || 0);
  target.pedidos = (target.pedidos || 0) + (source.pedidos || 0);
  target.gasto = (target.gasto || 0) + (source.gasto || 0);
  target.bySubId = target.bySubId || {};
  for (const [sid, cell] of Object.entries(source.bySubId || {})) {
    if (!target.bySubId[sid]) {
      target.bySubId[sid] = { ...cell };
    } else {
      target.bySubId[sid].comissoes = (target.bySubId[sid].comissoes || 0) + (cell.comissoes || 0);
      target.bySubId[sid].comissoes_estimadas = (target.bySubId[sid].comissoes_estimadas || 0) + (cell.comissoes_estimadas || 0);
      target.bySubId[sid].faturamento = (target.bySubId[sid].faturamento || 0) + (cell.faturamento || 0);
      target.bySubId[sid].total_vendas = (target.bySubId[sid].total_vendas || 0) + (cell.total_vendas || 0);
      target.bySubId[sid].gasto = (target.bySubId[sid].gasto || 0) + (cell.gasto || 0);
    }
  }
  return target;
}

function mergeSubIdMaps(coldMap, hotMap) {
  const out = { ...coldMap };
  for (const [sid, row] of Object.entries(hotMap || {})) {
    out[sid] = mergeSubIdMapEntry(out[sid] ? { ...out[sid] } : emptySubIdRow(sid), row);
    out[sid].id = sid;
    out[sid].subid = sid;
  }
  return out;
}

function mergePorDiaMaps(coldPorDia, hotPorDia) {
  const out = { ...coldPorDia };
  for (const [date, row] of Object.entries(hotPorDia || {})) {
    out[date] = mergePorDiaEntry(
      out[date] ? { ...out[date], bySubId: { ...(out[date].bySubId || {}) } } : null,
      row,
    );
  }
  return out;
}

function applyPinToSubIdMap(subIdMap, pinBySubId) {
  for (const [rawSid, pinRow] of Object.entries(pinBySubId || {})) {
    const sid = normalizeSubId(rawSid) || rawSid;
    if (!sid) continue;
    const pinGasto = roundMoney(Number(pinRow?.gasto ?? pinRow?.spend ?? 0));
    const pinCliques = Number(pinRow?.cliques_anuncio || 0);
    if (pinGasto <= 0 && pinCliques <= 0) continue;
    if (!subIdMap[sid]) subIdMap[sid] = emptySubIdRow(sid);
    subIdMap[sid].pin_gasto = roundMoney((subIdMap[sid].pin_gasto || 0) + pinGasto);
    subIdMap[sid].gasto = roundMoney((subIdMap[sid].gasto || 0) + pinGasto);
    subIdMap[sid].cliques_anuncio += pinCliques;
  }
  return subIdMap;
}

function rowsFromSubIdMap(subIdMap) {
  return Object.values(subIdMap).map((r) => {
    const ticket = r.total_vendas > 0 ? r.faturamento / r.total_vendas : 0;
    return applySubIdFinanceiroRow({
      ...r,
      ticket_medio: ticket,
      batimento: r.cliques_anuncio > 0 ? r.cliques_shopee / r.cliques_anuncio : 0,
      _metaGastoSource: "hybrid",
    });
  });
}

export async function getSubIdHybridBundle(
  bucketData,
  startStr,
  endStr,
  startDate,
  endDate,
  {
    settings = {},
    kpiTarget = null,
    includeDaily = true,
    pinBySubId = {},
    gastoPinTotal = 0,
    versionKey = "0",
    alvoPrecomputado = undefined,
  } = {},
) {
  const { cold, hot } = splitColdHot(startStr, endStr);

  let subIdMap = {};
  let porDia = {};

  if (cold) {
    const coldRaw = buildSubIdBundleFromBucketsRaw(
      bucketData.subid,
      bucketData.painel,
      cold[0],
      cold[1],
    );
    subIdMap = { ...coldRaw.subIdMap };
    porDia = { ...coldRaw.porDia };
  }

  if (hot) {
    const hotKey = `${hot[0]}|${hot[1]}|${versionKey}`;
    let hotRaw = hotCache.get(hotKey);
    if (!hotRaw || Date.now() - hotRaw.ts >= HOT_TTL_MS) {
      const raw = await montarBundleGranular(hot[0], hot[1], {
        enrichMeta: true,
        includeCliques: true,
        settings,
        skipPin: true,
      });
      hotRaw = { raw, ts: Date.now() };
      hotCache.set(hotKey, hotRaw);
    }
    subIdMap = mergeSubIdMaps(subIdMap, hotRaw.raw.subIdMap);
    porDia = mergePorDiaMaps(porDia, hotRaw.raw.porDia);
  }

  subIdMap = applyPinToSubIdMap(subIdMap, pinBySubId);
  distribuirPinNoPorDia(porDia, gastoPinTotal, startStr, endStr);

  const rows = rowsFromSubIdMap(subIdMap);
  return finalizarSubIdPeriodoBundle(rows, porDia, startDate, endDate, {
    settings,
    kpiTarget,
    includeDaily,
    alvoPrecomputado,
  });
}

/** Compara totais híbrido vs granular (DEV). */
export function auditSubIdHybridVsGranular(hybridRows, granularRows) {
  const toMap = (rows) => {
    const m = {};
    for (const r of rows || []) {
      const sid = normalizeSubId(r.subid || r.id || "");
      if (!sid) continue;
      m[sid] = r;
    }
    return m;
  };
  const h = toMap(hybridRows);
  const g = toMap(granularRows);
  const warnings = [];
  for (const sid of new Set([...Object.keys(h), ...Object.keys(g)])) {
    const a = h[sid] || {};
    const b = g[sid] || {};
    const checks = [
      ["comissoes", 0.5],
      ["comissoes_estimadas", 0.5],
      ["faturamento", 0.5],
      ["qtd_itens", 0],
      ["pedidos", 0],
      ["gasto", 0.5],
      ["cliques_shopee", 0],
    ];
    for (const [field, tol] of checks) {
      const diff = Math.abs(Number(a[field] || 0) - Number(b[field] || 0));
      if (diff > tol) {
        warnings.push({ sid, field, hybrid: a[field], granular: b[field], diff });
      }
    }
  }
  return warnings;
}

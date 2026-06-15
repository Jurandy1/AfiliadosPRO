import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { fetchDataVersions } from "../cache/dataVersions";
import { finalizarKpisComissaoDashboard } from "../../../domain/metrics/financeiroMetrics.js";
import { normalizeSubId } from "../../../utils/normalizeSubId";
import { roundMoney } from "../../shopee/config/shopeeOficialRef.js";
import { toISODateStr } from "../enrichment/adsPeriodSpend.js";

export const PRODUTOS_SCAN_MAX_DIAS = 14;

/** Lista YYYY-MM entre duas datas inclusive. */
export function listMonthKeysInRange(startStr, endStr) {
  if (!startStr || !endStr) return [];
  const keys = [];
  let y = Number(startStr.slice(0, 4));
  let m = Number(startStr.slice(5, 7));
  const endY = Number(endStr.slice(0, 4));
  const endM = Number(endStr.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

export function diasInclusivos(startStr, endStr) {
  const a = Date.parse(`${startStr}T12:00:00Z`);
  const b = Date.parse(`${endStr}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000) + 1);
}

async function fetchMonthlyDocs(monthKeys, versionKey = "0") {
  const painel = {};
  const subid = {};
  for (const mk of monthKeys) {
    const cacheKey = `${mk}|${versionKey}`;
    const cached = monthlyBucketDocsCache.get(cacheKey);
    if (cached) {
      painel[mk] = cached.painel;
      subid[mk] = cached.subid;
      continue;
    }
    const [pSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "painel_resumo", mk)),
      getDoc(doc(db, "subid_mensal", mk)),
    ]);
    if (!pSnap.exists() || !Object.keys(pSnap.data()?.dias || {}).length) {
      return null;
    }
    if (!sSnap.exists()) return null;
    const painelData = pSnap.data();
    const subidData = sSnap.data();
    painel[mk] = painelData;
    subid[mk] = subidData;
    monthlyBucketDocsCache.set(cacheKey, { painel: painelData, subid: subidData });
  }
  return { painel, subid, reads: monthKeys.length * 2 };
}

const monthlyBucketDocsCache = new Map();

export function invalidateMonthlyBucketDocsCache() {
  monthlyBucketDocsCache.clear();
}

function iterDatesInRange(startStr, endStr) {
  const out = [];
  let cur = startStr;
  while (cur <= endStr) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

function getPainelDia(painelByMonth, dateStr) {
  const mk = dateStr.slice(0, 7);
  return painelByMonth[mk]?.dias?.[dateStr] || null;
}

function getSubidCell(subidByMonth, subidKey, dateStr) {
  const mk = dateStr.slice(0, 7);
  return subidByMonth[mk]?.subids?.[subidKey]?.[dateStr] || null;
}

/**
 * Monta KPIs + gráfico + perdas a partir de painel_resumo.
 */
export function buildKpisFromPainelBuckets(painelByMonth, startStr, endStr, {
  impostoMeta = 0,
  impostoNf = 0,
  gastoPinExtra = 0,
} = {}) {
  const tot = {
    comissao_estimada: 0,
    comissao_real: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_cancelada: 0,
    fat_bruto: 0,
    vendas: 0,
    pedidos: 0,
    pedidos_concluidos: 0,
    pedidos_pendentes: 0,
    pedidos_cancelados: 0,
    pedidos_nao_pagos: 0,
    comissao_nao_paga: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
  };
  let gastoMeta = 0;
  let perdas = { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };
  const historicoDiario = [];
  let diasComDados = 0;

  for (const dateStr of iterDatesInRange(startStr, endStr)) {
    const dia = getPainelDia(painelByMonth, dateStr);
    if (dia) {
      perdas.countPerdas += Number(dia.perdas_pedidos || 0);
      perdas.totalFatPerdido += Number(dia.perdas_fat || 0);
      perdas.totalComissaoPerdida += Number(dia.perdas_comissao || 0);
      tot.pedidos_nao_pagos += Number(dia.pedidos_nao_pagos || 0);
      tot.comissao_nao_paga += Number(dia.comissao_nao_paga || 0);
    }
    if (!dia) continue;
    const comDia = Number(dia.comissao_estimada || 0);
    if (comDia === 0 && !dia.pedidos && !dia.vendas && !dia.faturamento) continue;
    diasComDados += 1;
    tot.comissao_estimada += comDia;
    tot.comissao_real += Number(dia.comissao_real || comDia);
    tot.comissao_concluida += Number(dia.comissao_concluida || 0);
    tot.comissao_pendente += Number(dia.comissao_pendente || 0);
    tot.comissao_cancelada += Number(dia.comissao_cancelada || 0);
    tot.fat_bruto += Number(dia.faturamento || 0);
    tot.vendas += Number(dia.vendas || 0);
    tot.pedidos += Number(dia.pedidos || 0);
    tot.pedidos_concluidos += Number(dia.pedidos_concluidos || 0);
    tot.pedidos_pendentes += Number(dia.pedidos_pendentes || 0);
    tot.pedidos_cancelados += Number(dia.pedidos_cancelados || 0);
    tot.vendas_diretas += Number(dia.vendas_diretas || 0);
    tot.vendas_indiretas += Number(dia.vendas_indiretas || 0);
    gastoMeta += Number(dia.gasto_meta || 0);
    const comConc = Number(dia.comissao_concluida || 0);
    const comPend = Number(dia.comissao_pendente || 0);
    const comDiaSplit = roundMoney(comConc + comPend || comDia);
    historicoDiario.push({
      data: dateStr,
      comissaoEstimada: comDiaSplit,
      comissaoConcluida: comConc,
      comissaoPendente: comPend,
      comissao: comDiaSplit,
      faturamento: Number(dia.faturamento || 0),
      vendas: Number(dia.vendas || 0),
      pedidos: Number(dia.pedidos || 0),
      gasto: roundMoney(Number(dia.gasto_meta || 0)),
    });
  }

  const gastoPin = Number(gastoPinExtra || 0);
  const gastoTotal = roundMoney(gastoMeta + gastoPin);

  const kpis = finalizarKpisComissaoDashboard({
    comissao: roundMoney(tot.comissao_estimada),
    comissaoReal: roundMoney(tot.comissao_real),
    comissaoEstimada: roundMoney(tot.comissao_estimada),
    comissaoConcluida: roundMoney(tot.comissao_concluida),
    comissaoPendente: roundMoney(tot.comissao_pendente),
    comissaoCancelada: roundMoney(tot.comissao_cancelada),
    pedidosConcluidos: tot.pedidos_concluidos,
    pedidosPendentes: tot.pedidos_pendentes,
    pedidosCancelados: tot.pedidos_cancelados,
    pedidosNaoPagos: tot.pedidos_nao_pagos,
    comissaoNaoPaga: roundMoney(tot.comissao_nao_paga),
    fatBruto: roundMoney(tot.fat_bruto),
    vendas: tot.vendas,
    pedidos: tot.pedidos,
    vendasDiretas: tot.vendas_diretas,
    vendasIndiretas: tot.vendas_indiretas,
    gastoMeta: roundMoney(gastoMeta),
    gastoPin: roundMoney(gastoPin),
    gastoTotal,
    ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    metaSource: "monthly_bucket",
    lastUpdated: null,
    diasComDados,
    _source: "painel_resumo",
    shopeeDataMode: "api_fiel",
    shopeePanelAudit: null,
    historicoDiario,
  }, { impostoMeta, impostoNf });

  return {
    kpis: {
      ...kpis,
      metaSource: "monthly_bucket",
      _source: "painel_resumo",
      shopeeDataMode: kpis.shopeeDataMode || "api_fiel",
      shopeePanelAudit: null,
      diasComDados,
      lastUpdated: null,
      ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    },
    perdas: {
      countPerdas: perdas.countPerdas,
      totalFatPerdido: roundMoney(perdas.totalFatPerdido),
      totalComissaoPerdida: roundMoney(perdas.totalComissaoPerdida),
    },
  };
}

function ensureSubIdMapEntry(subIdMap, subid) {
  if (!subIdMap[subid]) {
    subIdMap[subid] = {
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
      lucro: 0,
      roi: 0,
      cliques_anuncio: 0,
      cliques_shopee: 0,
      batimento: 0,
      ticket_medio: 0,
    };
  }
  return subIdMap[subid];
}

export function alinharGastoDiarioComPainel(porDia, painelByMonth, startStr, endStr) {
  for (const dateStr of iterDatesInRange(startStr, endStr)) {
    const painelDia = getPainelDia(painelByMonth, dateStr);
    if (!painelDia) continue;
    const gastoPainel = roundMoney(Number(painelDia.gasto_meta || 0));
    if (!porDia[dateStr]) {
      if (gastoPainel <= 0) continue;
      porDia[dateStr] = {
        data: dateStr,
        comissoes: Number(painelDia.comissao_estimada || 0),
        faturamento: Number(painelDia.faturamento || 0),
        total_vendas: Number(painelDia.vendas || 0),
        pedidos: Number(painelDia.pedidos || 0),
        gasto: gastoPainel,
        bySubId: {},
      };
      continue;
    }
    const gap = roundMoney(gastoPainel - porDia[dateStr].gasto);
    if (gap > 0) porDia[dateStr].gasto = roundMoney(porDia[dateStr].gasto + gap);
  }
}

export function distribuirPinNoPorDia(porDia, pinTotal, startStr, endStr) {
  const pin = roundMoney(pinTotal);
  if (pin <= 0) return;
  const dates = iterDatesInRange(startStr, endStr);
  const totalGasto = roundMoney(dates.reduce((s, d) => s + (porDia[d]?.gasto || 0), 0));
  for (const dateStr of dates) {
    if (!porDia[dateStr]) {
      porDia[dateStr] = {
        data: dateStr,
        comissoes: 0,
        faturamento: 0,
        total_vendas: 0,
        pedidos: 0,
        gasto: 0,
        bySubId: {},
      };
    }
    const share = totalGasto > 0
      ? (porDia[dateStr].gasto / totalGasto) * pin
      : pin / dates.length;
    porDia[dateStr].gasto = roundMoney(porDia[dateStr].gasto + share);
  }
}

/**
 * Agregados brutos de subid_mensal — sem pin, sem métricas financeiras finais.
 */
export function buildSubIdBundleFromBucketsRaw(subidByMonth, painelByMonth, startStr, endStr) {
  const subIdMap = {};
  const porDia = {};

  for (const dateStr of iterDatesInRange(startStr, endStr)) {
    const mk = dateStr.slice(0, 7);
    const subidsRoot = subidByMonth[mk]?.subids || {};
    for (const [rawSubid, daysMap] of Object.entries(subidsRoot)) {
      const cell = daysMap?.[dateStr];
      if (!cell) continue;
      const subid = normalizeSubId(rawSubid) || rawSubid || "ORGANICO";
      const row = ensureSubIdMapEntry(subIdMap, subid);
      const comEst = Number(cell.comissoes_estimadas ?? cell.comissoes ?? 0);
      const comReal = Number(cell.comissoes ?? comEst);
      const gasto = Number(cell.gasto_meta || 0);
      row.comissoes_estimadas += comEst;
      row.comissoes += comReal;
      row.faturamento += Number(cell.faturamento || 0);
      row.vendas_diretas += Number(cell.vendas_diretas || 0);
      row.vendas_indiretas += Number(cell.vendas_indiretas || 0);
      row.qtd_itens += Number(cell.qtd_itens || 0);
      row.total_vendas += Number(cell.qtd_itens || 0);
      row.pedidos += Number(cell.pedidos || 0);
      row.meta_gasto += gasto;
      row.gasto += gasto;
      row.cliques_anuncio += Number(cell.cliques_meta || 0);
      row.cliques_shopee += Number(cell.cliques_shopee || 0);

      if (!porDia[dateStr]) {
        porDia[dateStr] = {
          data: dateStr,
          comissoes: 0,
          comissoes_estimadas: 0,
          faturamento: 0,
          total_vendas: 0,
          pedidos: 0,
          gasto: 0,
          bySubId: {},
        };
      }
      porDia[dateStr].comissoes += comReal;
      porDia[dateStr].comissoes_estimadas = (porDia[dateStr].comissoes_estimadas || 0) + comEst;
      porDia[dateStr].faturamento += Number(cell.faturamento || 0);
      porDia[dateStr].total_vendas += Number(cell.qtd_itens || 0);
      porDia[dateStr].pedidos += Number(cell.pedidos || 0);
      porDia[dateStr].gasto += gasto;
      if (!porDia[dateStr].bySubId[subid]) {
        porDia[dateStr].bySubId[subid] = {
          comissoes: 0, comissoes_estimadas: 0, faturamento: 0, total_vendas: 0, gasto: 0,
        };
      }
      porDia[dateStr].bySubId[subid].comissoes += comReal;
      porDia[dateStr].bySubId[subid].comissoes_estimadas += comEst;
      porDia[dateStr].bySubId[subid].faturamento += Number(cell.faturamento || 0);
      porDia[dateStr].bySubId[subid].total_vendas += Number(cell.qtd_itens || 0);
      porDia[dateStr].bySubId[subid].gasto += gasto;
    }
  }

  alinharGastoDiarioComPainel(porDia, painelByMonth, startStr, endStr);
  return { subIdMap, porDia };
}

/**
 * Carrega painel_resumo + subid_mensal para o intervalo. Null se faltar bucket.
 */
export async function loadMonthlyBucketData(startDate, endDate) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const monthKeys = listMonthKeysInRange(startStr, endStr);
  if (!monthKeys.length) return null;
  const { versionKey } = await fetchDataVersions().catch(() => ({ versionKey: "0" }));
  const docs = await fetchMonthlyDocs(monthKeys, versionKey);
  if (!docs) return null;
  return { ...docs, startStr, endStr, monthKeys };
}

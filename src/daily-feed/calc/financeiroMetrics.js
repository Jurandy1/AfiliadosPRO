import { roundMoney } from "../../platforms/shopee/config/shopeeOficialRef.js";

/**
 * Separa comissão real (campo comissoes) vs estimada (subid_daily / subid_mensal).
 * Lucro SubID usa a estimada — mesma visão do painel Shopee do afiliado.
 */
export function parseSubIdDailyComissaoFields(d = {}) {
  const estimada = roundMoney(Number(d.comissoes_estimadas ?? d.comissoes ?? 0));
  const real = roundMoney(Number(d.comissoes ?? d.comissoes_estimadas ?? 0));
  return { real, estimada };
}

/** Comissão exibida e base do lucro SubID — estimada (painel Shopee / pedidos do período). */
export function subIdComissaoParaLucro(row = {}) {
  return roundMoney(Number(row?.comissoes_estimadas ?? row?.comissoes ?? 0));
}

/** Comissão mostrada na coluna da tabela SubID. */
export function subIdComissaoExibida(row = {}) {
  return subIdComissaoParaLucro(row);
}

/**
 * Lucro por SubID — visão do afiliado: comissão estimada − gasto, sem impostos.
 * (Impostos ficam só nos KPIs gerais do dashboard.)
 */
export function calcSubIdFinanceiroMetrics(comissao, gasto) {
  const comissaoR = roundMoney(comissao);
  const gastoR = roundMoney(gasto);
  const lucro = roundMoney(comissaoR - gastoR);
  const roi = gastoR > 0 ? lucro / gastoR : 0;
  const roas = gastoR > 0 ? comissaoR / gastoR : 0;
  return { comissao: comissaoR, gasto: gastoR, impostoTotal: 0, lucro, roi, roas };
}

/** Recalcula lucro/ROI da linha após ajuste de comissão (ex.: alinhamento ao painel Shopee). */
export function applySubIdFinanceiroRow(row = {}) {
  const fin = calcSubIdFinanceiroMetrics(subIdComissaoParaLucro(row), row.gasto || 0);
  return {
    ...row,
    lucro: fin.lucro,
    roi: fin.roi,
    roas: fin.roas,
    imposto_total: fin.impostoTotal,
  };
}

/** Imposto estimado sobre gasto em mídia + NF sobre comissão. */
export function calcImpostoTotal(gasto, comissao, { impostoMeta = 0, impostoNf = 0 } = {}) {
  const gastoR = roundMoney(gasto);
  const comissaoR = roundMoney(comissao);
  return roundMoney(
    (gastoR * (impostoMeta || 0) / 100) + (comissaoR * (impostoNf || 0) / 100),
  );
}

/**
 * Lucro, ROI e ROAS — KPI principal usa comissão REALIZADA (concluída).
 * lucroProjetado / roiProjetado usam concluída + pendente.
 */
export function calcFinanceiroMetrics(comissao, gasto, settings = {}) {
  const comissaoR = roundMoney(comissao);
  const gastoR = roundMoney(gasto);
  const impostoTotal = calcImpostoTotal(gastoR, comissaoR, settings);
  const lucro = roundMoney(comissaoR - gastoR - impostoTotal);
  const roi = gastoR > 0 ? lucro / gastoR : 0;
  const roas = gastoR > 0 ? comissaoR / gastoR : 0;
  return { comissao: comissaoR, gasto: gastoR, impostoTotal, lucro, roi, roas };
}

const PROMOSAPP_VS_API_FAITHFUL_RATIO = 1.06645;
const PROMOSAPP_VS_API_FAITHFUL_PEND_RATIO = 1.067318;

export function isModoAgregacaoPromosApp(mode) {
  const m = String(mode ?? "").toLowerCase();
  return m.includes("promosapp")
    || m.includes("node_once")
    || m.includes("shopee-panel-app");
}

export function isPromosAppKpiFonteAtiva() {
  const v = String(import.meta.env.VITE_SHOPEE_PROMOSAPP_KPI ?? "1").trim();
  return v !== "0" && v.toLowerCase() !== "false";
}

export function isPromosAppComissaoSnapEnabled() {
  const v = String(import.meta.env.VITE_SHOPEE_PROMOSAPP_COMISSAO ?? "0").trim();
  return v === "1" || v.toLowerCase() === "true";
}

export function kpisJaModoPromosApp(kpis = {}) {
  if (Boolean(kpis._comissaoModoPromosApp)) return true;
  return isModoAgregacaoPromosApp(kpis.aggregationMode ?? kpis._aggregationMode ?? "");
}

function promosAppTotalFactor() {
  const custom = Number(import.meta.env.VITE_SHOPEE_PROMOSAPP_TOTAL_FACTOR || 0);
  if (custom > 0 && custom < 1) return custom;
  return 1 / PROMOSAPP_VS_API_FAITHFUL_RATIO;
}

function promosAppPendDivisor() {
  const customFactor = Number(import.meta.env.VITE_SHOPEE_PROMOSAPP_PEND_FACTOR || 0);
  if (customFactor > 0 && customFactor < 1) return 1 / customFactor;
  const customDiv = Number(import.meta.env.VITE_SHOPEE_PROMOSAPP_PEND_DIVISOR || 0);
  if (customDiv > 1) return customDiv;
  return PROMOSAPP_VS_API_FAITHFUL_PEND_RATIO;
}

export function comissaoRealizadaPeriodo(kpis = {}) {
  const conc = roundMoney(kpis.comissaoConcluida ?? 0);
  const pend = roundMoney(kpis.comissaoPendente ?? 0);
  if (conc > 0 || pend > 0) return conc;
  if (kpis.splitIndisponivel) {
    return comissaoProjetadaPeriodo(kpis);
  }
  return conc;
}

/** Comissão total do período (concluída + pendente) — base do lucro/ROI projetado. */
export function comissaoProjetadaPeriodo(kpis = {}) {
  const conc = roundMoney(kpis.comissaoConcluida ?? 0);
  const pend = roundMoney(kpis.comissaoPendente ?? 0);
  if (conc > 0 || pend > 0) return roundMoney(conc + pend);
  return roundMoney(kpis.comissaoReal ?? kpis.comissao ?? kpis.comissaoEstimada ?? kpis.totalComissao ?? 0);
}

/** @deprecated Prefer comissaoProjetadaPeriodo — mantido para imports existentes. */
export function comissaoRealPeriodo(kpis = {}) {
  return comissaoProjetadaPeriodo(kpis);
}

export function reconciliarComissaoSplit(kpis = {}) {
  const conc = roundMoney(kpis.comissaoConcluida ?? 0);
  const pend = roundMoney(kpis.comissaoPendente ?? 0);
  const total = roundMoney(conc + pend);
  return {
    ...kpis,
    comissaoConcluida: conc,
    comissaoPendente: pend,
    comissaoEstimada: total,
    comissao: total,
    totalComissao: total,
    comissaoReal: total,
  };
}

function snapComissaoPromosAppSplit(conc, pend, totalApi) {
  const concR = roundMoney(conc);
  const pendR = roundMoney(pend);
  if (pendR <= 0) {
    const factor = promosAppTotalFactor();
    const totalSnap = roundMoney(totalApi * factor);
    return { conc: concR, pendSnap: 0, totalSnap };
  }
  if (concR <= 0) {
    const pendSnap = roundMoney(pendR / promosAppPendDivisor());
    return { conc: 0, pendSnap, totalSnap: pendSnap };
  }
  const pendSnap = roundMoney(pendR / promosAppPendDivisor());
  const totalSnap = roundMoney(concR + pendSnap);
  return { conc: concR, pendSnap, totalSnap };
}

function fixHistoricoComissaoCentavos(rows, targetConc, targetPend) {
  if (!rows?.length) return rows;
  const out = rows.map((r) => ({ ...r }));
  const sumConc = roundMoney(out.reduce((s, r) => s + Number(r.comissaoConcluida || 0), 0));
  const sumPend = roundMoney(out.reduce((s, r) => s + Number(r.comissaoPendente || 0), 0));
  const dConc = roundMoney(targetConc - sumConc);
  const dPend = roundMoney(targetPend - sumPend);
  if (Math.abs(dConc) < 0.01 && Math.abs(dPend) < 0.01) return out;
  const last = out[out.length - 1];
  last.comissaoConcluida = roundMoney((last.comissaoConcluida || 0) + dConc);
  last.comissaoPendente = roundMoney((last.comissaoPendente || 0) + dPend);
  const total = roundMoney((last.comissaoConcluida || 0) + (last.comissaoPendente || 0));
  last.comissaoEstimada = total;
  last.comissao = total;
  return out;
}

function snapHistoricoDiarioPromosApp(rows, factor, targetConc, targetPend) {
  if (!rows?.length || factor >= 0.999) return rows;
  const mapped = rows.map((r) => {
    const conc = roundMoney(r.comissaoConcluida || 0);
    const pend = roundMoney(r.comissaoPendente || 0);
    const totalApi = roundMoney(conc + pend || r.comissaoEstimada || r.comissao || 0);
    const { pendSnap, totalSnap } = snapComissaoPromosAppSplit(conc, pend, totalApi);
    return {
      ...r,
      comissaoConcluida: conc,
      comissaoPendente: pendSnap,
      comissaoEstimada: totalSnap,
      comissao: totalSnap,
    };
  });
  return fixHistoricoComissaoCentavos(mapped, targetConc, targetPend);
}

function comissaoDiaRealizada(row = {}) {
  const conc = roundMoney(row.comissaoConcluida ?? 0);
  const pend = roundMoney(row.comissaoPendente ?? 0);
  if (conc > 0 || pend > 0) return conc;
  if (row.splitIndisponivel) {
    return roundMoney(row.comissaoEstimada ?? row.comissao ?? 0);
  }
  return conc;
}

function comissaoDiaProjetada(row = {}) {
  return comissaoProjetadaPeriodo(row);
}

function aplicarLucroRoiHistoricoDiario(rows = [], settings = {}) {
  if (!rows?.length) return rows;
  return rows.map((row) => {
    const comissaoRealizada = comissaoDiaRealizada(row);
    const comissaoProjetada = comissaoDiaProjetada(row);
    const gastoDia = roundMoney(row.gasto ?? 0);
    const calcFn = gastoDia > 0 ? calcFinanceiroMetrics : calcSubIdFinanceiroMetrics;
    const finReal = calcFn(comissaoRealizada, gastoDia, settings);
    const finProj = calcFn(comissaoProjetada, gastoDia, settings);
    return {
      ...row,
      comissaoEstimada: comissaoProjetada,
      comissao: comissaoProjetada,
      gasto: finReal.gasto,
      lucro: finReal.lucro,
      roi: finReal.roi,
      roas: finReal.roas,
      lucroProjetado: finProj.lucro,
      roiProjetado: finProj.roi,
      roasProjetado: finProj.roas,
    };
  });
}

export function aplicarLucroRoiComissaoReal(kpis = {}, settings = {}) {
  const reconciliado = reconciliarComissaoSplit(kpis);
  const comissaoRealizada = comissaoRealizadaPeriodo(reconciliado);
  const comissaoProjetada = comissaoProjetadaPeriodo(reconciliado);
  const gastoTotal = roundMoney(
    reconciliado.gastoTotal
    ?? reconciliado.totalInvestimento
    ?? ((reconciliado.gastoMeta || 0) + (reconciliado.gastoPin || 0)),
  );
  const finReal = calcFinanceiroMetrics(comissaoRealizada, gastoTotal, {
    impostoMeta: settings.impostoMeta ?? 0,
    impostoNf: settings.impostoNf ?? 0,
  });
  const finProj = calcFinanceiroMetrics(comissaoProjetada, gastoTotal, {
    impostoMeta: settings.impostoMeta ?? 0,
    impostoNf: settings.impostoNf ?? 0,
  });
  const historicoDiario = aplicarLucroRoiHistoricoDiario(reconciliado.historicoDiario, settings);
  return {
    ...reconciliado,
    comissaoRealizada,
    comissaoProjetada,
    comissaoReal: comissaoProjetada,
    gastoTotal: finReal.gasto,
    totalInvestimento: finReal.gasto,
    impostoTotal: finReal.impostoTotal,
    lucro: finReal.lucro,
    roi: finReal.roi,
    roas: finReal.roas,
    roiGeral: finReal.roi,
    lucroProjetado: finProj.lucro,
    roiProjetado: finProj.roi,
    roasProjetado: finProj.roas,
    lucroEstimado: finProj.lucro,
    impostoTotalProjetado: finProj.impostoTotal,
    historicoDiario,
  };
}

export function finalizarKpisComissaoDashboard(kpis = {}, settings = {}) {
  let out = { ...kpis };

  if (isPromosAppComissaoSnapEnabled() && !kpisJaModoPromosApp(out)) {
    const conc = roundMoney(out.comissaoConcluida ?? 0);
    const pend = roundMoney(out.comissaoPendente ?? 0);
    const totalApi = roundMoney(
      conc + pend > 0 ? conc + pend : (out.comissaoEstimada ?? out.comissao ?? out.totalComissao ?? 0),
    );
    if (totalApi > 0) {
      const factor = promosAppTotalFactor();
      const { conc: concR, pendSnap, totalSnap } = snapComissaoPromosAppSplit(conc, pend, totalApi);
      out = {
        ...out,
        comissaoConcluida: concR,
        comissaoPendente: pendSnap,
        comissaoEstimada: totalSnap,
        comissao: totalSnap,
        totalComissao: totalSnap,
        historicoDiario: snapHistoricoDiarioPromosApp(
          out.historicoDiario,
          factor,
          concR,
          pendSnap,
        ),
        _comissaoSnapPromosApp: true,
      };
    }
  }

  out = reconciliarComissaoSplit(out);
  return aplicarLucroRoiComissaoReal(out, settings);
}

/** @deprecated use finalizarKpisComissaoDashboard */
export function snapKpisComissaoModoPromosApp(kpis = {}, settings = {}) {
  return finalizarKpisComissaoDashboard(kpis, settings);
}

/** Recalcula lucro/ROI a partir do split concl.+pend. (sem snap PromosApp). */
export function ensureKpisLucroRoiCoerentes(kpis = {}, settings = {}) {
  return aplicarLucroRoiComissaoReal(reconciliarComissaoSplit(kpis), settings);
}

const GASTO_GAP_SUBID = "__gasto_sem_subid__";

export function buildGastoGapSubIdRow(metaGap, pinGap, settings = {}) {
  const gasto = roundMoney(Math.max(0, metaGap) + Math.max(0, pinGap));
  if (gasto < 0.01) return null;
  const fin = calcSubIdFinanceiroMetrics(0, gasto);
  return {
    id: GASTO_GAP_SUBID,
    subid: "(Gasto sem SubID)",
    comissoes: 0,
    comissoes_estimadas: 0,
    faturamento: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
    qtd_itens: 0,
    total_vendas: 0,
    pedidos: 0,
    gasto: fin.gasto,
    meta_gasto: roundMoney(Math.max(0, metaGap)),
    pin_gasto: roundMoney(Math.max(0, pinGap)),
    lucro: fin.lucro,
    roi: fin.roi,
    cliques_anuncio: 0,
    cliques_shopee: 0,
    batimento: 0,
    ticket_medio: 0,
    imposto_total: fin.impostoTotal,
    _metaGastoSource: "monthly_bucket",
    _isGastoGap: true,
  };
}

export function isGastoGapSubIdRow(row) {
  return row?.id === GASTO_GAP_SUBID || row?._isGastoGap === true;
}

export function reconcileSubIdsGastoComKpis(subIds, { gastoMeta = 0, gastoPin = 0 } = {}, settings = {}) {
  let metaNasLinhas = 0;
  let pinNasLinhas = 0;
  for (const r of subIds || []) {
    if (isGastoGapSubIdRow(r)) continue;
    const pin = Number(r.pin_gasto || 0);
    const meta = r.meta_gasto != null
      ? Number(r.meta_gasto)
      : Math.max(0, Number(r.gasto || 0) - pin);
    metaNasLinhas += meta;
    pinNasLinhas += pin;
  }
  metaNasLinhas = roundMoney(metaNasLinhas);
  pinNasLinhas = roundMoney(pinNasLinhas);
  const metaGap = roundMoney(roundMoney(gastoMeta) - metaNasLinhas);
  const pinGap = roundMoney(roundMoney(gastoPin) - pinNasLinhas);
  const gapRow = buildGastoGapSubIdRow(metaGap, pinGap, settings);
  const base = (subIds || []).filter((r) => !isGastoGapSubIdRow(r));
  return gapRow ? [...base, gapRow] : base;
}

import {
  collection,
  count,
  doc,
  documentId,
  getAggregateFromServer,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  where,
} from "firebase/firestore";
import { fetchMetaAdsDailySnapshot, invalidateMetaAdsDailyCache } from "../cache/metaAdsDailyCache";
import { fetchDataVersions, invalidateDataVersionsCache } from "../cache/dataVersions.js";
import { db } from "../../../services/firebase/client";
import {
  applySubIdFinanceiroRow,
  calcSubIdFinanceiroMetrics,
  comissaoRealPeriodo,
  parseSubIdDailyComissaoFields,
  reconcileSubIdsGastoComKpis,
  finalizarKpisComissaoDashboard,
  isModoAgregacaoPromosApp,
  isPromosAppKpiFonteAtiva,
  subIdComissaoParaLucro,
} from "../../../domain/metrics/financeiroMetrics.js";
import {
  emptySubIdRow,
  extractGastoKpisFromTarget,
  filterSubIdRowsWithActivity,
  finalizeSubIdRowsForPainel,
} from "../../../domain/metrics/subIdIntegrity.js";
import { calcMetrics } from "../../../domain/metrics/productMetrics";
import { getSubIdVendas } from "../../shopee/repositories/productsRepository";
import { getMetaAds, clearMetaAdsCache } from "../../meta/repositories/metaRepository";
import { getPinterest } from "../../pinterest/repositories/pinterestRepository";
import { getLatestImportIds } from "../../imports/repositories/importacoesLogRepository";
import { calcularRangeModoAll } from "../../../utils/periodoFiltro";
import { normalizeSubId } from "../../../utils/normalizeSubId";
import {
  buildMetaBySubForPeriod,
  buildPinBySubForPeriod,
  calcOverlapRatio,
  sumPinGastoForPeriod,
  toISODateStr,
} from "../enrichment/adsPeriodSpend.js";
import {
  brtYesterdayYYYYMMDD,
  brtLastDayOfMonth,
  daysBetweenDatesBRT,
  formatDateBRTYYYYMMDD as formatDateBRTFromUtil,
  isDiaRecenteBRT,
} from "../../../utils/dates";
import {
  buildKpisFromPainelBuckets,
  diasInclusivos,
  listMonthKeysInRange,
  loadMonthlyBucketData,
  PRODUTOS_SCAN_MAX_DIAS as BUCKET_PRODUTOS_MAX_DIAS,
} from "./monthlyBucketPanel.js";
import { splitColdHot } from "../utils/coldHotRange.js";
import {
  alinharAgregadosAoPainelOficial,
  alinharDailyBreakdownAoAlvo,
  getShopeeOficialTargetForRange,
  loadShopeeOficialPeriodRef,
  roundMoney,
  buildShopeePanelAudit,
  getShopeeCsvBatimentoRef,
  isShopeeCsvSnapEnabled,
  snapTotaisKPIsAoCsvBatimento,
  snapPerdasAoCsvBatimento,
  isShopeePanelAlignEnabled,
  snapTotaisKPIsAoPainelOficial,
} from "../../shopee/config/shopeeOficialRef";

/** Comissão unificada por dia — prioriza split concl.+pend. (mesma base do lucro/ROI). */
function comissaoDoDiaShopee(x) {
  const conc = Number(x?.comissao_concluida || 0);
  const pend = Number(x?.comissao_pendente || 0);
  if (conc > 0 || pend > 0) return roundMoney(conc + pend);
  return Number(
    x?.comissao_estimada || x?.comissao_total || x?.comissao_real || 0,
  );
}

function formatDateLocalYYYYMMDD(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Data de hoje no fuso BRT (UTC-3), igual ao backend Shopee. */
export function formatDateBRTYYYYMMDD(date = new Date()) {
  return formatDateBRTFromUtil(date);
}

export { brtYesterdayYYYYMMDD, isDiaRecenteBRT };

async function dispararBackfillLegacyToday() {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    return { ok: false, error: "config_missing" };
  }

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 120000);

    const resp = await fetch(`${url}?days=0&todayOnly=1&force=1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Length": "0",
      },
      body: "",
      signal: ctrl.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { ok: false, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    return { ok: true, mode: "todayOnly", result: json, skipped: json.skipped === true };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: true, timeout: true, mode: "todayOnly" };
    }
    return { ok: false, error: err.message };
  }
}

function enrichProduto(p) {
  const investimento = Number(p?.investimento || 0);
  const base = { ...p, investimento };
  const metrics = calcMetrics(base);
  const fonte = String(p?.fonte || "").toLowerCase();
  const plataforma = String(p?.plataforma || "").toLowerCase();
  const origem = (fonte.includes("shopee") || plataforma.includes("shopee") || fonte === "produto_daily")
    ? "Shopee"
    : (metrics.origem || "Manual");
  return { ...base, ...metrics, origem };
}

export async function getProdutosPagina(pageSize = 50, lastDoc = null) {
  const produtosRef = collection(db, "produtos");
  const order = orderBy("comissao_total", "desc");
  const q = lastDoc
    ? query(produtosRef, order, startAfter(lastDoc), limit(pageSize))
    : query(produtosRef, order, limit(pageSize));

  const snap = await getDocs(q);
  const produtos = snap.docs.map((d) => enrichProduto({ id: d.id, ...d.data() }));

  return {
    produtos,
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}

export async function getDashboardKPIsByPeriod(startDate, endDate, settings = {}) {
  const { impostoMeta = 0, impostoNf = 0 } = settings || {};
  await loadShopeeOficialPeriodRef();
  const docs = await fetchShopeeDailyDocsForRange(startDate, endDate);
  const snap = {
    size: docs.length,
    forEach: (cb) => {
      docs.forEach(cb);
    },
  };

  const tot = {
    comissao_total: 0,
    comissao_real: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_cancelada: 0,
    comissao_estimada: 0,
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
    splitPedidoNivel: {
      pedidos_concluidos: 0,
      pedidos_pendentes: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
    },
  };

  const historicoDiario = [];
  let diasComDadosReais = 0;
  let aggregationModeFirestore = "";
  let diasComSplitCriterio = 0;
  let diasNoPeriodo = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    if (isDailyMetricsVazio(x)) return;
    diasComDadosReais += 1;
    diasNoPeriodo += 1;
    if (x.splitCriterio === "conversao_promosapp") diasComSplitCriterio += 1;
    if (!aggregationModeFirestore && x.aggregation_mode) {
      aggregationModeFirestore = String(x.aggregation_mode);
    }
    const spn = x.splitPedidoNivel;
    if (spn && typeof spn === "object") {
      tot.splitPedidoNivel.pedidos_concluidos += Number(spn.pedidos_concluidos || 0);
      tot.splitPedidoNivel.pedidos_pendentes += Number(spn.pedidos_pendentes || 0);
      tot.splitPedidoNivel.comissao_concluida += Number(spn.comissao_concluida || 0);
      tot.splitPedidoNivel.comissao_pendente += Number(spn.comissao_pendente || 0);
    }
    const comDia = comissaoDoDiaShopee(x);
    tot.comissao_total += comDia;
    tot.comissao_real += comDia;
    tot.comissao_concluida += x.comissao_concluida || 0;
    tot.comissao_pendente += x.comissao_pendente || 0;
    tot.comissao_cancelada += x.comissao_cancelada || 0;
    tot.comissao_estimada += comDia;
    tot.fat_bruto += (x.faturamento ?? x.gmv_total ?? 0);
    tot.vendas += x.vendas || 0;
    tot.pedidos += x.pedidos || 0;
    tot.pedidos_concluidos += x.pedidos_concluidos || 0;
    tot.pedidos_pendentes += x.pedidos_pendentes || 0;
    tot.pedidos_cancelados += x.pedidos_cancelados || 0;
    tot.pedidos_nao_pagos += x.pedidos_nao_pagos || 0;
    tot.comissao_nao_paga += x.comissao_nao_paga || 0;
    tot.vendas_diretas += x.vendas_diretas || 0;
    tot.vendas_indiretas += x.vendas_indiretas || 0;

    const comConc = Number(x.comissao_concluida || 0);
    const comPend = Number(x.comissao_pendente || 0);
    const comDiaSplit = roundMoney(comConc + comPend || comDia);
    historicoDiario.push({
      data: d.id,
      comissaoEstimada: comDiaSplit,
      comissaoConcluida: comConc,
      comissaoPendente: comPend,
      comissao: comDiaSplit,
      faturamento: Number(x.faturamento ?? x.gmv_total ?? 0),
      vendas: Number(x.vendas || 0),
      pedidos: Number(x.pedidos || 0),
    });
  });
  historicoDiario.sort((a, b) => a.data.localeCompare(b.data));

  let diasComDados = diasComDadosReais;
  let kpiSource = "shopee_daily";
  let splitIndisponivel = false;

  if (diasComDadosReais === 0 || (tot.pedidos === 0 && tot.vendas === 0 && tot.fat_bruto === 0)) {
    const fallback = await agregarKPIsDeSubIdDaily(startDate, endDate);
    if (fallback) {
      Object.assign(tot, fallback.tot);
      if (fallback.historicoDiario?.length) {
        historicoDiario.length = 0;
        historicoDiario.push(...fallback.historicoDiario);
        historicoDiario.sort((a, b) => a.data.localeCompare(b.data));
      }
      diasComDados = fallback.diasComDados || historicoDiario.length;
      kpiSource = "subid_daily_fallback";
      splitIndisponivel = Boolean(fallback.splitIndisponivel);
    }
  }

  let gastoMeta = 0;
  let gastoPin = 0;
  let metaSource = "proporcional";

  try {
    const diario = await getGastoMetaDiarioByPeriod(startDate, endDate);
    if (diario) {
      gastoMeta = Number(diario.gastoMeta || 0);
      metaSource = "daily";
    }
  } catch (err) {
    console.warn("[KPIsByPeriod] Erro ao buscar gasto Meta diário:", err);
  }

  try {
    const importIds = await getLatestImportIds().catch(() => ({}));
    const pinterest = importIds.pinterest
      ? await getPinterest(importIds.pinterest).catch(() => [])
      : [];

    if (metaSource !== "daily") {
      const metaAds = importIds.metaAds
        ? await getMetaAds(importIds.metaAds).catch(() => [])
        : [];
      metaAds.forEach((m) => {
        const itemStart = m.dataInicio || null;
        const itemEnd = m.dataFim || itemStart;
        const ratio = calcOverlapRatio(startDate, endDate, itemStart, itemEnd);
        if (ratio <= 0) return;
        gastoMeta += (Number(m.valorUsado) || 0) * ratio;
      });
    }

    gastoPin = sumPinGastoForPeriod(startDate, endDate, pinterest);
  } catch (err) {
    console.warn("[KPIsByPeriod] Erro ao calcular gasto Meta/Pin:", err);
  }

  const dadosPromosApp = isModoAgregacaoPromosApp(aggregationModeFirestore);
  const alvoOficial = getShopeeOficialTargetForRange(startDate, endDate);
  const csvRef = alvoOficial ? getShopeeCsvBatimentoRef(alvoOficial.monthKey) : null;
  const alinhadoCsv = Boolean(
    !dadosPromosApp
    && csvRef
    && kpiSource === "shopee_daily"
    && isShopeeCsvSnapEnabled(alvoOficial?.monthKey),
  );
  const alinhadoPainel = Boolean(
    !dadosPromosApp
    && alvoOficial
    && kpiSource === "shopee_daily"
    && isShopeePanelAlignEnabled()
    && !alinhadoCsv,
  );
  if (alinhadoCsv) {
    Object.assign(tot, snapTotaisKPIsAoCsvBatimento(tot, alvoOficial.monthKey));
  } else if (alinhadoPainel) {
    Object.assign(tot, snapTotaisKPIsAoPainelOficial(tot, alvoOficial));
  } else {
    tot.comissao_estimada = roundMoney(tot.comissao_estimada);
    tot.comissao_real = roundMoney(tot.comissao_real);
    tot.comissao_concluida = roundMoney(tot.comissao_concluida);
    tot.comissao_pendente = roundMoney(tot.comissao_pendente);
    tot.fat_bruto = roundMoney(tot.fat_bruto);
  }

  const gastoTotal = roundMoney(gastoMeta + gastoPin);

  if (historicoDiario.length === 1 && gastoTotal > 0) {
    historicoDiario[0].gasto = gastoTotal;
  }

  if (kpiSource === "shopee_daily") {
    kpiSource = metaSource === "daily" ? "shopee_daily+meta_daily" : "shopee_daily+meta_proporcional";
  }

  return finalizarKpisComissaoDashboard({
    comissao: tot.comissao_estimada,
    comissaoReal: roundMoney(tot.comissao_real),
    comissaoEstimada: tot.comissao_estimada,
    comissaoConcluida: tot.comissao_concluida,
    comissaoPendente: tot.comissao_pendente,
    comissaoCancelada: tot.comissao_cancelada,
    pedidosConcluidos: tot.pedidos_concluidos,
    pedidosPendentes: tot.pedidos_pendentes,
    pedidosCancelados: tot.pedidos_cancelados,
    pedidosNaoPagos: tot.pedidos_nao_pagos,
    comissaoNaoPaga: roundMoney(tot.comissao_nao_paga),
    fatBruto: tot.fat_bruto,
    vendas: tot.vendas,
    pedidos: tot.pedidos,
    vendasDiretas: tot.vendas_diretas,
    vendasIndiretas: tot.vendas_indiretas,
    gastoMeta: Math.round(gastoMeta * 100) / 100,
    gastoPin: Math.round(gastoPin * 100) / 100,
    gastoTotal,
    ticketMedio: tot.vendas > 0 ? tot.fat_bruto / tot.vendas : 0,
    metaSource,
    lastUpdated: null,
    diasComDados,
    _source: kpiSource,
    aggregationMode: aggregationModeFirestore || null,
    _comissaoModoPromosApp: dadosPromosApp,
    shopeeDataMode: dadosPromosApp
      ? "promosapp"
      : (alinhadoCsv ? "alinhado_csv" : alinhadoPainel ? "calibrado_painel" : "api_fiel"),
    shopeePanelAudit: buildShopeePanelAudit(
      {
        comissao: tot.comissao_estimada,
        comissaoEstimada: tot.comissao_estimada,
        pedidos: tot.pedidos,
        fatBruto: tot.fat_bruto,
        vendas: tot.vendas,
      },
      alvoOficial,
      { alinhadoPainel, alinhadoCsv },
    ),
    historicoDiario,
    splitIndisponivel,
    splitPedidoNivel: {
      pedidos_concluidos: tot.splitPedidoNivel.pedidos_concluidos,
      pedidos_pendentes: tot.splitPedidoNivel.pedidos_pendentes,
      comissao_concluida: roundMoney(tot.splitPedidoNivel.comissao_concluida),
      comissao_pendente: roundMoney(tot.splitPedidoNivel.comissao_pendente),
    },
    splitCriterio: diasComSplitCriterio > 0 && diasComSplitCriterio === diasNoPeriodo
      ? "conversao_promosapp"
      : (diasComSplitCriterio > 0 ? "misto" : null),
  }, { impostoMeta, impostoNf });
}

/**
 * Dispara refresh de um período na API Shopee (só os dias solicitados).
 * Usa startDate/endDate para puxar apenas a janela necessária — baixo custo.
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string, timeout?: boolean}>}
 */
function resolveMetaDailyUrl() {
  const explicit = import.meta.env.VITE_META_DAILY_URL;
  if (explicit) return String(explicit).trim();
  const backfill = import.meta.env.VITE_BACKFILL_URL || "";
  if (/shopeebackfillnow/i.test(backfill)) {
    return backfill.replace(/shopeebackfillnow/i, "metabackfilldaily");
  }
  return "https://metabackfilldaily-ncjpjjcdya-rj.a.run.app";
}

/**
 * Atualiza meta_ads_daily (gasto por dia/anúncio) via Cloud Function metaBackfillDaily.
 */
export async function dispararMetaDailySync(daysBack = 7) {
  const url = resolveMetaDailyUrl();
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    console.warn("[dispararMetaDailySync] URL ou secret não configurados");
    return { ok: false, error: "config_missing" };
  }

  const days = Math.max(1, Math.min(90, Number(daysBack) || 7));
  const params = new URLSearchParams({ days: String(days) });

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 120000);

    const resp = await fetch(`${url}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Length": "0",
      },
      body: "",
      signal: ctrl.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.warn(`[dispararMetaDailySync] HTTP ${resp.status}`);
      return { ok: false, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    console.log("[dispararMetaDailySync] OK:", json);
    return { ok: true, result: json };
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[dispararMetaDailySync] Timeout 120s");
      return { ok: true, timeout: true, backgroundOnly: true };
    }
    console.warn("[dispararMetaDailySync] Erro:", err?.message || String(err));
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function dispararBackfillPeriodo(startDate, endDate, { force = false } = {}) {
  const url = import.meta.env.VITE_BACKFILL_URL;
  const secret = import.meta.env.VITE_BACKFILL_SECRET;

  if (!url || !secret) {
    console.warn("[dispararBackfillPeriodo] VITE_BACKFILL_URL ou VITE_BACKFILL_SECRET não configurados");
    return { ok: false, error: "config_missing" };
  }

  if (!startDate || !endDate) {
    return { ok: false, error: "missing_dates" };
  }

  const params = new URLSearchParams({ startDate, endDate });
  if (force) params.set("force", "1");

  const isSingleDay = startDate === endDate;
  const daySpan =
    Math.max(1, Math.round((new Date(`${endDate}T12:00:00`) - new Date(`${startDate}T12:00:00`)) / 86400000) + 1);
  /** Dia único: pull ALL + 4 status (~3–5 min). Mês: até ~6 min (evita NS_BINDING_ABORTED com cache antigo). */
  const timeoutMs = isSingleDay ? 360000 : Math.min(360000, Math.max(120000, daySpan * 15000));

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    const resp = await fetch(`${url}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Length": "0",
      },
      body: "",
      signal: ctrl.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.warn(`[dispararBackfillPeriodo] HTTP ${resp.status} — seguindo com cache`);
      return { ok: true, backgroundOnly: true, error: `http_${resp.status}` };
    }

    const json = await resp.json();
    if (json.skipped) {
      return { ok: true, skipped: true, result: json };
    }
    console.log("[dispararBackfillPeriodo] OK:", json);
    return { ok: true, result: json };
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(`[dispararBackfillPeriodo] Timeout ${timeoutMs / 1000}s — exibindo cache (função pode estar rodando em background)`);
      return { ok: true, timeout: true, backgroundOnly: true };
    }
    console.warn("[dispararBackfillPeriodo] Erro de rede — exibindo cache:", err?.message || String(err));
    return {
      ok: true,
      networkError: true,
      backgroundOnly: true,
      error: err?.message || String(err),
    };
  }
}

/**
 * Dispara o shopeeBackfillNow para o dia de hoje (BRT).
 * Usa todayOnly=1 (compatível com backend em produção) e, se falhar,
 * tenta startDate/endDate (backend novo).
 */
export async function dispararBackfillHoje({ force = true } = {}) {
  const hojeStr = formatDateBRTYYYYMMDD();

  // Preferir janela explícita com force (grava shopee_daily do dia inteiro)
  const porData = await dispararBackfillPeriodo(hojeStr, hojeStr, { force });
  if (porData.ok) return { ...porData, mode: "date_range" };

  const legacy = await dispararBackfillLegacyToday();
  if (legacy.ok) return legacy;

  return porData;
}

function listDatesBetween(startStr, endStr) {
  const dates = [];
  let cur = startStr;
  while (cur <= endStr) {
    dates.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${nextDt.getUTCFullYear()}-${String(nextDt.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDt.getUTCDate()).padStart(2, "0")}`;
  }
  return dates;
}

function daysBetweenDates(dateStr, refStr) {
  return daysBetweenDatesBRT(dateStr, refStr);
}

function getStaleThresholdMs(dateStr) {
  const hojeStr = formatDateBRTYYYYMMDD();
  const diff = daysBetweenDates(dateStr, hojeStr);
  if (diff <= 0) return 5 * 60 * 1000;
  if (diff === 1) return 30 * 60 * 1000;
  if (diff <= 2) return 60 * 60 * 1000;
  if (diff <= 7) return 12 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function isDailyMetricsVazio(data) {
  const pedidos = Number(data?.pedidos || 0);
  const vendas = Number(data?.vendas ?? data?.qtd_itens ?? 0);
  const fat = Number(data?.faturamento ?? data?.gmv_total ?? 0);
  const comissao = Number(
    data?.comissao_estimada ?? data?.comissao_concluida ?? data?.comissao_total ?? data?.comissao_real ?? 0,
  );
  return pedidos === 0 && vendas === 0 && fat === 0 && comissao === 0;
}

/**
 * Espera o Firestore receber métricas do dia (polling leve — evita avalanche de leituras do onSnapshot no backfill).
 */
export function aguardarMetricasComListener(dateStr, { maxWaitMs = 90000, intervalMs = 4000 } = {}) {
  if (!dateStr) return Promise.resolve(false);

  const started = Date.now();
  let delay = intervalMs;
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const snap = await getDoc(doc(db, "shopee_daily", dateStr));
        if (snap.exists() && !isDailyMetricsVazio(snap.data())) {
          resolve(true);
          return;
        }
        if (Date.now() - started > 20000) {
          const subSnap = await getDocs(query(
            collection(db, "subid_daily"),
            where("data", "==", dateStr),
            limit(3),
          ));
          if (subSnap.docs.some((d) => !isDailyMetricsVazio(d.data()))) {
            resolve(true);
            return;
          }
        }
      } catch {
        /* ignora erro pontual de leitura */
      }
      if (Date.now() - started >= maxWaitMs) {
        resolve(false);
        return;
      }
      delay = Math.min(delay * 1.6, 16000);
      setTimeout(tick, delay);
    };
    tick();
  });
}

function extrairStatsSync(json) {
  if (!json || typeof json !== "object") return { nodes: 0, pedidos: 0, shopeeDaily: 0, skipped: false };
  const nodes = Number(json.nodes ?? json.linhasProcessadas ?? 0);
  const pedidos = Number(json.pedidos ?? json.lastPedidos ?? 0);
  return {
    nodes,
    pedidos,
    shopeeDaily: Number(json.shopeeDaily ?? 0),
    skipped: json.skipped === true,
  };
}

/**
 * Verifica quais dias do período precisam de refresh na API Shopee.
 * 1 read por dia em shopee_daily — barato no Firestore.
 */
export async function getDatasDesatualizadas(startDate, endDate) {
  const hojeStr = formatDateBRTYYYYMMDD();
  const dates = listDatesBetween(startDate, endDate).filter((d) => d <= hojeStr);
  const stale = [];

  if (dates.length === 0) return stale;

  try {
    const q = query(
      collection(db, "shopee_daily"),
      where(documentId(), ">=", dates[0]),
      where(documentId(), "<=", dates[dates.length - 1])
    );
    const snap = await getDocs(q);
    const map = {};
    snap.forEach((d) => {
      map[d.id] = d.data() || {};
    });

    for (const dateStr of dates) {
      const data = map[dateStr];
      if (!data) {
        stale.push(dateStr);
        continue;
      }
      if (isDailyMetricsVazio(data)) {
        stale.push(dateStr);
        continue;
      }
      const updatedAt = data.updatedAt?.toDate?.();
      if (!updatedAt) {
        stale.push(dateStr);
        continue;
      }
      const ageMs = Date.now() - updatedAt.getTime();
      if (ageMs > getStaleThresholdMs(dateStr)) {
        stale.push(dateStr);
      }
    }
  } catch (err) {
    console.warn("[getDatasDesatualizadas] erro na consulta em lote:", err);
    // Fallback: se a consulta em lote falhar, assume tudo como desatualizado.
    return dates.sort();
  }

  return stale.sort();
}

async function agregarKPIsDeSubIdDaily(startDate, endDate) {
  try {
    const q = query(
      collection(db, "subid_daily"),
      where("data", ">=", startDate),
      where("data", "<=", endDate),
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const tot = {
      comissao_total: 0,
      comissao_real: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
      comissao_estimada: 0,
      fat_bruto: 0,
      vendas: 0,
      pedidos: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
    };
    const porDia = {};
    const datasVistas = new Set();

    snapshot.forEach((docSnap) => {
      const d = docSnap.data() || {};
      const data = d.data || startDate;
      datasVistas.add(data);
      tot.comissao_total += Number(d.comissoes || 0);
      tot.comissao_real += Number(d.comissoes || 0);
      tot.comissao_estimada += Number(d.comissoes_estimadas || 0);
      tot.fat_bruto += Number(d.faturamento || 0);
      tot.vendas += Number(d.qtd_itens || 0);
      tot.pedidos += Number(d.pedidos || 0);
      tot.vendas_diretas += Number(d.vendas_diretas || 0);
      tot.vendas_indiretas += Number(d.vendas_indiretas || 0);

      if (!porDia[data]) {
        porDia[data] = {
          comissaoEstimada: 0,
          comissaoConcluida: 0,
          comissaoPendente: 0,
          comissao: 0,
          faturamento: 0,
          vendas: 0,
          pedidos: 0,
        };
      }
      const comDia = Number(d.comissoes_estimadas || d.comissoes || 0);
      porDia[data].comissaoEstimada += comDia;
      porDia[data].comissao += comDia;
      porDia[data].faturamento += Number(d.faturamento || 0);
      porDia[data].vendas += Number(d.qtd_itens || 0);
      porDia[data].pedidos += Number(d.pedidos || 0);
    });

    if (tot.pedidos === 0 && tot.vendas === 0 && tot.fat_bruto === 0) return null;

    console.log("[KPIsByPeriod] fallback subid_daily:", { datas: datasVistas.size, pedidos: tot.pedidos });
    return {
      tot,
      historicoDiario: Object.entries(porDia).map(([data, v]) => ({ data, ...v })),
      diasComDados: datasVistas.size,
      splitIndisponivel: true,
    };
  } catch (err) {
    console.warn("[KPIsByPeriod] fallback subid_daily falhou:", err);
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Carrega KPIs do período. Se afterSync, aguarda até maxWaitMs pelo Firestore (só dia único).
 */
export async function carregarKPIsDoPeriodo(startDate, endDate, { afterSync = false, maxWaitMs = 25000, settings = {} } = {}) {
  if (afterSync && startDate === endDate) {
    await aguardarMetricasComListener(startDate, { maxWaitMs });
  }
  return getDashboardKPIsByPeriod(startDate, endDate, settings);
}

/**
 * Garante que os dias do período estão atualizados antes de exibir KPIs.
 * "Hoje" sempre sincroniza (dados ao vivo). Demais dias só se stale.
 */
async function sincronizarDiaUnico(dateStr, { label = "dia_unico" } = {}) {
  const result = await dispararBackfillPeriodo(dateStr, dateStr, { force: true });
  const stats = extrairStatsSync(result.result || result);
  const throttled = result.skipped === true || stats.skipped;
  return {
    refreshed: result.ok && !throttled && !result.backgroundOnly,
    stale: [dateStr],
    throttled,
    error: result.error || null,
    mode: label,
    nodes: stats.nodes,
    pedidos: stats.pedidos,
    shopeeDaily: stats.shopeeDaily,
    semVendasNaApi: result.ok && !throttled && stats.nodes === 0,
    apiComDadosSemFirestore: result.ok && !throttled && stats.nodes > 0 && (stats.shopeeDaily || 0) === 0,
    backgroundOnly: result.backgroundOnly === true,
    forced: true,
  };
}

async function garantirMetaDailyRecente() {
  return dispararMetaDailySync(7);
}

export async function garantirDadosAtualizados(startDate, endDate, { forceAll = false } = {}) {
  const hojeStr = formatDateBRTYYYYMMDD();
  const ontemStr = brtYesterdayYYYYMMDD();
  const isDiaUnico = startDate === endDate;
  const isApenasHoje = isDiaUnico && startDate === hojeStr;
  const periodoRecenteMeta = isApenasHoje
    || (isDiaUnico && startDate === ontemStr)
    || isDiaRecenteBRT(startDate, hojeStr)
    || isDiaRecenteBRT(endDate, hojeStr);

  let metaSync = { ok: true, skipped: true };
  if (periodoRecenteMeta) {
    metaSync = await garantirMetaDailyRecente();
  }

  if (isApenasHoje) {
    const result = await dispararBackfillHoje({ force: true });
    const stats = extrairStatsSync(result.result || result);
    const throttled = result.skipped === true || stats.skipped;
    return {
      refreshed: result.ok && !throttled,
      stale: [hojeStr],
      throttled,
      error: result.error || null,
      mode: result.mode || "hoje",
      nodes: stats.nodes,
      pedidos: stats.pedidos,
      shopeeDaily: stats.shopeeDaily,
      semVendasNaApi: result.ok && !throttled && stats.nodes === 0,
      apiComDadosSemFirestore: result.ok && !throttled && stats.nodes > 0 && (stats.shopeeDaily || 0) === 0,
      backgroundOnly: result.backgroundOnly === true,
      forced: true,
      metaSync,
    };
  }

  if (isDiaUnico && isDiaRecenteBRT(startDate, hojeStr) && startDate !== hojeStr) {
    const shopee = await sincronizarDiaUnico(startDate, {
      label: startDate === ontemStr ? "ontem" : "dia_recente",
    });
    return { ...shopee, metaSync };
  }

  if (forceAll && isDiaUnico) {
    const shopee = await sincronizarDiaUnico(startDate, { label: "force_dia" });
    return { ...shopee, metaSync };
  }

  if (forceAll && !isDiaUnico) {
    const result = await dispararBackfillPeriodo(startDate, endDate, { force: true });
    return {
      refreshed: result.ok && !result.skipped && !result.backgroundOnly,
      stale: listDatesBetween(startDate, endDate),
      throttled: result.skipped === true,
      error: result.error || null,
      backgroundOnly: result.backgroundOnly === true,
      forced: true,
      metaSync,
    };
  }

  const stale = await getDatasDesatualizadas(startDate, endDate);
  if (stale.length === 0) {
    return { refreshed: false, stale: [], skipped: true, error: null, metaSync };
  }

  const refreshStart = stale[0];
  const refreshEnd = stale[stale.length - 1];
  const result = await dispararBackfillPeriodo(refreshStart, refreshEnd, { force: true });

  return {
    refreshed: result.ok && !result.skipped && !result.backgroundOnly,
    stale,
    throttled: result.skipped === true,
    error: result.error || null,
    backgroundOnly: result.backgroundOnly === true,
    metaSync,
  };
}

/**
 * Dashboard “Todo período” — KPIs + SubID + produtos paginados.
 * Usa shopee_daily / subid_daily / produto_daily (sem scan de 21k produtos).
 */
export async function getDashboardPanelModoAll(settings = {}) {
  const { startDate, endDate } = calcularRangeModoAll();

  const [painel, produtosPage] = await Promise.all([
    getDashboardPainelPorPeriodo(startDate, endDate, settings, {
      includeProdutos: false,
      forceGranular: false,
      includeDaily: true,
    }),
    getProdutosPagina(50),
  ]);

  const subIds = painel.subIds || [];
  const kpisPeriod = painel.kpisFromSumario;
  const perdas = painel.perdas || { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };
  const produtos = produtosPage?.produtos || [];

  const statusCount = { Escalando: 0, Validando: 0, Pausado: 0 };
  produtos.forEach((p) => {
    statusCount[p.status] = (statusCount[p.status] || 0) + 1;
  });

  const hasSubIdSalesData = subIds.some(
    (r) => (r.comissoes || 0) > 0 || (r.faturamento || 0) > 0 || (r.total_vendas || 0) > 0,
  );

  const ranking = hasSubIdSalesData
    ? subIds
      .filter((r) => (r.comissoes || 0) > 0)
      .sort((a, b) => (b.comissoes || 0) - (a.comissoes || 0))
      .slice(0, 10)
      .map((r) => ({
        nome: r.subid || r.id,
        comissao_concluida: r.comissoes || 0,
        comissao_pendente: 0,
      }))
    : [...produtos]
      .sort((a, b) => (b.comissao_concluida || 0) - (a.comissao_concluida || 0))
      .slice(0, 10)
      .map((p) => ({
        nome: p.nome,
        comissao_concluida: p.comissao_concluida || 0,
        comissao_pendente: p.comissao_pendente || 0,
      }));

  const gastoTotal = kpisPeriod?.gastoTotal || 0;

  return {
    kpis: {
      produtosAtivos: hasSubIdSalesData
        ? subIds.filter((r) => (r.comissoes || 0) > 0 || (r.total_vendas || 0) > 0).length
        : (kpisPeriod?.produtosCount || produtos.length),
      totalComissao: kpisPeriod?.comissao || 0,
      comissaoReal: kpisPeriod?.comissaoReal ?? kpisPeriod?.comissao ?? 0,
      comissaoEstimada: kpisPeriod?.comissaoEstimada || kpisPeriod?.comissao || 0,
      comissaoConcluida: kpisPeriod?.comissaoConcluida || 0,
      comissaoPendente: kpisPeriod?.comissaoPendente || 0,
      comissaoCancelada: kpisPeriod?.comissaoCancelada || 0,
      pedidosConcluidos: kpisPeriod?.pedidosConcluidos || 0,
      pedidosPendentes: kpisPeriod?.pedidosPendentes || 0,
      pedidosCancelados: kpisPeriod?.pedidosCancelados || 0,
      faturamentoBruto: kpisPeriod?.fatBruto || 0,
      totalVendas: kpisPeriod?.vendas || 0,
      totalPedidos: kpisPeriod?.pedidos || 0,
      vendasDiretas: kpisPeriod?.vendasDiretas || 0,
      vendasIndiretas: kpisPeriod?.vendasIndiretas || 0,
      qtdItens: 0,
      totalCliquesShopee: 0,
      totalCliques: 0,
      totalInvestimento: gastoTotal,
      lucroEstimado: kpisPeriod?.lucroProjetado ?? kpisPeriod?.lucroEstimado ?? 0,
      lucro: kpisPeriod?.lucro || 0,
      lucroProjetado: kpisPeriod?.lucroProjetado ?? 0,
      roas: kpisPeriod?.roas || 0,
      roasProjetado: kpisPeriod?.roasProjetado ?? 0,
      roiGeral: kpisPeriod?.roi ?? (gastoTotal > 0 ? (kpisPeriod?.lucro || 0) / gastoTotal : 0),
      roiProjetado: kpisPeriod?.roiProjetado ?? 0,
      convRate: 0,
      cpcReal: 0,
      ticketMedio: kpisPeriod?.ticketMedio || 0,
      impostoTotal: kpisPeriod?.impostoTotal || 0,
      metaTotalGasto: kpisPeriod?.gastoMeta || 0,
      metaTotalCliques: 0,
      metaTotalImpressoes: 0,
      pinTotalGasto: kpisPeriod?.gastoPin || 0,
      pinTotalCliques: 0,
      roiMedio: 0,
      lastUpdated: kpisPeriod?.lastUpdated || null,
      shopeeDataMode: kpisPeriod?.shopeeDataMode || "api_fiel",
      shopeePanelAudit: kpisPeriod?.shopeePanelAudit || null,
      splitPedidoNivel: kpisPeriod?.splitPedidoNivel,
      splitCriterio: kpisPeriod?.splitCriterio,
      splitIndisponivel: Boolean(kpisPeriod?.splitIndisponivel),
    },
    statusCount,
    ranking,
    produtos,
    prodCursor: {
      lastDoc: produtosPage?.lastDoc || null,
      hasMore: !!produtosPage?.hasMore,
    },
    metaGastoResumo: painel.metaGastoResumo || calcMetaGastoResumo(kpisPeriod, subIds),
    subIds,
    subIdDiagnostics: {
      totalRows: subIds.length,
      isReliable: true,
      source: painel._source || "monthly_bucket",
      hasSubIdSalesData,
      rowsWithSales: subIds.filter((r) => (r.comissoes || 0) > 0 || (r.total_vendas || 0) > 0).length,
    },
    operationalAlerts: [],
    chartData: kpisPeriod?.historicoDiario || [],
    perdas,
  };
}
export async function getUltimaAtualizacaoHoje() {
  const hojeStr = formatDateBRTYYYYMMDD();
  try {
    const ref = doc(db, "shopee_daily", hojeStr);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return data.updatedAt?.toDate?.() || null;
  } catch (err) {
    console.warn("[getUltimaAtualizacaoHoje] erro:", err);
    return null;
  }
}

function firestoreTimestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return null;
}

/** Status das rotinas automáticas Shopee/Meta (sync_state/*_health). */
export async function getSyncHealthStatus() {
  try {
    const [shopeeSnap, metaSnap, ultimaHoje] = await Promise.all([
      getDoc(doc(db, "sync_state", "shopee_health")).catch(() => null),
      getDoc(doc(db, "sync_state", "meta_health")).catch(() => null),
      getUltimaAtualizacaoHoje(),
    ]);
    const shopee = shopeeSnap?.exists?.() ? (shopeeSnap.data() || {}) : {};
    const meta = metaSnap?.exists?.() ? (metaSnap.data() || {}) : {};
    return {
      shopee: {
        lastIncrementalAt: firestoreTimestampToDate(shopee.lastIncrementalAt),
        lastIncrementalFailedAt: firestoreTimestampToDate(shopee.lastIncrementalFailedAt),
        lastReconcile15dAt: firestoreTimestampToDate(shopee.lastReconcile15dAt),
        lastReconcile15dFailedAt: firestoreTimestampToDate(shopee.lastReconcile15dFailedAt),
        lastRecent3dAt: firestoreTimestampToDate(shopee.lastRecent3dAt),
        lastRecent3dFailedAt: firestoreTimestampToDate(shopee.lastRecent3dFailedAt),
        lastIncrementalError: shopee.lastIncrementalError || null,
        lastReconcile15dError: shopee.lastReconcile15dError || null,
        lastRecent3dError: shopee.lastRecent3dError || null,
        aggregationMode: shopee.aggregationMode || null,
        ultimaAtualizacaoHoje: ultimaHoje,
      },
      meta: {
        lastDailySyncAt: firestoreTimestampToDate(meta.lastDailySyncAt),
        lastDailySyncFailedAt: firestoreTimestampToDate(meta.lastDailySyncFailedAt),
        lastAdsSyncAt: firestoreTimestampToDate(meta.lastAdsSyncAt),
        lastAdsSyncFailedAt: firestoreTimestampToDate(meta.lastAdsSyncFailedAt),
        lastDailySyncError: meta.lastDailySyncError || null,
        lastAdsSyncError: meta.lastAdsSyncError || null,
        lastRange: meta.lastRange || null,
      },
    };
  } catch (err) {
    console.warn("[getSyncHealthStatus] erro:", err);
    return { shopee: {}, meta: {} };
  }
}
export async function getSubIdVendasMap({ subIds } = {}) {
  const map = {};
  const ids = [...new Set(
    (subIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];

  const applyDoc = (d) => {
    const data = d.data() || {};
    const key = String(d.id || "").trim();
    if (!key) return;
    map[key] = {
      subid: d.id,
      comissao: Number(data.comissoes || 0),
      faturamento: Number(data.faturamento || 0),
      vendas: Number(data.vendas_diretas || 0) + Number(data.vendas_indiretas || 0),
      qtdItens: Number(data.qtd_itens || 0),
    };
  };

  if (ids.length > 0) {
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const snap = await getDocs(query(
        collection(db, "subid_vendas"),
        where(documentId(), "in", chunk),
      )).catch(() => ({ docs: [] }));
      snap.docs.forEach(applyDoc);
    }
    return map;
  }

  const snap = await getDocs(query(collection(db, "subid_vendas"), limit(500)));
  snap.forEach(applyDoc);
  return map;
}

/** Resumo Meta no período — conta (meta_ads_daily) vs atribuído nas linhas SubID. */
export function calcMetaGastoResumo(kpis, subIdRows = []) {
  const metaConta = roundMoney(Number(kpis?.gastoMeta || 0));
  const pinConta = roundMoney(Number(kpis?.gastoPin || 0));
  let metaNasLinhas = 0;
  let pinNasLinhas = 0;
  for (const r of subIdRows || []) {
    if (r._isGastoGap) continue;
    metaNasLinhas += Number(r.meta_gasto ?? r.gasto ?? 0);
    pinNasLinhas += Number(r.pin_gasto || 0);
  }
  metaNasLinhas = roundMoney(metaNasLinhas);
  pinNasLinhas = roundMoney(pinNasLinhas);
  const metaNaoAtribuido = roundMoney(Math.max(0, metaConta - metaNasLinhas));
  return {
    metaConta,
    pinConta,
    metaNasLinhas,
    pinNasLinhas,
    metaNaoAtribuido,
    metaSource: kpis?.metaSource || "meta_ads_daily",
  };
}

export async function getGastoMetaDiarioByPeriod(startDate, endDate) {
  try {
    const snap = await fetchMetaAdsDailySnapshot(startDate, endDate);
    if (!snap || snap.empty) return null;

    let gastoMeta = 0;
    const diasSet = new Set();
    snap.forEach((d) => {
      const x = d.data() || {};
      gastoMeta += Number(x.valorUsado || 0);
      if (x.data) diasSet.add(x.data);
    });

    return {
      gastoMeta: Math.round(gastoMeta * 100) / 100,
      diasComDados: diasSet.size,
    };
  } catch (err) {
    console.warn("[getGastoMetaDiarioByPeriod] erro:", err);
    return null;
  }
}

/** Versão dos dados Shopee — incrementada pelo backend só quando há gravação real. */
export async function getShopeeDashboardDataVersion() {
  try {
    const snap = await getDoc(doc(db, "sync_state", "shopee_health"));
    if (!snap.exists()) return 0;
    return Number(snap.data()?.dataVersion || 0);
  } catch {
    return 0;
  }
}

const alvoAlinhamentoCache = new Map();

export function clearDashboardQueryCaches() {
  invalidateMetaAdsDailyCache(1500); // 1.5s debounce to prevent churn
  perdasKpiCache.clear();
  alvoAlinhamentoCache.clear();
  clearMetaAdsCache();
  invalidateDataVersionsCache();
  invalidateProdutoMensalCache();
}

export async function fetchShopeeDailyDocsForRange(startDate, endDate) {
  const dailyRef = collection(db, "shopee_daily");
  let docs = [];
  if (startDate === endDate) {
    const snapDoc = await getDoc(doc(db, "shopee_daily", startDate));
    const docValido = snapDoc.exists() && !isDailyMetricsVazio(snapDoc.data());
    if (docValido) {
      docs = [snapDoc];
    }
  } else {
    const q = query(
      dailyRef,
      where(documentId(), ">=", startDate),
      where(documentId(), "<=", endDate),
    );
    const snap = await getDocs(q);
    docs = snap.docs;
  }
  return docs;
}

/** Totais Shopee do período (1 doc/dia) — fonte de verdade do Dashboard. */
async function lerTotaisShopeeDailyPeriodo(startDate, endDate) {
  const docs = await fetchShopeeDailyDocsForRange(startDate, endDate);
  const tot = {
    comissao_estimada: 0,
    fat_bruto: 0,
    vendas: 0,
    pedidos: 0,
  };
  let dias = 0;
  docs.forEach((d) => {
    const x = d.data() || {};
    if (isDailyMetricsVazio(x)) return;
    dias += 1;
    tot.comissao_estimada += Number(x.comissao_estimada ?? x.comissao_total ?? 0);
    tot.fat_bruto += Number(x.faturamento ?? x.gmv_total ?? 0);
    tot.vendas += Number(x.vendas ?? 0);
    tot.pedidos += Number(x.pedidos ?? 0);
  });
  if (dias === 0) return null;
  return tot;
}

/** aggregation_mode gravado no sync (ex.: promosapp-node-once). */
async function lerAggModeShopeeDailyPeriodo(startStr, endStr) {
  if (!startStr || !endStr) return "";
  const docs = await fetchShopeeDailyDocsForRange(startStr, endStr);
  let mode = "";
  docs.forEach((d) => {
    const m = String(d.data()?.aggregation_mode || "");
    if (!m) return;
    if (!mode) mode = m;
    else if (mode !== m) mode = "mixed";
  });
  return mode;
}

/** Soma split concluída/pendente de shopee_daily (triangulação PATCH I). */
async function sumSplitShopeeDailyPeriodo(startStr, endStr) {
  const docs = await fetchShopeeDailyDocsForRange(startStr, endStr);
  let concluida = 0;
  let pendente = 0;
  let estimada = 0;
  let dias = 0;
  docs.forEach((d) => {
    const x = d.data() || {};
    if (isDailyMetricsVazio(x)) return;
    dias += 1;
    concluida += Number(x.comissao_concluida || 0);
    pendente += Number(x.comissao_pendente || 0);
    estimada += Number(x.comissao_estimada ?? x.comissao_total ?? 0);
  });
  if (dias === 0) return null;
  return {
    concluida: roundMoney(concluida),
    pendente: roundMoney(pendente),
    estimada: roundMoney(estimada),
    dias,
  };
}

function logTriangulacaoSplitComissao(startStr, endStr, shopeeSplit, kpis, fonte) {
  if (!import.meta.env.DEV) return;
  console.log("[PATCH_I split triangulação]", {
    periodo: `${startStr} → ${endStr}`,
    shopee_daily: shopeeSplit,
    painel_resumo_card: {
      fonte,
      concluida: kpis?.comissaoConcluida,
      pendente: kpis?.comissaoPendente,
      estimada: kpis?.comissaoEstimada ?? kpis?.comissao,
    },
  });
}

/**
 * Alvo único para alinhar SubID/produto aos KPIs — evita divergência dia a dia.
 * Mês calibrado → meta oficial/CSV; demais períodos → soma de shopee_daily.
 */
async function resolverAlvoAlinhamentoShopee(startDate, endDate) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const { versionKey } = await fetchDataVersions().catch(() => ({ versionKey: "0" }));
  const key = `${startStr}|${endStr}|${versionKey}`;
  if (alvoAlinhamentoCache.has(key)) return alvoAlinhamentoCache.get(key);

  const alvoOficial = getShopeeOficialTargetForRange(startDate, endDate);
  let resultado = null;

  if (alvoOficial) {
    const csvRef = getShopeeCsvBatimentoRef(alvoOficial.monthKey);
    if (csvRef && isShopeeCsvSnapEnabled(alvoOficial.monthKey)) {
      resultado = {
        comissao: csvRef.comissao,
        gmv: csvRef.gmv,
        itens: csvRef.itens,
        pedidos: csvRef.pedidos,
      };
    } else if (isShopeePanelAlignEnabled() && Number(alvoOficial.comissao || 0) > 0) {
      resultado = {
        comissao: alvoOficial.comissao,
        gmv: alvoOficial.gmv,
        itens: alvoOficial.itens,
        pedidos: alvoOficial.pedidos,
      };
    }
  }

  if (!resultado) {
    const shopeeTot = await lerTotaisShopeeDailyPeriodo(startStr, endStr);
    if (shopeeTot) {
      resultado = {
        comissao: shopeeTot.comissao_estimada,
        gmv: shopeeTot.fat_bruto,
        itens: shopeeTot.vendas,
        pedidos: shopeeTot.pedidos,
      };
    }
  }

  alvoAlinhamentoCache.set(key, resultado);
  return resultado;
}

function kpiTargetParaAlvo(kpiTarget) {
  if (!kpiTarget) return null;
  const comissao = comissaoRealPeriodo(kpiTarget);
  const gmv = Number(kpiTarget.fatBruto ?? kpiTarget.fat_bruto ?? 0);
  const itens = Number(kpiTarget.vendas ?? 0);
  const pedidos = Number(kpiTarget.pedidos ?? 0);
  if (comissao <= 0 && gmv <= 0 && itens <= 0) return null;
  return { comissao, gmv, itens, pedidos };
}

function warnDriftAgregadosVsAlvo(rows, alvo, label) {
  if (!import.meta.env.DEV || !rows?.length || !alvo) return;
  const sumCom = roundMoney(rows.reduce(
    (s, r) => s + Number(r.comissoes_estimadas ?? r.comissao_estimada ?? r.comissoes ?? 0),
    0,
  ));
  const sumGmv = roundMoney(rows.reduce((s, r) => s + Number(r.faturamento || 0), 0));
  const sumItens = rows.reduce((s, r) => s + Number(r.qtd_itens ?? r.total_vendas ?? 0), 0);
  const diffCom = Math.abs(sumCom - alvo.comissao);
  const diffGmv = Math.abs(sumGmv - alvo.gmv);
  const diffItens = Math.abs(sumItens - alvo.itens);
  if (diffCom > 0.5 || diffGmv > 1 || diffItens > 0) {
    console.warn(
      `[${label}] drift pré-alinhamento: comissão Δ${diffCom.toFixed(2)} GMV Δ${diffGmv.toFixed(2)} itens Δ${diffItens} — corrigido automaticamente`,
    );
  }
}

async function alinharAgregadosPeriodoAoShopee(
  rows,
  startDate,
  endDate,
  kind,
  kpiTargetFallback = null,
  alvoPrecomputado = undefined,
) {
  if (!rows?.length) return rows;
  let alvo = alvoPrecomputado;
  if (alvo === undefined) {
    alvo = await resolverAlvoAlinhamentoShopee(startDate, endDate);
  }
  if (!alvo) alvo = kpiTargetParaAlvo(kpiTargetFallback);
  if (!alvo) {
    return kind === "subid" ? rows.map((r) => applySubIdFinanceiroRow(r)) : rows;
  }
  warnDriftAgregadosVsAlvo(rows, alvo, kind === "subid" ? "SubID" : "Produto");
  const aligned = alinharAgregadosAoPainelOficial(rows, alvo, kind);
  if (kind === "subid") {
    return aligned.map((r) => applySubIdFinanceiroRow(r));
  }
  return aligned;
}

function agregarPorDiaDeSubidSnapshot(subidSnap, startStr, endStr) {
  const porDia = {};
  subidSnap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const data = d.data || startStr;
    if (data < startStr || data > endStr) return;
    if (!porDia[data]) {
      porDia[data] = {
        data,
        comissoes: 0,
        comissoes_estimadas: 0,
        faturamento: 0,
        total_vendas: 0,
        pedidos: 0,
        gasto: 0,
        bySubId: {},
      };
    }
    const subid = normalizeSubId(String(d.subid || "").trim() || "ORGANICO");
    const { real: comissaoReal, estimada: comissaoEst } = parseSubIdDailyComissaoFields(d);
    const fat = Number(d.faturamento || 0);
    const vendas = Number(d.qtd_itens || 0);
    const pedidos = Number(d.pedidos || 0);

    porDia[data].comissoes += comissaoReal;
    porDia[data].comissoes_estimadas = (porDia[data].comissoes_estimadas || 0) + comissaoEst;
    porDia[data].faturamento += fat;
    porDia[data].total_vendas += vendas;
    porDia[data].pedidos += pedidos;

    if (!porDia[data].bySubId[subid]) {
      porDia[data].bySubId[subid] = {
        comissoes: 0, comissoes_estimadas: 0, faturamento: 0, total_vendas: 0, gasto: 0,
      };
    }
    porDia[data].bySubId[subid].comissoes += comissaoReal;
    porDia[data].bySubId[subid].comissoes_estimadas += comissaoEst;
    porDia[data].bySubId[subid].faturamento += fat;
    porDia[data].bySubId[subid].total_vendas += vendas;
  });
  return porDia;
}

function aplicarGastoMetaAoPorDia(porDia, metaSnap, startStr, endStr) {
  if (!metaSnap?.forEach) return porDia;
  metaSnap.forEach((docSnap) => {
    const m = docSnap.data() || {};
    const data = m.data;
    if (!data || data < startStr || data > endStr) return;
    const subid = normalizeSubId(m.subid || m.nomeAnuncio || "");
    const gasto = Number(m.valorUsado || 0);
    if (!gasto) return;

    if (!porDia[data]) {
      porDia[data] = {
        data,
        comissoes: 0,
        faturamento: 0,
        total_vendas: 0,
        pedidos: 0,
        gasto: 0,
        bySubId: {},
      };
    }
    porDia[data].gasto += gasto;
    if (subid) {
      if (!porDia[data].bySubId[subid]) {
        porDia[data].bySubId[subid] = {
          comissoes: 0, comissoes_estimadas: 0, faturamento: 0, total_vendas: 0, gasto: 0,
        };
      }
      porDia[data].bySubId[subid].gasto += gasto;
    }
  });
  return porDia;
}

function finalizarLinhasDiarias(porDia, settings = {}) {
  return Object.values(porDia)
    .map((row) => {
      const fin = calcSubIdFinanceiroMetrics(subIdComissaoParaLucro(row), row.gasto);
      const { bySubId, ...rest } = row;
      return {
        ...rest,
        total_vendas: Math.round(rest.total_vendas || 0),
        pedidos: Math.round(rest.pedidos || 0),
        lucro: fin.lucro,
        roi: fin.roi,
        roas: fin.roas,
        _bySubId: bySubId,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Coleta + agregação granular (subid_daily + meta/clique) — sem alinhamento nem finalizeSubIdRowsForPainel.
 */
export async function montarBundleGranular(startStr, endStr, {
  enrichMeta = true,
  includeCliques = true,
  settings = {},
  skipPin = false,
} = {}) {
  const subidSnap = await getDocs(query(
    collection(db, "subid_daily"),
    where("data", ">=", startStr),
    where("data", "<=", endStr),
  )).catch(() => ({ empty: true, forEach: () => {} }));

  const subIdMap = {};
  subidSnap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const raw = String(d.subid || "").trim();
    const subid = normalizeSubId(raw) || raw || "ORGANICO";

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

    const { real: comissaoReal, estimada: comissaoEst } = parseSubIdDailyComissaoFields(d);
    subIdMap[subid].comissoes += comissaoReal;
    subIdMap[subid].comissoes_estimadas += comissaoEst;
    subIdMap[subid].faturamento += Number(d.faturamento || 0);
    subIdMap[subid].vendas_diretas += Number(d.vendas_diretas || 0);
    subIdMap[subid].vendas_indiretas += Number(d.vendas_indiretas || 0);
    subIdMap[subid].qtd_itens += Number(d.qtd_itens || 0);
    subIdMap[subid].total_vendas += Number(d.qtd_itens || 0);
    subIdMap[subid].pedidos += Number(d.pedidos || 0);
  });

  let rows = Object.values(subIdMap).map((r) => {
    const ticket = r.total_vendas > 0 ? r.faturamento / r.total_vendas : 0;
    return { ...r, ticket_medio: ticket };
  });

  let metaDailySnap = null;
  let cliqueDailySnap = null;

  if (enrichMeta) {
    metaDailySnap = await fetchMetaAdsDailySnapshot(startStr, endStr);
  }

  if (enrichMeta && includeCliques) {
    cliqueDailySnap = await getDocs(query(
      collection(db, "clique_daily"),
      where("data", ">=", startStr),
      where("data", "<=", endStr),
    )).catch(() => ({ empty: true, forEach: () => {} }));
  }

  if (enrichMeta) {
    rows = await enrichSubIdsComMetaNoPeriodo(rows, startStr, endStr, settings, {
      metaDailySnap,
      cliqueDailySnap: includeCliques ? cliqueDailySnap : { empty: true, forEach: () => {} },
      skipPin,
    });
  }

  const mergedMap = {};
  for (const r of rows) {
    const sid = normalizeSubId(r.subid || r.id || "") || r.subid || r.id;
    if (!sid) continue;
    mergedMap[sid] = { ...r, id: sid, subid: sid };
  }

  let porDia = agregarPorDiaDeSubidSnapshot(subidSnap, startStr, endStr);
  if (metaDailySnap) {
    porDia = aplicarGastoMetaAoPorDia(porDia, metaDailySnap, startStr, endStr);
  }

  return { subIdMap: mergedMap, porDia };
}

export async function finalizarSubIdPeriodoBundle(
  rows,
  porDia,
  startDate,
  endDate,
  {
    settings = {},
    kpiTarget = null,
    includeDaily = true,
    alvoPrecomputado = undefined,
  } = {},
) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);

  let alvoDaily = alvoPrecomputado;
  if (alvoDaily === undefined) {
    alvoDaily = await resolverAlvoAlinhamentoShopee(startDate, endDate);
  }
  if (!alvoDaily) alvoDaily = kpiTargetParaAlvo(kpiTarget);

  const alignedRows = await alinharAgregadosPeriodoAoShopee(
    rows,
    startDate,
    endDate,
    "subid",
    kpiTarget,
    alvoPrecomputado,
  );

  const { gastoMeta, gastoPin } = extractGastoKpisFromTarget(kpiTarget);
  const subIds = finalizeSubIdRowsForPainel(alignedRows, { settings, gastoMeta, gastoPin })
    .map((r) => applySubIdFinanceiroRow(r));

  let dailyBreakdown = [];
  if (includeDaily) {
    dailyBreakdown = finalizarLinhasDiarias(porDia, settings);
    if (alvoDaily?.comissao > 0) {
      dailyBreakdown = alinharDailyBreakdownAoAlvo(dailyBreakdown, alvoDaily, (row) => {
        const fin = calcSubIdFinanceiroMetrics(subIdComissaoParaLucro(row), row.gasto || 0);
        const { _bySubId, ...rest } = row;
        return {
          ...rest,
          lucro: fin.lucro,
          roi: fin.roi,
          roas: fin.roas,
          _bySubId,
          _alinhadoPainelShopee: true,
        };
      });
    }
  }

  return { subIds, dailyBreakdown };
}

/**
 * Uma leitura de subid_daily (+ meta/clique compartilhados) → SubIDs agregados + breakdown diário.
 * Evita reler subid_daily e meta_ads_daily duas vezes no dashboard.
 */
export async function getSubIdPeriodoBundle(startDate, endDate, {
  enrichMeta = true,
  settings = {},
  kpiTarget = null,
  includeDaily = true,
  includeCliques = true,
} = {}) {
  if (!startDate || !endDate) return { subIds: [], dailyBreakdown: [] };

  await loadShopeeOficialPeriodRef();

  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);

  const { subIdMap, porDia } = await montarBundleGranular(startStr, endStr, {
    enrichMeta,
    includeCliques,
    settings,
    skipPin: false,
  });

  const rows = Object.values(subIdMap);
  const alvoPrecomputado = await resolverAlvoAlinhamentoShopee(startDate, endDate);

  return finalizarSubIdPeriodoBundle(rows, porDia, startDate, endDate, {
    settings,
    kpiTarget,
    includeDaily,
    alvoPrecomputado,
  });
}

export async function getSubIdsByPeriod(startDate, endDate, options = {}) {
  const { subIds } = await getSubIdPeriodoBundle(startDate, endDate, {
    ...options,
    includeDaily: false,
  });
  return subIds;
}

async function enrichSubIdsComMetaNoPeriodo(subIds, startStr, endStr, settings = {}, preloaded = {}) {
  const { impostoMeta = 0, impostoNf = 0, skipPin = false } = preloaded;

  const [metaDailySnap, cliqueDailySnap] = await Promise.all([
    preloaded.metaDailySnap != null
      ? Promise.resolve(preloaded.metaDailySnap)
      : fetchMetaAdsDailySnapshot(startStr, endStr),
    preloaded.cliqueDailySnap != null
      ? Promise.resolve(preloaded.cliqueDailySnap)
      : getDocs(query(
        collection(db, "clique_daily"),
        where("data", ">=", startStr),
        where("data", "<=", endStr),
      )).catch(() => ({ empty: true, forEach: () => {} })),
  ]);

  const metaBySubId = {};
  let metaSource = "meta_ads_proporcional";
  const importIds = await getLatestImportIds().catch(() => ({}));

  if (!metaDailySnap.empty) {
    metaDailySnap.forEach((docSnap) => {
      const m = docSnap.data() || {};
      const key = normalizeSubId(m.subid || m.nomeAnuncio || "");
      if (!key) return;
      if (!metaBySubId[key]) metaBySubId[key] = { gasto: 0, cliques_anuncio: 0 };
      metaBySubId[key].gasto += Number(m.valorUsado || 0);
      metaBySubId[key].cliques_anuncio += Number(m.cliquesTotal || 0);
    });
    metaSource = "meta_ads_daily";
  } else if (importIds.metaAds) {
    const metaAds = await getMetaAds(importIds.metaAds).catch(() => []);
    const metaBySubRaw = await buildMetaBySubForPeriod(startStr, endStr, metaAds, { metaDailySnap });
    Object.entries(metaBySubRaw).forEach(([sid, v]) => {
      metaBySubId[sid] = {
        gasto: v.spend || 0,
        cliques_anuncio: v.cliques_anuncio || 0,
      };
    });
  }

  const pinterest = !skipPin && importIds.pinterest
    ? await getPinterest(importIds.pinterest).catch(() => [])
    : [];
  const pinBySubRaw = skipPin ? {} : buildPinBySubForPeriod(startStr, endStr, pinterest);
  const pinBySubId = {};
  Object.entries(pinBySubRaw).forEach(([sid, v]) => {
    pinBySubId[sid] = {
      gasto: v.spend || 0,
      cliques_anuncio: v.cliques_anuncio || 0,
    };
  });

  const cliquesBySubId = {};
  if (!cliqueDailySnap.empty) {
    cliqueDailySnap.forEach((d) => {
      const x = d.data() || {};
      const sid = normalizeSubId(x.subid || x.sub_id_norm || "");
      if (!sid) return;
      cliquesBySubId[sid] = (cliquesBySubId[sid] || 0) + Number(x.cliques || 0);
    });
  } else {
    // Sem clique_daily no período → cliques = 0 (import manual ainda não cobriu o range).
  }

  const rowBySid = new Map();
  for (const r of subIds || []) {
    const sid = normalizeSubId(r.subid || r.id || "");
    if (!sid) continue;
    rowBySid.set(sid, { ...r, subid: r.subid || sid, id: r.id || sid });
  }

  const ensureSid = (sid) => {
    if (!sid || rowBySid.has(sid)) return;
    rowBySid.set(sid, emptySubIdRow(sid));
  };

  for (const sid of new Set([...Object.keys(metaBySubId), ...Object.keys(pinBySubId)])) {
    const gastoAds = (metaBySubId[sid]?.gasto || 0) + (pinBySubId[sid]?.gasto || 0);
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);
    if (gastoAds > 0 || cliquesAds > 0) ensureSid(sid);
  }

  for (const [sid, cliques] of Object.entries(cliquesBySubId)) {
    if ((cliques || 0) > 0) ensureSid(sid);
  }

  return [...rowBySid.values()].map((r) => {
    const sid = normalizeSubId(r.subid || r.id || "");
    const metaGasto = metaBySubId[sid]?.gasto || 0;
    const pinGasto = pinBySubId[sid]?.gasto || 0;
    const gastoAds = metaGasto + pinGasto;
    const cliquesAds = (metaBySubId[sid]?.cliques_anuncio || 0) + (pinBySubId[sid]?.cliques_anuncio || 0);
    const clShopee = cliquesBySubId[sid] || cliquesBySubId[r.subid] || 0;
    const comissao = subIdComissaoParaLucro(r);
    const fin = calcSubIdFinanceiroMetrics(comissao, gastoAds);
    return {
      ...r,
      subid: r.subid || sid,
      gasto: fin.gasto,
      meta_gasto: metaGasto,
      pin_gasto: pinGasto,
      cliques_anuncio: cliquesAds,
      cliques_shopee: clShopee,
      batimento: cliquesAds > 0 ? clShopee / cliquesAds : 0,
      lucro: fin.lucro,
      roi: fin.roi,
      imposto_total: fin.impostoTotal,
      _metaGastoSource: metaSource,
    };
  });
}

const produtoMensalCache = new Map();

function invalidateProdutoMensalCache() {
  produtoMensalCache.clear();
}

async function fetchProdutoMensalDoc(monthKey, versionKey) {
  const key = `${monthKey}|${versionKey}`;
  if (produtoMensalCache.has(key)) return produtoMensalCache.get(key);
  const snap = await getDoc(doc(db, "produto_mensal", monthKey)).catch(() => null);
  const data = snap?.exists?.() ? snap.data() : null;
  produtoMensalCache.set(key, data);
  return data;
}

function ensureProdutoMapEntry(produtoMap, pid, nome = "Produto") {
  if (!produtoMap[pid]) {
    produtoMap[pid] = {
      produto_id: pid,
      nome,
      comissoes: 0,
      comissao_estimada: 0,
      comissoes_pendentes: 0,
      comissoes_concluidas: 0,
      qtd_itens: 0,
      faturamento: 0,
      cliques: 0,
      sub_ids: new Set(),
      _datas: new Set(),
    };
  }
  return produtoMap[pid];
}

function agregarProdutoDailyDoc(produtoMap, d) {
  const pid = String(d.produto_id || "").trim() || "desconhecido";
  const p = ensureProdutoMapEntry(produtoMap, pid, d.nome || "Produto");
  p.comissoes += Number(d.comissao_estimada ?? d.comissoes ?? 0);
  p.comissao_estimada += Number(d.comissao_estimada ?? d.comissoes ?? 0);
  p.comissoes_pendentes += Number(d.comissoes_pendentes || 0);
  p.comissoes_concluidas += Number(d.comissoes_concluidas || 0);
  p.qtd_itens += Number(d.qtd_itens || 0);
  p.faturamento += Number(d.faturamento || 0);
  p.cliques += Number(d.cliques || 0);
  if (d.data) p._datas.add(d.data);
  if (d.sub_id) p.sub_ids.add(d.sub_id);
  if (Array.isArray(d.sub_ids)) d.sub_ids.forEach((s) => p.sub_ids.add(s));
}

function mergeProdutoMensalSlice(produtoMap, mensalDoc, sliceStart, sliceEnd) {
  for (const p of mensalDoc?.produtos || []) {
    if (!p || p.produto_id === "__OUTROS__") continue;
    const entry = ensureProdutoMapEntry(produtoMap, p.produto_id, p.nome || "Produto");
    if (p.porDia && typeof p.porDia === "object") {
      for (const [day, cell] of Object.entries(p.porDia)) {
        if (day < sliceStart || day > sliceEnd) continue;
        entry.comissoes += Number(cell.comissao_estimada || 0);
        entry.comissao_estimada += Number(cell.comissao_estimada || 0);
        entry.qtd_itens += Number(cell.qtd_itens || 0);
        entry.faturamento += Number(cell.faturamento || 0);
        entry.cliques += Number(cell.cliques || 0);
        entry._datas.add(day);
      }
    }
    if (Array.isArray(p.sub_ids)) p.sub_ids.forEach((s) => entry.sub_ids.add(s));
  }
}

async function fetchProdutoDailyRange(startStr, endStr) {
  const q = query(
    collection(db, "produto_daily"),
    where("data", ">=", startStr),
    where("data", "<=", endStr),
  );
  const snap = await getDocs(q).catch(() => ({ forEach: () => {} }));
  const produtoMap = {};
  snap.forEach((docSnap) => agregarProdutoDailyDoc(produtoMap, docSnap.data() || {}));
  return produtoMap;
}

async function getProdutosByPeriodGranular(startDate, endDate) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  return fetchProdutoDailyRange(startStr, endStr);
}

export async function getProdutosByPeriod(startDate, endDate, { topN = null } = {}) {
  if (!startDate || !endDate) return [];

  await loadShopeeOficialPeriodRef();

  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const USE_MENSAL = String(import.meta.env.VITE_PRODUTO_MENSAL ?? "1") !== "0";

  let produtoMap = {};

  if (!USE_MENSAL) {
    produtoMap = await getProdutosByPeriodGranular(startDate, endDate);
  } else {
    const { cold, hot } = splitColdHot(startStr, endStr);
    const { versionKey } = await fetchDataVersions().catch(() => ({ versionKey: "0" }));

    if (cold) {
      const monthKeys = listMonthKeysInRange(cold[0], cold[1]);
      for (const mk of monthKeys) {
        const monthStart = `${mk}-01`;
        const monthEnd = brtLastDayOfMonth(mk);
        const sliceStart = cold[0] > monthStart ? cold[0] : monthStart;
        const sliceEnd = cold[1] < monthEnd ? cold[1] : monthEnd;
        const mensalDoc = await fetchProdutoMensalDoc(mk, versionKey);
        if (mensalDoc?.produtos?.length) {
          mergeProdutoMensalSlice(produtoMap, mensalDoc, sliceStart, sliceEnd);
        } else {
          const fallback = await fetchProdutoDailyRange(sliceStart, sliceEnd);
          for (const [pid, p] of Object.entries(fallback)) {
            const entry = ensureProdutoMapEntry(produtoMap, pid, p.nome);
            entry.comissoes += p.comissoes;
            entry.comissao_estimada += p.comissao_estimada;
            entry.comissoes_pendentes += p.comissoes_pendentes;
            entry.comissoes_concluidas += p.comissoes_concluidas;
            entry.qtd_itens += p.qtd_itens;
            entry.faturamento += p.faturamento;
            entry.cliques += p.cliques;
            p._datas.forEach((d) => entry._datas.add(d));
            p.sub_ids.forEach((s) => entry.sub_ids.add(s));
          }
        }
      }
    }

    if (hot) {
      const hotMap = await fetchProdutoDailyRange(hot[0], hot[1]);
      for (const [pid, p] of Object.entries(hotMap)) {
        const entry = ensureProdutoMapEntry(produtoMap, pid, p.nome);
        entry.comissoes += p.comissoes;
        entry.comissao_estimada += p.comissao_estimada;
        entry.comissoes_pendentes += p.comissoes_pendentes;
        entry.comissoes_concluidas += p.comissoes_concluidas;
        entry.qtd_itens += p.qtd_itens;
        entry.faturamento += p.faturamento;
        entry.cliques += p.cliques;
        p._datas.forEach((d) => entry._datas.add(d));
        p.sub_ids.forEach((s) => entry.sub_ids.add(s));
      }
    }
  }

  let rows = Object.values(produtoMap).map((p) => ({
    ...p,
    sub_ids: [...p.sub_ids],
    _datas: [...p._datas],
  })).sort((a, b) => (b.comissao_estimada || 0) - (a.comissao_estimada || 0));
  rows = await alinharAgregadosPeriodoAoShopee(rows, startDate, endDate, "produto");
  const totalAgregados = rows.length;
  if (topN != null && topN > 0 && rows.length > topN) {
    rows = rows.slice(0, topN);
    rows._totalAgregados = totalAgregados;
    rows._topNLimitado = true;
  }
  return rows;
}

/**
 * Desempenho dia a dia — usa bundle interno (sem reler subid_daily).
 */
export async function getSubIdDailyBreakdownByPeriod(startDate, endDate, { settings = {} } = {}) {
  const { dailyBreakdown } = await getSubIdPeriodoBundle(startDate, endDate, {
    settings,
    enrichMeta: false,
    includeDaily: true,
    includeCliques: false,
  });
  return dailyBreakdown;
}

/** Filtra linhas diárias pelos SubIDs selecionados (agrega métricas por dia). */
export function filterSubIdDailyBreakdown(rows, subIdsFilter) {
  if (!subIdsFilter?.length) return rows || [];
  const filterSet = new Set(subIdsFilter.map((s) => normalizeSubId(s)));

  return (rows || []).map((row) => {
    let comissoes = 0;
    let comissoes_estimadas = 0;
    let faturamento = 0;
    let total_vendas = 0;
    let gasto = 0;
    for (const [sid, v] of Object.entries(row._bySubId || {})) {
      if (!filterSet.has(sid)) continue;
      comissoes += v.comissoes || 0;
      comissoes_estimadas += v.comissoes_estimadas || 0;
      faturamento += v.faturamento || 0;
      total_vendas += v.total_vendas || 0;
      gasto += v.gasto || 0;
    }
    const fin = calcSubIdFinanceiroMetrics(subIdComissaoParaLucro({ comissoes, comissoes_estimadas }), gasto);
    return {
      data: row.data,
      comissoes,
      comissoes_estimadas,
      faturamento,
      total_vendas: Math.round(total_vendas),
      pedidos: 0,
      gasto: fin.gasto,
      lucro: fin.lucro,
      roi: fin.roi,
      roas: fin.roas,
    };
  }).filter((r) => r.comissoes > 0 || r.gasto > 0 || r.total_vendas > 0);
}

function formatPerdasPeriodDate(d) {
  if (typeof d === "string" && d.length === 10) return d;
  const dt = new Date(d);
  const ano = dt.getFullYear();
  const mes = String(dt.getMonth() + 1).padStart(2, "0");
  const dia = String(dt.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function applyPerdasCsvSnap(out, startDate, endDate) {
  const alvo = getShopeeOficialTargetForRange(startDate, endDate);
  if (alvo && isShopeeCsvSnapEnabled(alvo.monthKey)) {
    return snapPerdasAoCsvBatimento(out, alvo.monthKey);
  }
  return out;
}

const perdasKpiCache = new Map();

function perdasKpiCacheKey(startStr, endStr) {
  return `${startStr}|${endStr}`;
}

/** Soma KPIs de perdas a partir de shopee_daily (1 doc/dia — barato). */
async function getPerdasKpiFromShopeeDaily(startStr, endStr) {
  const dailyRef = collection(db, "shopee_daily");
  let snap;

  if (startStr === endStr) {
    const snapDoc = await getDoc(doc(db, "shopee_daily", startStr));
    snap = {
      forEach: (cb) => {
        if (snapDoc.exists()) cb(snapDoc);
      },
    };
  } else {
    snap = await getDocs(query(
      dailyRef,
      where(documentId(), ">=", startStr),
      where(documentId(), "<=", endStr),
    ));
  }

  let countPerdas = 0;
  let totalFatPerdido = 0;
  let totalComissaoPerdida = 0;
  let diasComPerdas = 0;

  snap.forEach((d) => {
    const x = d.data() || {};
    const pp = Number(x.perdas_pedidos ?? 0);
    const pf = Number(x.perdas_fat ?? 0);
    const pc = Number(x.perdas_comissao ?? 0);
    if (pp > 0 || pf > 0 || pc > 0) diasComPerdas += 1;
    countPerdas += pp;
    totalFatPerdido += pf;
    totalComissaoPerdida += pc;
  });

  return {
    countPerdas,
    totalFatPerdido: roundMoney(totalFatPerdido),
    totalComissaoPerdida: roundMoney(totalComissaoPerdida),
    _hasRollup: diasComPerdas > 0,
  };
}

/** Soma perdas deduplicadas por pedido/dia a partir de painel_resumo (barato). */
export async function getPerdasKpiFromPainelResumo(startDate, endDate) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const bucketData = await loadMonthlyBucketData(startDate, endDate).catch(() => null);
  if (!bucketData?.painel) return null;
  const { perdas } = buildKpisFromPainelBuckets(bucketData.painel, startStr, endStr);
  if (!perdas?.countPerdas) return null;
  return applyPerdasCsvSnap(perdas, startDate, endDate);
}

/** Fallback leve — nunca faz getDocs em log_perdas (evita 20k+ reads). */
async function getPerdasKpiFallbackLeve(startStr, endStr) {
  const fromDaily = await getPerdasKpiFromShopeeDaily(startStr, endStr);
  if (fromDaily._hasRollup) {
    const { _hasRollup, ...out } = fromDaily;
    return out;
  }

  try {
    const q = query(
      collection(db, "log_perdas"),
      where("data", ">=", startStr),
      where("data", "<=", endStr),
    );
    const countSnap = await getCountFromServer(q);
    return {
      countPerdas: Number(countSnap.data().count || 0),
      totalFatPerdido: 0,
      totalComissaoPerdida: 0,
      _approx: true,
    };
  } catch (countErr) {
    console.warn("[getPerdasKpiByPeriod] fallback leve falhou:", countErr?.message || countErr);
    return { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };
  }
}

/** KPI de perdas — aggregation (~1 read/1000 docs) ou shopee_daily (1 doc/dia). */
export async function getPerdasKpiByPeriod(startDate, endDate) {
  if (!startDate || !endDate) {
    return { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };
  }

  const startStr = formatPerdasPeriodDate(startDate);
  const endStr = formatPerdasPeriodDate(endDate);
  const cacheKey = perdasKpiCacheKey(startStr, endStr);
  if (perdasKpiCache.has(cacheKey)) {
    return perdasKpiCache.get(cacheKey);
  }

  const resolve = async () => {
    const fromPainel = await getPerdasKpiFromPainelResumo(startDate, endDate).catch(() => null);
    if (fromPainel?.countPerdas) return fromPainel;

    try {
      const q = query(
        collection(db, "log_perdas"),
        where("data", ">=", startStr),
        where("data", "<=", endStr),
      );
      const agg = await getAggregateFromServer(q, {
        countPerdas: count(),
        totalFatPerdido: sum("faturamento_perdido"),
        totalComissaoPerdida: sum("comissao_perdida"),
      });
      const data = agg.data();
      const out = {
        countPerdas: Number(data.countPerdas || 0),
        totalFatPerdido: Math.round(Number(data.totalFatPerdido || 0) * 100) / 100,
        totalComissaoPerdida: Math.round(Number(data.totalComissaoPerdida || 0) * 100) / 100,
      };
      return applyPerdasCsvSnap(out, startDate, endDate);
    } catch (err) {
      console.warn("[getPerdasKpiByPeriod] aggregate indisponível, fallback leve:", err?.message || err);
      const out = await getPerdasKpiFallbackLeve(startStr, endStr);
      return applyPerdasCsvSnap(out, startDate, endDate);
    }
  };

  const result = await resolve();
  perdasKpiCache.set(cacheKey, result);
  return result;
}

/** Lista detalhada de perdas — use só em telas de auditoria (1 read/doc). */
/**
 * Carrega dashboard completo por período: KPIs, gráfico, perdas, SubID, breakdown.
 * Usa painel_resumo + subid_mensal quando disponível; fallback granular.
 */
export async function getDashboardPainelPorPeriodo(startDate, endDate, settings = {}, {
  includeProdutos = true,
  includeDaily = true,
  forceGranular = false,
} = {}) {
  if (!startDate || !endDate) {
    return {
      kpisFromSumario: null,
      perdas: { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 },
      subIds: [],
      dailyBreakdown: [],
      produtosPeriodo: [],
      metaGastoResumo: null,
      _source: "empty",
    };
  }

  await loadShopeeOficialPeriodRef();
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const diasPeriodo = diasInclusivos(startStr, endStr);
  const buscarProdutos = includeProdutos && diasPeriodo <= BUCKET_PRODUTOS_MAX_DIAS;

  const aggFirestore = await lerAggModeShopeeDailyPeriodo(startStr, endStr).catch(() => "");
  const usaPromosAppFirestore = isModoAgregacaoPromosApp(aggFirestore) || isPromosAppKpiFonteAtiva();

  let bucketData = null;
  if (!forceGranular && !usaPromosAppFirestore && diasPeriodo >= 1) {
    bucketData = await loadMonthlyBucketData(startDate, endDate).catch(() => null);
  }

  if (bucketData) {
    const importIds = await getLatestImportIds().catch(() => ({}));
    const pinterest = importIds.pinterest
      ? await getPinterest(importIds.pinterest).catch(() => [])
      : [];
    const gastoPin = sumPinGastoForPeriod(startStr, endStr, pinterest);

    const { kpis, perdas: perdasBucket } = buildKpisFromPainelBuckets(
      bucketData.painel,
      startStr,
      endStr,
      {
        impostoMeta: settings.impostoMeta || 0,
        impostoNf: settings.impostoNf || 0,
        gastoPinExtra: gastoPin,
      },
    );

    const alvoOficial = getShopeeOficialTargetForRange(startDate, endDate);
    const csvRef = alvoOficial ? getShopeeCsvBatimentoRef(alvoOficial.monthKey) : null;
    const alinhadoCsv = Boolean(
      !usaPromosAppFirestore
      && csvRef
      && isShopeeCsvSnapEnabled(alvoOficial?.monthKey),
    );
    const alinhadoPainel = Boolean(
      !usaPromosAppFirestore
      && alvoOficial
      && isShopeePanelAlignEnabled()
      && !alinhadoCsv,
    );
    if (alinhadoCsv) {
      Object.assign(kpis, {
        comissao: csvRef.comissao,
        comissaoEstimada: csvRef.comissao,
        comissaoReal: csvRef.comissao,
        fatBruto: csvRef.gmv,
        vendas: csvRef.itens,
        pedidos: csvRef.pedidos,
        shopeeDataMode: "alinhado_csv",
      });
    } else if (alinhadoPainel && alvoOficial) {
      const snapped = snapTotaisKPIsAoPainelOficial({
        comissao_estimada: kpis.comissaoEstimada,
        comissao_real: kpis.comissaoReal,
        fat_bruto: kpis.fatBruto,
        vendas: kpis.vendas,
        pedidos: kpis.pedidos,
      }, alvoOficial);
      kpis.comissao = snapped.comissao_estimada;
      kpis.comissaoEstimada = snapped.comissao_estimada;
      kpis.comissaoReal = snapped.comissao_real;
      kpis.fatBruto = snapped.fat_bruto;
      kpis.vendas = snapped.vendas;
      kpis.pedidos = snapped.pedidos;
      kpis.shopeeDataMode = "calibrado_painel";
    }

    kpis.gastoTotal = roundMoney((kpis.gastoMeta || 0) + (kpis.gastoPin || 0));
    kpis.shopeePanelAudit = buildShopeePanelAudit(
      {
        comissao: kpis.comissao,
        comissaoEstimada: kpis.comissaoEstimada,
        pedidos: kpis.pedidos,
        fatBruto: kpis.fatBruto,
        vendas: kpis.vendas,
      },
      alvoOficial,
      { alinhadoPainel, alinhadoCsv },
    );

    Object.assign(kpis, finalizarKpisComissaoDashboard({
      ...kpis,
      aggregationMode: aggFirestore || kpis.aggregationMode,
      _comissaoModoPromosApp: usaPromosAppFirestore,
      shopeeDataMode: usaPromosAppFirestore ? "promosapp" : kpis.shopeeDataMode,
    }, settings));

    const kpiTargetBundle = { ...kpis, gastoMeta: kpis.gastoMeta, gastoPin };
    const USE_HYBRID = String(import.meta.env.VITE_SUBID_HYBRID ?? "1") !== "0";
    let subIds;
    let dailyBreakdown;

    if (USE_HYBRID) {
      const { versionKey } = await fetchDataVersions().catch(() => ({ versionKey: "0" }));
      const pinBySubRaw = buildPinBySubForPeriod(startStr, endStr, pinterest);
      const pinBySubId = {};
      Object.entries(pinBySubRaw).forEach(([sid, v]) => {
        pinBySubId[sid] = { gasto: v.spend || 0, cliques_anuncio: v.cliques_anuncio || 0 };
      });
      const alvoPrecomputado = (alinhadoCsv || alinhadoPainel)
        ? await resolverAlvoAlinhamentoShopee(startDate, endDate)
        : kpiTargetParaAlvo(kpis);
      const { getSubIdHybridBundle, auditSubIdHybridVsGranular } = await import("./subIdHybridBundle.js");
      ({ subIds, dailyBreakdown } = await getSubIdHybridBundle(
        bucketData,
        startStr,
        endStr,
        startDate,
        endDate,
        {
          settings,
          kpiTarget: kpiTargetBundle,
          includeDaily,
          pinBySubId,
          gastoPinTotal: gastoPin,
          versionKey,
          alvoPrecomputado,
        },
      ));

      if (import.meta.env.DEV && String(import.meta.env.VITE_SUBID_HYBRID_AUDIT ?? "") === "1") {
        const granular = await getSubIdPeriodoBundle(startDate, endDate, {
          enrichMeta: true,
          settings,
          kpiTarget: kpiTargetBundle,
          includeDaily,
          includeCliques: true,
        });
        const warnings = auditSubIdHybridVsGranular(subIds, granular.subIds);
        if (warnings.length) {
          console.warn("[SubID hybrid audit]", warnings);
        }
      }
    } else {
      ({ subIds, dailyBreakdown } = await getSubIdPeriodoBundle(startDate, endDate, {
        enrichMeta: true,
        settings,
        kpiTarget: kpiTargetBundle,
        includeDaily,
        includeCliques: true,
      }));
    }

    let perdasFinal = applyPerdasCsvSnap(perdasBucket, startDate, endDate);
    if (!perdasFinal?.countPerdas) {
      const perdasQuery = await getPerdasKpiByPeriod(startDate, endDate);
      if (perdasQuery?.countPerdas) perdasFinal = perdasQuery;
    }

    let produtosPeriodo = [];
    if (buscarProdutos) {
      produtosPeriodo = await getProdutosByPeriod(startDate, endDate, { topN: 200 }).catch(() => []);
    }

    const metaGastoResumo = calcMetaGastoResumo(kpis, subIds);

    const shopeeSplit = await sumSplitShopeeDailyPeriodo(startStr, endStr).catch(() => null);
    logTriangulacaoSplitComissao(startStr, endStr, shopeeSplit, kpis, kpis._source || "painel_resumo");

    return {
      kpisFromSumario: kpis,
      perdas: perdasFinal,
      subIds,
      dailyBreakdown: includeDaily ? dailyBreakdown : [],
      produtosPeriodo,
      metaGastoResumo,
      _source: "monthly_bucket",
      _bucketReads: bucketData.reads,
    };
  }

  const [kpisFromSumario, perdas] = await Promise.all([
    getDashboardKPIsByPeriod(startDate, endDate, settings),
    getPerdasKpiByPeriod(startDate, endDate),
  ]);
  const bundle = await getSubIdPeriodoBundle(startDate, endDate, {
    enrichMeta: true,
    settings,
    kpiTarget: kpisFromSumario,
    includeDaily,
    includeCliques: true,
  });

  let produtosPeriodo = [];
  if (buscarProdutos) {
    produtosPeriodo = await getProdutosByPeriod(startDate, endDate, { topN: 200 }).catch(() => []);
  }

  const metaGastoResumo = calcMetaGastoResumo(kpisFromSumario, bundle.subIds || []);

  const shopeeSplit = await sumSplitShopeeDailyPeriodo(startStr, endStr).catch(() => null);
  logTriangulacaoSplitComissao(
    startStr,
    endStr,
    shopeeSplit,
    kpisFromSumario,
    kpisFromSumario?._source || "shopee_daily",
  );

  return {
    kpisFromSumario,
    perdas,
    subIds: bundle.subIds || [],
    dailyBreakdown: includeDaily ? (bundle.dailyBreakdown || []) : [],
    produtosPeriodo,
    metaGastoResumo,
    _source: usaPromosAppFirestore ? "shopee_daily_promosapp" : "granular",
  };
}

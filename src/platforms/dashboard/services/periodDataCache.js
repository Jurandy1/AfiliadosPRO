import { calcularRangeModoAll } from "../../../utils/periodoFiltro";
import { enrichProdutosPeriodoParaPainel } from "../enrichment/produtoPeriodo";
import { fetchDataVersions, invalidateDataVersionsCache } from "../cache/dataVersions";
import {
  buildPeriodCacheKey,
  getPeriodCacheEntry,
  invalidatePeriodSessionCache,
  isPeriodCacheDisabled,
  setPeriodCacheEntry,
} from "../cache/periodSessionCache";
import { invalidateMetaAdsDailyCache } from "../cache/metaAdsDailyCache";
import { invalidateAlertasBellCache } from "../../shopee/cache/alertasBellCache";
import { invalidarModoAllCache } from "../cache/modoAllCache";
import { invalidarPeriodoPainelCache } from "../cache/periodoPainelCache";
import { painelKpisTemDados } from "../utils/syncPolicy";
import {
  getDashboardKPIsByPeriod,
  getDashboardPanelModoAll,
  getDashboardPainelPorPeriodo,
  getProdutosByPeriod,
  getSubIdsByPeriod,
  clearDashboardQueryCaches,
} from "../repositories/metricsRepository";
import { invalidateSubIdHotCache } from "../repositories/subIdHybridBundle";
import { invalidateMonthlyBucketDocsCache } from "../repositories/monthlyBucketPanel";

const KIND_PAINEL = "painel";
const KIND_PRODUTOS_ENRICHED = "produtosEnriched";
const KIND_PERFORMANCE = "performance";
const KIND_MODO_ALL = "modoAll";

export { painelKpisTemDados, deveSincronizarShopee } from "../utils/syncPolicy";

/** Limpa caches locais antes de filtro/sync forçado. */
export function prepararFiltroParaDadosReais() {
  invalidateAllPeriodCaches();
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("ultimo_refresh_periodo_ts");
    }
  } catch {
    /* ignore */
  }
}

export function invalidateAllPeriodCaches() {
  invalidatePeriodSessionCache();
  invalidateDataVersionsCache();
  invalidateMetaAdsDailyCache(1500);
  invalidateAlertasBellCache();
  invalidarPeriodoPainelCache();
  invalidarModoAllCache();
  clearDashboardQueryCaches();
  invalidateSubIdHotCache();
  invalidateMonthlyBucketDocsCache();
}

async function resolveVersions(bypassCache) {
  return fetchDataVersions({ force: bypassCache });
}

function painelCacheKey(startDate, endDate, versionKey, settings) {
  return buildPeriodCacheKey(KIND_PAINEL, startDate, endDate, versionKey, settings);
}

function produtosEnrichedCacheKey(startDate, endDate, versionKey, settings) {
  return buildPeriodCacheKey(KIND_PRODUTOS_ENRICHED, startDate, endDate, versionKey, settings);
}

function performanceCacheKey(startDate, endDate, versionKey) {
  return buildPeriodCacheKey(KIND_PERFORMANCE, startDate, endDate, versionKey, {});
}

function modoAllCacheKey(startDate, endDate, versionKey, settings) {
  return buildPeriodCacheKey(KIND_MODO_ALL, startDate, endDate, versionKey, settings);
}

async function warmProdutosEnrichedCache(startDate, endDate, settings, produtosPeriodo) {
  if (!produtosPeriodo?.length || isPeriodCacheDisabled()) return;
  const versions = await fetchDataVersions();
  const key = produtosEnrichedCacheKey(startDate, endDate, versions.versionKey, settings);
  if (await getPeriodCacheEntry(key)) return;

  const enriched = await enrichProdutosPeriodoParaPainel(
    produtosPeriodo,
    startDate,
    endDate,
    { settings },
  );
  setPeriodCacheEntry(key, enriched, { kind: KIND_PRODUTOS_ENRICHED, fromWarm: true });
}

/**
 * Painel completo por período — substitui periodoPainelCache com invalidação por versão.
 */
export async function getPainelPorPeriodoCached(
  startDate,
  endDate,
  settings = {},
  {
    includeProdutos = true,
    forceGranular = false,
    bypassCache = false,
  } = {},
) {
  if (!startDate || !endDate) return null;

  const versions = await resolveVersions(bypassCache);
  const key = painelCacheKey(startDate, endDate, versions.versionKey, settings);

  if (!bypassCache) {
    const cached = await getPeriodCacheEntry(key);
    if (cached) {
      return { ...cached, _fromCache: true };
    }
  }

  const painel = await getDashboardPainelPorPeriodo(startDate, endDate, settings, {
    includeProdutos,
    forceGranular,
  });

  const payload = {
    kpisFromSumario: painel.kpisFromSumario,
    perdas: painel.perdas,
    subIds: painel.subIds,
    produtosPeriodo: painel.produtosPeriodo,
    dailyBreakdown: painel.dailyBreakdown,
    metaGastoResumo: painel.metaGastoResumo,
    _source: painel._source,
  };

  setPeriodCacheEntry(key, payload, { kind: KIND_PAINEL, versionKey: versions.versionKey });

  if (includeProdutos && painel.produtosPeriodo?.length) {
    void warmProdutosEnrichedCache(startDate, endDate, settings, painel.produtosPeriodo);
  }

  return { ...payload, _fromCache: false };
}

/**
 * Produtos Shopee enriquecidos (produto_daily + cadastro + clique_daily + meta).
 */
export async function getShopeeProdutosEnrichedCached(
  startDate,
  endDate,
  settings = {},
  { bypassCache = false } = {},
) {
  if (!startDate || !endDate) return { produtos: [], _fromCache: false };

  const versions = await resolveVersions(bypassCache);
  const key = produtosEnrichedCacheKey(startDate, endDate, versions.versionKey, settings);

  if (!bypassCache) {
    const cached = await getPeriodCacheEntry(key);
    if (cached) {
      return { produtos: cached, _fromCache: true };
    }
  }

  const produtosPeriodo = await getProdutosByPeriod(startDate, endDate);
  const enriched = await enrichProdutosPeriodoParaPainel(
    produtosPeriodo,
    startDate,
    endDate,
    { settings },
  );

  setPeriodCacheEntry(key, enriched, { kind: KIND_PRODUTOS_ENRICHED, versionKey: versions.versionKey });
  return { produtos: enriched, _fromCache: false };
}

/** KPIs do painel já em cache (2 reads de versão + 0 de dados). */
export async function getPainelKpisFromSessionCache(startDate, endDate, settings = {}, { bypassCache = false } = {}) {
  if (bypassCache || isPeriodCacheDisabled()) return null;
  const versions = await fetchDataVersions();
  const key = painelCacheKey(startDate, endDate, versions.versionKey, settings);
  const cached = await getPeriodCacheEntry(key);
  return cached?.kpisFromSumario ?? null;
}

/**
 * Bundle Performance (produtos raw + subids + kpis) — reutiliza painel quando possível.
 */
export async function getPerformanceBundleCached(
  startDate,
  endDate,
  settings = {},
  { bypassCache = false, topN = 200 } = {},
) {
  if (!startDate || !endDate) {
    return { produtos: [], subIds: [], kpis: null, _fromCache: false };
  }

  const versions = await resolveVersions(bypassCache);
  const perfKey = performanceCacheKey(startDate, endDate, versions.versionKey);

  if (!bypassCache) {
    const cached = await getPeriodCacheEntry(perfKey);
    if (cached) {
      return { ...cached, _fromCache: true };
    }
  }

  const painelKey = painelCacheKey(startDate, endDate, versions.versionKey, settings);
  const painelCached = !bypassCache ? await getPeriodCacheEntry(painelKey) : null;

  if (painelCached?.kpisFromSumario && painelCached?.subIds) {
    let produtos = painelCached.produtosPeriodo || [];
    if (topN > 0 && produtos.length > topN) produtos = produtos.slice(0, topN);
    const bundle = {
      produtos,
      subIds: painelCached.subIds.slice(0, 100),
      kpis: painelCached.kpisFromSumario,
    };
    setPeriodCacheEntry(perfKey, bundle, { kind: KIND_PERFORMANCE, versionKey: versions.versionKey });
    return { ...bundle, _fromCache: true, _fromPainel: true };
  }

  const [produtos, subIds, kpis] = await Promise.all([
    getProdutosByPeriod(startDate, endDate, { topN }),
    getSubIdsByPeriod(startDate, endDate, { enrichMeta: false }),
    getDashboardKPIsByPeriod(startDate, endDate, settings),
  ]);

  const bundle = {
    produtos,
    subIds: subIds.slice(0, 100),
    kpis,
  };
  setPeriodCacheEntry(perfKey, bundle, { kind: KIND_PERFORMANCE, versionKey: versions.versionKey });
  return { ...bundle, _fromCache: false };
}

/** Preset "all" — cache por versão (substitui modoAllCache TTL-only). */
export async function getModoAllPanelCached(settings = {}, { bypassCache = false } = {}) {
  const { startDate, endDate } = calcularRangeModoAll();
  const versions = await resolveVersions(bypassCache);
  const key = modoAllCacheKey(startDate, endDate, versions.versionKey, settings);

  if (!bypassCache) {
    const cached = await getPeriodCacheEntry(key);
    if (cached?.panelData) {
      return { panelData: cached.panelData, _fromCache: true };
    }
  }

  const panelData = await getDashboardPanelModoAll(settings);
  setPeriodCacheEntry(key, { panelData }, { kind: KIND_MODO_ALL, versionKey: versions.versionKey });
  return { panelData, _fromCache: false };
}

export function painelCacheEstaCompleto(kpis) {
  return painelKpisTemDados(kpis);
}

/**
 * Ponto de entrada unico da alimentacao diaria do dashboard.
 * Importe daqui: import { ... } from "@/daily-feed"
 */

// Calculo (formulas, KPIs, PromosApp)
export * from "./calc/financeiroMetrics.js";
export * from "./calc/productMetrics.js";
export * from "./calc/subIdIntegrity.js";
export * from "./calc/monthlyBucketPanel.js";

// Leitura Firestore + sync
export * from "./feed/metricsRepository.js";
export * from "./feed/subIdHybridBundle.js";
export * from "./feed/periodDataCache.js";

// Enriquecimento (Meta/Pin, produtos)
export * from "./enrichment/adsPeriodSpend.js";
export * from "./enrichment/produtoPeriodo.js";

// Politica de sync automatico
export * from "./sync/syncPolicy.js";

// Janela frio/quente
export * from "./utils/coldHotRange.js";

// Cache
export * from "./cache/metaAdsDailyCache.js";
export * from "./cache/dataVersions.js";
export * from "./cache/periodSessionCache.js";
export * from "./cache/periodoPainelCache.js";
export * from "./cache/modoAllCache.js";

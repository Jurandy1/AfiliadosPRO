/**
 * forceCacheReset.js
 * Limpa TODOS os caches do app sem precisar limpar o navegador.
 * Chame ao clicar em "Atualizar dados" ou quando o usuário reportar dados velhos.
 */
import { invalidatePeriodSessionCache } from "./periodSessionCache";
import { invalidateDataVersionsCache } from "./dataVersions";
import { invalidateMetaAdsDailyCache } from "./metaAdsDailyCache";
import { invalidateDailyRangeCache } from "./dailyRangeCache";
import { invalidarModoAllCache } from "./modoAllCache";
import { invalidarPeriodoPainelCache } from "./periodoPainelCache";

export async function forceFullCacheReset() {
  // 1. Limpa todos os caches em memória
  invalidatePeriodSessionCache();
  invalidateDataVersionsCache();
  invalidateMetaAdsDailyCache(0);
  invalidateDailyRangeCache();
  invalidarModoAllCache();
  invalidarPeriodoPainelCache();

  // 2. Limpa localStorage de chaves do app
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("afilia:")) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch {}

  console.log("[Cache] Reset completo executado");
}

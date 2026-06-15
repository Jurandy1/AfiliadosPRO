/**
 * Cache TTL (5 min) para AlertasBell — evita onSnapshot em toda navegação.
 * Cache em memória para o sino de alertas (AlertasBell).
 */

import { isPeriodCacheDisabled } from "../../dashboard/cache/periodSessionCache";
import { getAlertasGarimpoRecentes } from "../repositories/garimpoRepository";

const TTL_MS = 5 * 60 * 1000;

let alertasCache = null;
let alertasCacheTs = 0;

export function peekAlertasBellCache() {
  if (isPeriodCacheDisabled()) return null;
  if (alertasCache && Date.now() - alertasCacheTs < TTL_MS) return alertasCache;
  return null;
}

/** Hidrata cache a partir de outra fonte (ex.: bundle Garimpo). */
export function seedAlertasBellCache(alertas) {
  if (isPeriodCacheDisabled() || !Array.isArray(alertas)) return;
  alertasCache = alertas;
  alertasCacheTs = Date.now();
}

export function invalidateAlertasBellCache() {
  alertasCache = null;
  alertasCacheTs = 0;
}

export function patchAlertasBellLocal(id, patch) {
  if (!alertasCache) return;
  if (patch.arquivado) {
    alertasCache = alertasCache.filter((a) => a.id !== id);
    return;
  }
  alertasCache = alertasCache.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

/**
 * @returns {Promise<{ alertas: object[], _fromCache?: boolean }>}
 */
export async function getAlertasBellCached({ force = false, limitN = 40 } = {}) {
  const cached = peekAlertasBellCache();
  if (!force && cached) return { alertas: cached, _fromCache: true };

  const alertas = await getAlertasGarimpoRecentes(limitN);
  if (!isPeriodCacheDisabled()) {
    alertasCache = alertas;
    alertasCacheTs = Date.now();
  }
  return { alertas, _fromCache: false };
}

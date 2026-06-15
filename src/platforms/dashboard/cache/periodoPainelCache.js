const KEY_PREFIX = "afilia:periodo_painel_v2:";
const LEGACY_PREFIXES = ["afilia:periodo_painel:"];

export function invalidarPeriodoPainelCache() {
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX) || LEGACY_PREFIXES.some((p) => k?.startsWith(p))) {
        keys.push(k);
      }
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Dias inclusivos entre duas datas ISO (BRT). */
export function diasInclusivosNoPeriodo(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const a = Date.parse(`${startDate}T12:00:00-03:00`);
  const b = Date.parse(`${endDate}T12:00:00-03:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(Math.round((b - a) / 86400000)) + 1;
}

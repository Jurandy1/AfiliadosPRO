const KEY = "afilia:modo_all_cache";
const KEY_REFRESH = "afilia:modo_all_refresh_ts";
const TTL_MS = 5 * 60 * 1000; // 5 min

export function invalidarModoAllCache() {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(KEY_REFRESH);
  } catch { /* ignore */ }
}

export function registrarModoAllRefresh() {
  try {
    window.localStorage.setItem(KEY_REFRESH, String(Date.now()));
  } catch { /* ignore */ }
}

export function isModoAllCacheValido() {
  try {
    const ts = Number(window.localStorage.getItem(KEY_REFRESH) || 0);
    return ts > 0 && Date.now() - ts < TTL_MS;
  } catch { return false; }
}

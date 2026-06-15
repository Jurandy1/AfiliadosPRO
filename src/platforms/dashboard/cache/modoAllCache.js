const KEY = "afilia:modo_all_cache";
const KEY_REFRESH = "afilia:modo_all_refresh_ts";

export function invalidarModoAllCache() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function registrarModoAllRefresh() {
  try {
    window.localStorage.setItem(KEY_REFRESH, String(Date.now()));
  } catch {
    /* ignore */
  }
}

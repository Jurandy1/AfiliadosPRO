const STORAGE_KEY = "afilia:powersuite";

export const DEFAULT_SEARCH_PARAMS = {
  keyword: "",
  listType: "1",
  sortType: "5",
  isAMSOffer: true,
  isKeySeller: false,
  shopType: { mall: true, star: true, starPlus: true },
  minCommission: 5,
};

function defaultApiConfig() {
  return {
    affiliateGraphqlUrl: import.meta.env.VITE_AFFILIATE_GRAPHQL_URL || "",
    backfillSecret: import.meta.env.VITE_BACKFILL_SECRET || "",
  };
}

export function readPowersuiteState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const fromEnv = defaultApiConfig();
    const saved = parsed.apiConfig || {};
    // Env (Vercel/.env) manda na URL/secret — evita URL antiga presa no localStorage
    return {
      apiConfig: {
        ...saved,
        affiliateGraphqlUrl: fromEnv.affiliateGraphqlUrl || saved.affiliateGraphqlUrl || "",
        backfillSecret: fromEnv.backfillSecret || saved.backfillSecret || "",
      },
      searchParams: { ...DEFAULT_SEARCH_PARAMS, ...(parsed.searchParams || {}) },
    };
  } catch {
    return {
      apiConfig: defaultApiConfig(),
      searchParams: { ...DEFAULT_SEARCH_PARAMS },
    };
  }
}

export function writePowersuiteState(patch) {
  const current = readPowersuiteState();
  const next = {
    ...current,
    ...patch,
    apiConfig: patch.apiConfig ? { ...current.apiConfig, ...patch.apiConfig } : current.apiConfig,
    searchParams: patch.searchParams ? { ...current.searchParams, ...patch.searchParams } : current.searchParams,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiConfig: next.apiConfig,
    searchParams: next.searchParams,
  }));
  window.dispatchEvent(new CustomEvent("afilia:powersuite-update", { detail: next }));
  return next;
}

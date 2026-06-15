export const SUBID_COL_KEYS = [
  "comissoes",
  "gasto",
  "lucro",
  "roi",
  "faturamento",
  "ticket",
  "total_vendas",
  "vendas_diretas",
  "vendas_indiretas",
  "qtd_itens",
  "cliques_anuncio",
  "cliques_shopee",
  "batimento",
];

export const SUBID_COL_LABELS = {
  comissoes: "Comissão",
  gasto: "Gasto",
  lucro: "Lucro",
  roi: "ROI",
  faturamento: "Faturamento",
  ticket: "Ticket",
  total_vendas: "Vendas",
  vendas_diretas: "Diretas",
  vendas_indiretas: "Indiretas",
  qtd_itens: "Itens",
  cliques_anuncio: "Cliques Ads",
  cliques_shopee: "Cliques Shopee",
  batimento: "% Batimento",
};

export const SUBID_COL_DEFAULTS = Object.fromEntries(SUBID_COL_KEYS.map((k) => [k, true]));

const STORAGE_DESKTOP = "afilia:subid_cols";
const STORAGE_MOBILE = "afilia:subid_cols_mobile";

export function subIdColumnStorageKey(isMobile = false) {
  return isMobile ? STORAGE_MOBILE : STORAGE_DESKTOP;
}

export function readSubIdColumnPrefs(isMobile = false) {
  const defaults = isMobile ? applySubIdPreset("essencial") : { ...SUBID_COL_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(subIdColumnStorageKey(isMobile));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...defaults };
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function subIdColumnPresets() {
  const none = Object.fromEntries(SUBID_COL_KEYS.map((k) => [k, false]));
  return {
    todos: { ...SUBID_COL_DEFAULTS },
    essencial: {
      ...none,
      comissoes: true,
      gasto: true,
      lucro: true,
      roi: true,
      faturamento: true,
      total_vendas: true,
      cliques_anuncio: true,
      cliques_shopee: true,
      batimento: true,
    },
    financeiro: {
      ...none,
      comissoes: true,
      gasto: true,
      lucro: true,
      roi: true,
      faturamento: true,
      ticket: true,
      total_vendas: true,
    },
    performance: {
      ...none,
      comissoes: true,
      gasto: true,
      roi: true,
      total_vendas: true,
      cliques_anuncio: true,
      cliques_shopee: true,
      batimento: true,
    },
  };
}

export function applySubIdPreset(preset) {
  const presets = subIdColumnPresets();
  return presets[preset] || presets.essencial;
}

export function subIdVisibleColCount(subCols) {
  return 1 + SUBID_COL_KEYS.filter((k) => subCols?.[k]).length;
}

export function subIdTableMinWidth(subCols) {
  const widths = {
    comissoes: 84,
    gasto: 76,
    lucro: 76,
    roi: 68,
    faturamento: 84,
    ticket: 76,
    total_vendas: 68,
    vendas_diretas: 68,
    vendas_indiretas: 72,
    qtd_itens: 64,
    cliques_anuncio: 88,
    cliques_shopee: 88,
    batimento: 72,
  };
  let w = 108;
  for (const k of SUBID_COL_KEYS) {
    if (subCols?.[k]) w += widths[k] || 72;
  }
  return w;
}

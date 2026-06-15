import { parseBRL } from "../../../utils/numbers";

const STORAGE_KEY = "afilia:backup_garimpo_settings";

/** Preço em R$ — aceita number, "99,90", "R$ 99,90", etc. */
export function parsePrecoGarimpo(val) {
  return parseBRL(val);
}

export const DEFAULT_BACKUP_GARIMPO_SETTINGS = {
  /** Máx. % acima do preço (R$) do produto principal */
  precoToleranciaAcimaPct: 15,
  /** Máx. % abaixo do preço (R$) do produto principal */
  precoToleranciaAbaixoPct: 25,
};

export function readBackupGarimpoSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      precoToleranciaAcimaPct: clampPct(parsed.precoToleranciaAcimaPct, DEFAULT_BACKUP_GARIMPO_SETTINGS.precoToleranciaAcimaPct),
      precoToleranciaAbaixoPct: clampPct(parsed.precoToleranciaAbaixoPct, DEFAULT_BACKUP_GARIMPO_SETTINGS.precoToleranciaAbaixoPct),
    };
  } catch {
    return { ...DEFAULT_BACKUP_GARIMPO_SETTINGS };
  }
}

export function writeBackupGarimpoSettings(settings) {
  const next = {
    precoToleranciaAcimaPct: clampPct(settings?.precoToleranciaAcimaPct, DEFAULT_BACKUP_GARIMPO_SETTINGS.precoToleranciaAcimaPct),
    precoToleranciaAbaixoPct: clampPct(settings?.precoToleranciaAbaixoPct, DEFAULT_BACKUP_GARIMPO_SETTINGS.precoToleranciaAbaixoPct),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("afilia:backup-garimpo-settings"));
  return next;
}

function clampPct(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Faixa de preço em R$ com base no produto principal. */
export function calcFaixaPrecoGarimpo(precoPrincipal, settings = readBackupGarimpoSettings()) {
  const base = parsePrecoGarimpo(precoPrincipal);
  if (!base || base <= 0) return null;
  const acima = Number(settings.precoToleranciaAcimaPct) || 0;
  const abaixo = Number(settings.precoToleranciaAbaixoPct) || 0;
  return {
    min: base * (1 - abaixo / 100),
    max: base * (1 + acima / 100),
    precoPrincipal: base,
  };
}

export function precoGarimpoDentroFaixa(precoCandidato, precoPrincipal, settings = readBackupGarimpoSettings()) {
  const faixa = calcFaixaPrecoGarimpo(precoPrincipal, settings);
  if (!faixa) return true;
  const preco = parsePrecoGarimpo(precoCandidato);
  if (!preco || preco <= 0) return false;
  return preco >= faixa.min && preco <= faixa.max;
}

/** Extrai preço numérico de uma oferta, tolerando múltiplos formatos. */
function extrairPrecoOferta(oferta) {
  if (!oferta) return 0;
  const candidatos = [
    oferta.priceMin,
    oferta.price_min,
    oferta.priceMax,
    oferta.price_max,
    oferta.productPriceMin,
    oferta.productPriceMax,
    oferta.preco,
    oferta.preco_min,
    oferta.price,
  ];
  for (const c of candidatos) {
    if (c == null) continue;
    if (typeof c === "object" && c.value != null) {
      const v = Number(c.value);
      if (Number.isFinite(v) && v > 0) return v;
      continue;
    }
    const v = Number(c);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

export function filtrarOfertasGarimpoPorPreco(ofertas, precoPrincipal, settings = readBackupGarimpoSettings()) {
  return (ofertas || []).filter((o) => precoGarimpoDentroFaixa(
    extrairPrecoOferta(o),
    precoPrincipal,
    settings,
  ));
}

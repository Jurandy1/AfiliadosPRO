/**
 * SubID unificado (Meta deriveSubId + Shopee utm + imports).
 * Use sempre esta função para cruzar comissão Shopee e gasto Meta/Pin.
 */

function firstNonEmptyUtm(raw) {
  if (Array.isArray(raw)) {
    return raw.find((v) => v && String(v).trim()) || "";
  }
  if (typeof raw === "string" && raw.includes(",")) {
    return raw.split(",").find((v) => v && v.trim()) || "";
  }
  return raw;
}

/**
 * @param {string} name Nome do anúncio ou utm_content
 * @returns {string}
 */
export function normalizeSubId(name) {
  let raw = firstNonEmptyUtm(name);
  raw = String(raw || "").trim();
  if (!raw) return "";

  const byLabel = raw.match(/(?:sub[\s_-]*id|sid)\s*[:=-]?\s*([A-Za-z0-9_-]{2,80})/i);
  if (byLabel?.[1]) {
    return byLabel[1].replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "").trim().toLowerCase().slice(0, 50);
  }

  const cut = raw.split(/[\|\u2013\u2014\-\/\(\)\[\]:]/)[0] || raw;
  const token = (cut.trim().split(/\s+/)[0] || cut).trim();
  const cleaned = token.replace(/[^A-Za-z0-9_-]/g, "").replace(/-/g, "").trim().toLowerCase();
  if (cleaned) return cleaned.slice(0, 50);

  return raw.replace(/-/g, "").trim().toLowerCase().slice(0, 50);
}

/** Alias explícito para utm_content da Shopee (mesma regra). */
export function normalizeShopeeSubId(raw) {
  return normalizeSubId(raw);
}

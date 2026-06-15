/** IDs de meta_ads_daily usam sufixo "_YYYY-MM-DD"; meta_ads usa só o adId. */
export function stripAdDateSuffix(id) {
  return String(id || "").replace(/_\d{4}-\d{2}-\d{2}$/, "");
}

/** Um ID canônico por anúncio (preferindo adId sem sufixo de data). */
export function dedupeAdIds(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of ids || []) {
    const id = String(raw || "").trim();
    if (!id) continue;
    const base = stripAdDateSuffix(id);
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(/_\d{4}-\d{2}-\d{2}$/.test(id) ? base : id);
  }
  return out;
}

export function countUniqueLinkedAds(metaAdIds = [], pinterestAdIds = []) {
  return dedupeAdIds(metaAdIds).length + dedupeAdIds(pinterestAdIds).length;
}

/** IDs salvos que existem no catálogo importado (para pré-seleção no modal). */
export function matchAdIdsToCatalog(catalogIds, savedIds) {
  const catalogBases = new Map(
    (catalogIds || []).map((id) => [stripAdDateSuffix(id), id]),
  );
  const matched = new Set();
  for (const raw of savedIds || []) {
    const base = stripAdDateSuffix(raw);
    const hit = catalogBases.get(base);
    if (hit) matched.add(hit);
  }
  return matched;
}

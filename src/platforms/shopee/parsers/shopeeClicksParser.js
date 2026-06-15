import { buildColumnIndex, findColumn } from "../../../utils/columnNormalizer";
import { normalizeSubId } from "../../../utils/normalizeSubId";

/**
 * Replica exata do parseShopeeClicksRows do dashboard_completo.py.
 * Usa normalização de colunas para detectar sub_id, referenciador, etc.
 */
export function parseShopeeClicksRows(rows) {
  if (!rows || rows.length === 0) {
    return { subIdMap: {}, byReferrer: {}, byDate: {}, byDateSub: {}, processed: 0, colunas: [] };
  }

  const colIdx = buildColumnIndex(rows[0]);

  const COL_SUB = findColumn(colIdx, "sub_id", "sub");
  const COL_REF = findColumn(colIdx, "referenciador", "referrer", "canal");
  const COL_TEMPO = findColumn(colIdx, "tempo_dos_cliques", "data", "date", "horario");

  const subIdMap = {};
  const byReferrer = {};
  const byDate = {};
  /** Chave `${YYYY-MM-DD}__${sub_id_norm}` → contagem de cliques no dia. */
  const byDateSub = {};
  let processed = 0;

  for (const row of rows) {
    const rawSubId = COL_SUB ? String(row[COL_SUB] || "").trim() : "";
    const referrer = COL_REF ? String(row[COL_REF] || "").trim() : "";
    const tempo = COL_TEMPO ? String(row[COL_TEMPO] || "").trim() : "";
    const dateStr = tempo ? tempo.substring(0, 10) : "";

    if (!rawSubId && !referrer) continue;

    const cleanSubId = normalizeSubId(rawSubId);
    if (cleanSubId) {
      if (!subIdMap[cleanSubId]) {
        const displaySubId = rawSubId.replace(/-/g, "").trim();
        subIdMap[cleanSubId] = {
          sub_id: displaySubId,
          sub_id_norm: cleanSubId,
          cliques: 0,
          referrers: {},
        };
      }
      subIdMap[cleanSubId].cliques++;
      if (referrer) {
        subIdMap[cleanSubId].referrers[referrer] =
          (subIdMap[cleanSubId].referrers[referrer] || 0) + 1;
      }
    }

    if (referrer) byReferrer[referrer] = (byReferrer[referrer] || 0) + 1;
    if (dateStr) byDate[dateStr] = (byDate[dateStr] || 0) + 1;
    if (cleanSubId && dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const dayKey = `${dateStr}__${cleanSubId}`;
      byDateSub[dayKey] = (byDateSub[dayKey] || 0) + 1;
    }
    processed++;
  }

  return { subIdMap, byReferrer, byDate, byDateSub, processed, colunas: Object.keys(rows[0] || {}) };
}

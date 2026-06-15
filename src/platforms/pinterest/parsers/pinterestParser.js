import { buildColumnIndex, findColumn, normalizeColumnName } from "../../../utils/columnNormalizer";
import { normalizeSubId } from "../../../utils/normalizeSubId";

/**
 * Replica da lógica do dashboard_completo.py para Pinterest.
 * Usa normalização de colunas.
 */
export function parsePinterestRows(rows) {
  if (!rows || rows.length === 0) return [];

  const colIdx = buildColumnIndex(rows[0]);

  const COL_NOME = findColumn(colIdx, "ad_name", "nome_do_anuncio", "nome");
  const COL_GASTO = findColumn(colIdx, "spend", "gasto");
  const COL_CLIQUES = findColumn(colIdx, "pin_clicks", "cliques");
  const COL_STATUS = findColumn(colIdx, "ad_entity_status", "status");
  const COL_DATA = findColumn(colIdx, "date", "data");
  const COL_AD_ID = findColumn(colIdx, "ad_id");
  const COL_ORG_PIN = findColumn(colIdx, "organic_pin_id");

  const parsed = [];

  for (const row of rows) {
    const adName = COL_NOME ? String(row[COL_NOME] || "").trim() : "";
    if (!adName) continue;

    const spend = COL_GASTO ? parsePinterestValue(row[COL_GASTO]) : 0;
    const pinClicks = COL_CLIQUES
      ? parseInt(String(row[COL_CLIQUES] || "0").replace(/[^0-9]/g, ""), 10) || 0
      : 0;
    const rawStatus = COL_STATUS ? String(row[COL_STATUS] || "").trim() : "";
    const statusNorm = normalizeColumnName(rawStatus);

    let status = "Pausado";
    if (statusNorm.includes("active") || statusNorm.includes("ativo")) {
      status = "Ativo";
    }

    parsed.push({
      adId: COL_AD_ID ? String(row[COL_AD_ID] || "").trim() : "",
      adName,
      subid: normalizeSubId(adName),
      date: COL_DATA ? String(row[COL_DATA] || "").trim() : "",
      status,
      spend: Math.round(spend * 100) / 100,
      pinClicks,
      organicPinId: COL_ORG_PIN ? String(row[COL_ORG_PIN] || "").trim() : "",
      cpc: pinClicks > 0 ? Math.round((spend / pinClicks) * 100) / 100 : 0,
    });
  }

  return parsed;
}

function parsePinterestValue(val) {
  if (val == null || val === "") return 0;
  let s = String(val).trim().replace("R$", "").replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  return parseFloat(s) || 0;
}

export function parsePinterestRow(row) {
  const results = parsePinterestRows([row]);
  return results[0] || null;
}

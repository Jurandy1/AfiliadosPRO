import { fetchMetaAdsDailySnapshot } from "../cache/metaAdsDailyCache";
import { normalizeSubId } from "../../../utils/normalizeSubId";

export function toISODateStr(d) {
  if (typeof d === "string" && d.length === 10) return d;
  const dt = new Date(d);
  const ano = dt.getFullYear();
  const mes = String(dt.getMonth() + 1).padStart(2, "0");
  const dia = String(dt.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function calcOverlapRatio(filterStart, filterEnd, itemStart, itemEnd) {
  if (!filterStart || !filterEnd || !itemStart || !itemEnd) return 0;
  const fStart = new Date(`${filterStart}T00:00:00`).getTime();
  const fEnd = new Date(`${filterEnd}T23:59:59`).getTime();
  const iStart = new Date(`${itemStart}T00:00:00`).getTime();
  const iEnd = new Date(`${itemEnd}T23:59:59`).getTime();
  if (!Number.isFinite(fStart) || !Number.isFinite(fEnd) || !Number.isFinite(iStart) || !Number.isFinite(iEnd)) return 0;
  if (fEnd < iStart || fStart > iEnd) return 0;
  const overlapStart = Math.max(fStart, iStart);
  const overlapEnd = Math.min(fEnd, iEnd);
  const overlapMs = overlapEnd - overlapStart;
  const itemTotalMs = iEnd - iStart;
  if (itemTotalMs <= 0) return 0;
  return Math.max(0, Math.min(1, overlapMs / itemTotalMs));
}

function aggregateMetaFromDailySnap(snap) {
  const metaBySub = {};
  if (!snap?.forEach) return metaBySub;
  snap.forEach((docSnap) => {
    const m = docSnap.data() || {};
    const key = normalizeSubId(m.subid || m.nomeAnuncio || "");
    if (!key) return;
    if (!metaBySub[key]) metaBySub[key] = { ids: [], spend: 0, cliques_anuncio: 0 };
    if (m.id || docSnap.id) metaBySub[key].ids.push(m.id || docSnap.id);
    metaBySub[key].spend += Number(m.valorUsado || 0);
    metaBySub[key].cliques_anuncio += Number(m.cliquesTotal || 0);
  });
  return metaBySub;
}

function aggregateMetaFromImportFallback(startStr, endStr, metaAdsFallback = []) {
  const metaBySub = {};
  (metaAdsFallback || []).forEach((m) => {
    const key = normalizeSubId(m.subid || m.nomeAnuncio || "");
    if (!key) return;
    const itemStart = m.dataInicio || m.date || null;
    const itemEnd = m.dataFim || m.date || itemStart;
    const ratio = calcOverlapRatio(startStr, endStr, itemStart, itemEnd);
    if (ratio <= 0) return;
    if (!metaBySub[key]) metaBySub[key] = { ids: [], spend: 0, cliques_anuncio: 0 };
    if (m.id) metaBySub[key].ids.push(m.id);
    metaBySub[key].spend += (m.valorUsado || 0) * ratio;
    metaBySub[key].cliques_anuncio += (m.resultados || 0) * ratio;
  });
  return metaBySub;
}

/** Gasto Meta por SubID no período — prioriza meta_ads_daily (cache compartilhado com KPI/SubID). */
export async function buildMetaBySubForPeriod(
  startDate,
  endDate,
  metaAdsFallback = [],
  { metaDailySnap = null } = {},
) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const snap = metaDailySnap != null
    ? metaDailySnap
    : await fetchMetaAdsDailySnapshot(startStr, endStr);

  const fromDaily = aggregateMetaFromDailySnap(snap);
  if (Object.keys(fromDaily).length > 0) return fromDaily;
  return aggregateMetaFromImportFallback(startStr, endStr, metaAdsFallback);
}

/** Gasto Pinterest por SubID no período (overlap proporcional ao intervalo do import). */
export function buildPinBySubForPeriod(startDate, endDate, pinterestAds = []) {
  const startStr = toISODateStr(startDate);
  const endStr = toISODateStr(endDate);
  const pinBySub = {};

  (pinterestAds || []).forEach((p) => {
    const key = normalizeSubId(p.subid || p.adName || "");
    if (!key) return;
    const itemStart = p.dataInicio || p.date || null;
    const itemEnd = p.dataFim || p.date || itemStart;
    const ratio = calcOverlapRatio(startStr, endStr, itemStart, itemEnd);
    if (ratio <= 0) return;
    if (!pinBySub[key]) pinBySub[key] = { ids: [], spend: 0, cliques_anuncio: 0 };
    if (p.id) pinBySub[key].ids.push(p.id);
    pinBySub[key].spend += (p.spend || 0) * ratio;
    pinBySub[key].cliques_anuncio += (p.pinClicks || 0) * ratio;
  });

  return pinBySub;
}

/** Gasto Meta por SubID — import completo (todo período, sem filtro de datas). */
export function buildMetaBySubLifetime(metaAds = []) {
  const acc = {};
  metaAds.forEach((m) => {
    const key = normalizeSubId(m.subid || m.nomeAnuncio || "");
    if (!key) return;
    if (!acc[key]) acc[key] = { ids: [], spend: 0, cliques_anuncio: 0 };
    if (m.id) acc[key].ids.push(m.id);
    acc[key].spend += m.valorUsado || 0;
    acc[key].cliques_anuncio += m.resultados || 0;
  });
  return acc;
}

/** Gasto Pinterest por SubID — import completo (todo período). */
export function buildPinBySubLifetime(pinterestAds = []) {
  const acc = {};
  pinterestAds.forEach((p) => {
    const key = normalizeSubId(p.subid || p.adName || "");
    if (!key) return;
    if (!acc[key]) acc[key] = { ids: [], spend: 0, cliques_anuncio: 0 };
    if (p.id) acc[key].ids.push(p.id);
    acc[key].spend += p.spend || 0;
    acc[key].cliques_anuncio += p.pinClicks || 0;
  });
  return acc;
}

/** Soma gasto Pinterest proporcional ao período (KPIs agregados). */
export function sumPinGastoForPeriod(startDate, endDate, pinterestAds = []) {
  const pinBySub = buildPinBySubForPeriod(startDate, endDate, pinterestAds);
  return Object.values(pinBySub).reduce((s, row) => s + (row.spend || 0), 0);
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(str) {
  if (!str || !ISO_DATE_RE.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidDateRange(start, end) {
  return isValidISODate(start) && isValidISODate(end) && start <= end;
}

/** Exibe YYYY-MM-DD como DD/MM/YYYY (rótulos do dashboard). */
export function formatDateDisplayPT(iso) {
  if (!iso || !ISO_DATE_RE.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Data de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function formatDateBRTYYYYMMDD(date = new Date()) {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return new Date((ms / 1000 - 10800) * 1000).toISOString().split("T")[0];
}

/** Mês corrente em BRT (YYYY-MM). */
export function brtYearMonthToday(date = new Date()) {
  return formatDateBRTYYYYMMDD(date).slice(0, 7);
}

/** Primeiro dia do mês (YYYY-MM-01) a partir de YYYY-MM ou de uma data BRT. */
export function brtFirstDayOfMonth(yearMonthOrDate) {
  if (typeof yearMonthOrDate === "string" && yearMonthOrDate.length === 7) {
    return `${yearMonthOrDate}-01`;
  }
  return `${formatDateBRTYYYYMMDD(yearMonthOrDate).slice(0, 7)}-01`;
}

/** Último dia do mês civil (YYYY-MM-DD). yearMonth = YYYY-MM. */
export function brtLastDayOfMonth(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(day).padStart(2, "0")}`;
}

/** Mês anterior em YYYY-MM (calendário BRT). */
export function brtPreviousYearMonth(yearMonth = brtYearMonthToday()) {
  const [y, m] = yearMonth.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Rótulo curto do mês (ex.: abril/2026). */
export function brtMonthLabelPT(yearMonth = brtYearMonthToday()) {
  const [y, m] = yearMonth.split("-").map(Number);
  const nome = new Date(Date.UTC(y, m - 1, 15)).toLocaleString("pt-BR", { month: "long", timeZone: "UTC" });
  return `${nome}/${y}`;
}

export function brtYesterdayYYYYMMDD(date = new Date()) {
  const hojeStr = formatDateBRTYYYYMMDD(date);
  const [y, m, d] = hojeStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

/** Última data selecionável (API Shopee = até ontem em BRT). */
export function brtMaxDataSelecionavel(date = new Date()) {
  return brtYesterdayYYYYMMDD(date);
}

/** ISO → dd/mm/aaaa para exibição e digitação. */
export function isoToBR(iso) {
  return isValidISODate(iso) ? formatDateDisplayPT(iso) : "";
}

/** Converte dd/mm/aaaa ou yyyy-mm-dd → ISO; null se inválido. */
export function parseBRDateInput(str) {
  const t = String(str || "").trim();
  if (!t) return null;
  if (isValidISODate(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

/** Subtrai N dias de uma data ISO (calendário civil, sem bug de fuso no dia 1). */
export function brtSubtractDays(days, refIso = brtYesterdayYYYYMMDD()) {
  const [y, m, d] = refIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetweenDatesBRT(dateStr, refStr) {
  const a = Date.parse(`${dateStr}T12:00:00-03:00`);
  const b = Date.parse(`${refStr}T12:00:00-03:00`);
  return Math.round((b - a) / 86400000);
}

/** Hoje, ontem ou anteontem (BRT). */
export function isDiaRecenteBRT(dateStr, ref = formatDateBRTYYYYMMDD()) {
  if (!isValidISODate(dateStr)) return false;
  const diff = daysBetweenDatesBRT(dateStr, ref);
  return diff >= 0 && diff <= 2;
}

export function daysSinceFirestoreTimestamp(ts) {
  if (!ts?.toDate) return null;
  return (Date.now() - ts.toDate().getTime()) / 86400000;
}

export function formatFirestoreDate(ts, locale = "pt-BR") {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(locale);
}

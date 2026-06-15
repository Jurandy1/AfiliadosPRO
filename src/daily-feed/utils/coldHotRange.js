import { formatDateBRTYYYYMMDD } from "../../utils/dates";

export const HOT_WINDOW_DAYS = 2;

export function addDaysBRT(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function splitColdHot(startStr, endStr) {
  const hoje = formatDateBRTYYYYMMDD();
  const hotStart = addDaysBRT(hoje, -HOT_WINDOW_DAYS);
  if (endStr < hotStart) return { cold: [startStr, endStr], hot: null };
  if (startStr >= hotStart) return { cold: null, hot: [startStr, endStr] };
  return { cold: [startStr, addDaysBRT(hotStart, -1)], hot: [hotStart, endStr] };
}

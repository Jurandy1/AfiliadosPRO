import {
  brtYesterdayYYYYMMDD,
  brtYearMonthToday,
  brtFirstDayOfMonth,
  brtLastDayOfMonth,
  brtPreviousYearMonth,
  brtSubtractDays,
  brtMaxDataSelecionavel,
  formatDateDisplayPT,
  isValidDateRange,
} from "./dates";

/** Shopee conversionReport não traz o dia corrente — último dia útil = ontem (BRT). */
function shopeeEndDateStr() {
  return brtYesterdayYYYYMMDD();
}

const KEY_PERIODO = "afilia:periodoFiltro";
const KEY_RANGE = "afilia:rangeCustomApplied";
const KEY_USER_CHOSE_ALL = "afilia:periodo_user_chose_all";

/** Início fixo para agregados “Todo período” (shopee_daily / subid_daily / produto_daily). */
export const MODO_ALL_START_DATE = "2020-01-01";

export function calcularRangeModoAll() {
  return { startDate: MODO_ALL_START_DATE, endDate: shopeeEndDateStr() };
}

/** Período efetivo para queries: presets normais ou janela completa no modo all. */
export function resolverRangeParaDados(periodoFiltro, rangeCustomApplied) {
  if (periodoFiltro === "all") return calcularRangeModoAll();
  const range = calcularRangePeriodo(periodoFiltro, rangeCustomApplied);
  return range || calcularRangeModoAll();
}

export function readPeriodoFiltroStorage() {
  try {
    const raw = localStorage.getItem(KEY_PERIODO);
    let periodoFiltro = raw || "mes_atual";
    if (periodoFiltro === "hoje") {
      periodoFiltro = "ontem";
      try {
        localStorage.setItem(KEY_PERIODO, "ontem");
      } catch {}
    }
    if (periodoFiltro === "all" && localStorage.getItem(KEY_USER_CHOSE_ALL) !== "1") {
      periodoFiltro = "mes_atual";
      try {
        localStorage.setItem(KEY_PERIODO, "mes_atual");
      } catch {}
    }
    const rawRange = localStorage.getItem(KEY_RANGE);
    const parsed = rawRange ? JSON.parse(rawRange) : {};
    return {
      periodoFiltro,
      rangeCustomApplied: {
        start: parsed?.start || "",
        end: parsed?.end || "",
      },
    };
  } catch {
    return { periodoFiltro: "mes_atual", rangeCustomApplied: { start: "", end: "" } };
  }
}

export function writePeriodoFiltroStorage(periodoFiltro, rangeCustomApplied) {
  try {
    localStorage.setItem(KEY_PERIODO, periodoFiltro);
    if (periodoFiltro === "all") {
      localStorage.setItem(KEY_USER_CHOSE_ALL, "1");
    }
    localStorage.setItem(KEY_RANGE, JSON.stringify(rangeCustomApplied || { start: "", end: "" }));
    window.dispatchEvent(new CustomEvent("afilia:periodo-change"));
  } catch {}
}

/** Estado inicial do filtro (localStorage + rascunho custom alinhado). */
export function readInitialPeriodoState() {
  const { periodoFiltro, rangeCustomApplied } = readPeriodoFiltroStorage();
  const draft =
    periodoFiltro === "custom" && rangeCustomApplied.start && rangeCustomApplied.end
      ? { start: rangeCustomApplied.start, end: rangeCustomApplied.end }
      : { start: "", end: "" };
  return {
    periodoFiltro: periodoFiltro || "mes_atual",
    rangeCustomApplied,
    rangeCustomDraft: draft,
  };
}

/** Valida intervalo custom (BRT, até ontem). */
export function validarRangeCustom(start, end) {
  const max = brtMaxDataSelecionavel();
  if (!isValidDateRange(start, end)) {
    return { ok: false, erro: "Informe datas válidas (dd/mm/aaaa). A data inicial deve ser ≤ a final." };
  }
  if (start > max) {
    return { ok: false, erro: `A data inicial não pode ser depois de ${formatDateDisplayPT(max)}.` };
  }
  let endNorm = end;
  if (end > max) endNorm = max;

  // Enforce 90-day limit to prevent massive reads
  const msPerDay = 24 * 60 * 60 * 1000;
  const dStart = new Date(start + "T12:00:00Z");
  const dEnd = new Date(endNorm + "T12:00:00Z");
  const diffDays = Math.round((dEnd - dStart) / msPerDay);
  
  if (diffDays > 90) {
    return { 
      ok: false, 
      erro: "Para intervalos maiores que 90 dias, utilize o filtro 'Todo Período' (que usa dados agregados)." 
    };
  }

  return { ok: true, start, end: endNorm };
}

export function calcularRangePeriodo(periodo, rangeApplied) {
  const ateStr = shopeeEndDateStr();

  if (periodo === "hoje") {
    return calcularRangePeriodo("ontem", rangeApplied);
  }
  if (periodo === "ontem") {
    return { startDate: ateStr, endDate: ateStr };
  }
  if (periodo === "custom") {
    const v = validarRangeCustom(rangeApplied?.start, rangeApplied?.end);
    if (!v.ok) return null;
    return { startDate: v.start, endDate: v.end };
  }
  if (periodo === "7d") {
    return { startDate: brtSubtractDays(6, ateStr), endDate: ateStr };
  }
  if (periodo === "14d") {
    return { startDate: brtSubtractDays(13, ateStr), endDate: ateStr };
  }
  if (periodo === "30d") {
    return { startDate: brtSubtractDays(29, ateStr), endDate: ateStr };
  }
  if (periodo === "mes_atual") {
    const ym = brtYearMonthToday();
    return { startDate: brtFirstDayOfMonth(ym), endDate: ateStr, yearMonth: ym };
  }
  if (periodo === "mes_anterior") {
    const ym = brtPreviousYearMonth();
    return {
      startDate: brtFirstDayOfMonth(ym),
      endDate: brtLastDayOfMonth(ym),
      yearMonth: ym,
    };
  }
  return null;
}

export function labelPeriodoAtivo(periodo, rangeApplied) {
  const range = calcularRangePeriodo(periodo, rangeApplied);
  if (!range) return "Todo período";
  if (range.startDate === range.endDate) return formatDateDisplayPT(range.startDate);
  return `${formatDateDisplayPT(range.startDate)} – ${formatDateDisplayPT(range.endDate)}`;
}

const PERIODO_LABELS = {
  all: "Todo período",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "14d": "Últimos 14 dias",
  "30d": "Últimos 30 dias",
  mes_atual: "Este mês",
  mes_anterior: "Mês anterior",
  custom: "Personalizado",
};

export function labelPeriodoPreset(periodo) {
  return PERIODO_LABELS[periodo] || periodo;
}

export function periodoTemFiltro(periodo) {
  return periodo && periodo !== "all";
}

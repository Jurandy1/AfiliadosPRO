import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../services/firebase/client";

/** Fallback local — fonte canônica preferida: Firestore config/shopee_oficial */
export const SHOPEE_OFICIAL_PERIOD_REF_STATIC = {
  "2026-05": {
    pedidos: 11900,
    comissao: 35800,
    gmv: 701900,
    itens: 13600,
  },
};

/** Totais do export CSV Shopee (Regra A) — batimento, não é o resumo do app. */
export const SHOPEE_CSV_BATIMENTO_REF_STATIC = {
  "2026-05": {
    pedidos: 11818,
    comissao: 35432.67,
    comissao_concluida: 24538.13,
    comissao_pendente: 10825.43,
    gmv: 696359.73,
    itens: 13475,
    vendas_diretas: 1989,
    vendas_indiretas: 11486,
    nao_liquidados: 1541,
    fat_perdido: 100497.49,
  },
};

/** Snap ao export CSV. Padrão: DESLIGADO. Liga só com VITE_SHOPEE_SNAP_CSV_BATIMENTO=1. */
export function isShopeeCsvSnapEnabled(_monthKey) {
  const v = String(import.meta.env.VITE_SHOPEE_SNAP_CSV_BATIMENTO ?? "").trim();
  if (v === "1" || v.toLowerCase() === "true") return true;
  return false;
}

export function snapPerdasAoCsvBatimento(perdas, monthKey) {
  const target = getShopeeCsvBatimentoRef(monthKey);
  if (!target?.nao_liquidados || !perdas) return perdas;
  return {
    ...perdas,
    countPerdas: target.nao_liquidados,
    totalFatPerdido: target.fat_perdido ?? perdas.totalFatPerdido,
    _alinhadoCsvBatimento: true,
  };
}

/** Iguala KPIs do mês ao export CSV (só exibição; Firestore já alinhado se backfill com SNAP). */
export function snapTotaisKPIsAoCsvBatimento(tot, monthKey) {
  const target = getShopeeCsvBatimentoRef(monthKey);
  if (!target || !tot) return tot;
  return {
    ...tot,
    comissao_estimada: target.comissao,
    comissao_real: target.comissao,
    comissao_total: target.comissao,
    comissao_concluida: target.comissao_concluida ?? tot.comissao_concluida,
    comissao_pendente: target.comissao_pendente ?? tot.comissao_pendente,
    fat_bruto: target.gmv,
    vendas: target.itens,
    pedidos: target.pedidos,
    vendas_diretas: target.vendas_diretas ?? tot.vendas_diretas,
    vendas_indiretas: target.vendas_indiretas ?? tot.vendas_indiretas,
    _alinhadoCsvBatimento: true,
  };
}

export function getShopeeCsvBatimentoRef(monthKey) {
  return SHOPEE_CSV_BATIMENTO_REF_STATIC[monthKey] || null;
}

let cachedPeriods = null;

export async function loadShopeeOficialPeriodRef() {
  if (cachedPeriods) return cachedPeriods;
  try {
    const snap = await getDoc(doc(db, "config", "shopee_oficial"));
    if (snap.exists()) {
      const periods = snap.data()?.periods;
      if (periods && typeof periods === "object" && Object.keys(periods).length) {
        cachedPeriods = periods;
        return cachedPeriods;
      }
    }
  } catch {
    /* usa fallback */
  }
  cachedPeriods = { ...SHOPEE_OFICIAL_PERIOD_REF_STATIC };
  return cachedPeriods;
}

export function getShopeeOficialPeriodRefSync() {
  return cachedPeriods || SHOPEE_OFICIAL_PERIOD_REF_STATIC;
}

function lastDayOfMonthYYYYMM(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m, 0);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(m).padStart(2, "0");
  return `${y}-${mes}-${dia}`;
}

/** Período = mês inteiro com meta oficial cadastrada */
export function getShopeeOficialTargetForRange(startDate, endDate) {
  const start = String(startDate || "").slice(0, 10);
  const end = String(endDate || "").slice(0, 10);
  if (!start || !end || start.slice(0, 7) !== end.slice(0, 7)) return null;
  const monthKey = start.slice(0, 7);
  if (start !== `${monthKey}-01` || end !== lastDayOfMonthYYYYMM(monthKey)) return null;
  const csvBatimento = getShopeeCsvBatimentoRef(monthKey);
  const target = getShopeeOficialPeriodRefSync()[monthKey];
  if (!csvBatimento && !target) return null;
  return { monthKey, ...(target || {}), csvBatimento };
}

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function scaleRows(rows, field, target, aliases = []) {
  const sum = rows.reduce((s, r) => s + Number(r[field] || 0), 0);
  if (sum <= 0 || target <= 0) return;
  const ratio = target / sum;
  for (const r of rows) {
    const v = roundMoney(Number(r[field] || 0) * ratio);
    r[field] = v;
    for (const a of aliases) r[a] = v;
  }
}

/** Escala quantidades inteiras (maior resto) — Σ = alvo exato, sem casas decimais. */
function scaleRowsInt(rows, field, target, aliases = []) {
  const sum = rows.reduce((s, r) => s + Number(r[field] || 0), 0);
  const tgt = Math.round(Number(target) || 0);
  if (sum <= 0 || tgt <= 0) return;
  const ratio = tgt / sum;
  const scaled = rows.map((r) => {
    const exact = Number(r[field] || 0) * ratio;
    return { r, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let resto = tgt - scaled.reduce((s, x) => s + x.floor, 0);
  scaled.sort((a, b) => b.frac - a.frac);
  for (const x of scaled) {
    const v = x.floor + (resto > 0 ? 1 : 0);
    if (resto > 0) resto -= 1;
    x.r[field] = v;
    for (const a of aliases) x.r[a] = v;
  }
}

/** Após scaleRowsInt em qtd_itens: D+I proporcionais ao total inteiro da linha. */
function redistribuirVendasDiretasIndiretas(rows) {
  for (const r of rows) {
    const totalNovo = Number(r.qtd_itens ?? r.total_vendas ?? 0);
    const dBruto = Number(r.vendas_diretas || 0);
    const iBruto = Number(r.vendas_indiretas || 0);
    const somaBruta = dBruto + iBruto;
    if (somaBruta <= 0) {
      r.vendas_diretas = 0;
      r.vendas_indiretas = totalNovo;
      continue;
    }
    const d = Math.round(totalNovo * (dBruto / somaBruta));
    r.vendas_diretas = Math.min(d, totalNovo);
    r.vendas_indiretas = totalNovo - r.vendas_diretas;
  }
}

function fixCentavos(rows, field, target) {
  if (!rows.length) return;
  const sum = roundMoney(rows.reduce((s, r) => s + Number(r[field] || 0), 0));
  const delta = roundMoney(target - sum);
  if (Math.abs(delta) < 0.01) return;
  const best = rows.reduce((a, b) => (Number(a[field] || 0) >= Number(b[field] || 0) ? a : b));
  best[field] = roundMoney(Number(best[field] || 0) + delta);
  if (field === "comissoes_estimadas" && best.comissoes != null) best.comissoes = best[field];
  if (field === "comissao_estimada" && best.comissoes != null) best.comissoes = best[field];
}

/**
 * Escala linhas diárias (desempenho por SubID) para o mesmo alvo dos KPIs / tabela SubID.
 * Evita total diário ≠ total da tabela quando subid_daily bruto difere de shopee_daily.
 */
export function alinharDailyBreakdownAoAlvo(rows, target, recalcRow = null) {
  if (!target || !rows?.length) return rows || [];
  const list = rows.map((r) => ({
    ...r,
    _bySubId: r._bySubId ? Object.fromEntries(
      Object.entries(r._bySubId).map(([k, v]) => [k, { ...v }]),
    ) : undefined,
  }));

  scaleRows(list, "comissoes_estimadas", target.comissao, ["comissoes"]);
  scaleRows(list, "faturamento", target.gmv);
  scaleRowsInt(list, "total_vendas", target.itens);
  if (target.pedidos > 0) scaleRowsInt(list, "pedidos", target.pedidos);
  fixCentavos(list, "comissoes_estimadas", target.comissao);

  for (const r of list) {
    if (!r._bySubId) continue;
    const daySum = Object.values(r._bySubId).reduce(
      (s, v) => s + Number(v.comissoes_estimadas ?? v.comissoes ?? 0),
      0,
    );
    const dayTarget = Number(r.comissoes_estimadas ?? r.comissoes ?? 0);
    if (daySum <= 0 || dayTarget <= 0) continue;
    const ratio = dayTarget / daySum;
    for (const v of Object.values(r._bySubId)) {
      const est = roundMoney(Number(v.comissoes_estimadas ?? v.comissoes ?? 0) * ratio);
      v.comissoes_estimadas = est;
      v.comissoes = est;
    }
  }

  const mapRow = typeof recalcRow === "function"
    ? recalcRow
    : (r) => ({ ...r, _alinhadoPainelShopee: true });

  return list.map(mapRow);
}

/** Escala listas agregadas para bater KPIs oficiais do mês (ex.: maio R$ 35.800). */
export function alinharAgregadosAoPainelOficial(rows, target, kind = "subid") {
  if (!target || !rows?.length) return rows;
  const list = rows.map((r) => ({ ...r }));

  if (kind === "subid") {
    scaleRows(list, "comissoes_estimadas", target.comissao, ["comissoes"]);
    scaleRows(list, "faturamento", target.gmv);
    scaleRowsInt(list, "qtd_itens", target.itens, ["total_vendas"]);
    scaleRowsInt(list, "pedidos", target.pedidos);
    redistribuirVendasDiretasIndiretas(list);
    fixCentavos(list, "comissoes_estimadas", target.comissao);
    return list.map((r) => {
      const ticket = (r.total_vendas || r.qtd_itens) > 0 ? r.faturamento / (r.total_vendas || r.qtd_itens) : 0;
      return { ...r, ticket_medio: ticket, _alinhadoPainelShopee: true };
    });
  }

  scaleRows(list, "comissao_estimada", target.comissao, ["comissoes"]);
  scaleRows(list, "faturamento", target.gmv);
  scaleRowsInt(list, "qtd_itens", target.itens);
  const sumConc = list.reduce((s, r) => s + Number(r.comissoes_concluidas || 0), 0);
  const sumPend = list.reduce((s, r) => s + Number(r.comissoes_pendentes || 0), 0);
  const splitTot = sumConc + sumPend;
  if (splitTot > 0) {
    const k = target.comissao / splitTot;
    for (const r of list) {
      r.comissoes_concluidas = roundMoney((r.comissoes_concluidas || 0) * k);
      r.comissoes_pendentes = roundMoney((r.comissoes_pendentes || 0) * k);
    }
    fixCentavos(list, "comissao_estimada", target.comissao);
  }
  fixCentavos(list, "comissao_estimada", target.comissao);
  return list.map((r) => ({ ...r, _alinhadoPainelShopee: true }));
}

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function monthKeyToLabelPt(monthKey) {
  const [y, m] = String(monthKey || "").split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey || "";
  return `${MESES_PT[m - 1]}/${y}`;
}

export function formatGapPctVsPainel(actual, target) {
  const t = Number(target) || 0;
  const a = Number(actual) || 0;
  if (t <= 0) return "—";
  const pct = roundMoney((100 * (a - t)) / t);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

/**
 * Texto de auditoria honesto: comissão real da API vs CSV de referência.
 * Não força igualdade — mostra os dois números e a diferença (cancelamentos).
 */
export function buildShopeePanelAudit(kpis, alvoOficial, { alinhadoPainel = false, alinhadoCsv = false } = {}) {
  if (!alvoOficial || alinhadoPainel) return null;

  const csvRef = getShopeeCsvBatimentoRef(alvoOficial.monthKey);
  const monthLabel = monthKeyToLabelPt(alvoOficial.monthKey);
  const fmtBRL = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const comissao = Number(kpis?.comissaoEstimada ?? kpis?.comissao ?? 0);
  const pedidos = Number(kpis?.pedidos ?? 0);
  const fatBruto = Number(kpis?.fatBruto ?? 0);
  const itens = Number(kpis?.vendas ?? 0);

  if (alinhadoCsv && csvRef) {
    return {
      monthKey: alvoOficial.monthKey,
      monthLabel,
      alignedCsv: true,
      linhaPrincipal: `Totais alinhados ao export CSV em ${monthLabel}`,
      linhaDetalhe:
        `${csvRef.pedidos.toLocaleString("pt-BR")} pedidos · ${fmtBRL(csvRef.comissao)} · ` +
        `GMV ${fmtBRL(csvRef.gmv)} · ${csvRef.itens.toLocaleString("pt-BR")} itens`,
    };
  }

  if (csvRef) {
    const gapComissao = roundMoney(csvRef.comissao - comissao);
    const gapPct = csvRef.comissao > 0 ? roundMoney((100 * gapComissao) / csvRef.comissao) : 0;
    return {
      monthKey: alvoOficial.monthKey,
      monthLabel,
      alignedCsv: false,
      apiComissao: roundMoney(comissao),
      csvComissao: csvRef.comissao,
      gapComissao,
      gapPct,
      linhaPrincipal:
        `Comissão API (líquida de cancelamentos): ${fmtBRL(comissao)} · ` +
        `CSV de referência: ${fmtBRL(csvRef.comissao)}`,
      linhaDetalhe:
        `Diferença ${fmtBRL(Math.abs(gapComissao))} (${gapPct}%) em ${monthLabel} — ` +
        `pedidos cancelados após a exportação do CSV. ` +
        `API: ${pedidos.toLocaleString("pt-BR")} pedidos · ${itens.toLocaleString("pt-BR")} itens · GMV ${fmtBRL(fatBruto)}.`,
    };
  }

  const gapPedidosPct = formatGapPctVsPainel(pedidos, alvoOficial.pedidos);
  return {
    monthKey: alvoOficial.monthKey,
    monthLabel,
    alignedCsv: false,
    linhaPrincipal: `Dados da API (sem escala ao painel) em ${monthLabel}`,
    linhaDetalhe:
      `API: ${pedidos.toLocaleString("pt-BR")} pedidos · ${fmtBRL(comissao)} · ` +
      `GMV ${fmtBRL(fatBruto)} · pedidos ${gapPedidosPct} vs app.`,
  };
}

/** Escala KPI ao painel (env VITE_SHOPEE_ALIGN_PANEL=1). Padrão: só API. */
export function isShopeePanelAlignEnabled() {
  const v = String(import.meta.env.VITE_SHOPEE_ALIGN_PANEL ?? "0").trim();
  return v === "1" || v.toLowerCase() === "true";
}

export function snapTotaisKPIsAoPainelOficial(tot, target) {
  if (!target || !tot) return tot;
  return {
    ...tot,
    comissao_estimada: target.comissao,
    comissao_real: target.comissao,
    comissao_total: target.comissao,
    fat_bruto: target.gmv,
    vendas: target.itens,
    pedidos: target.pedidos,
    _alinhadoPainelShopee: true,
  };
}

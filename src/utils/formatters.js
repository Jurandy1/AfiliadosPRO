import { comissaoProjetadaPeriodo } from "../daily-feed/calc/financeiroMetrics.js";

export const fmt = (v) =>
  "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (v) => Math.round((v || 0) * 100) + "%";

export const fmtNum = (v) => (v || 0).toLocaleString("pt-BR");

export const fmtRoas = (v) => (v || 0).toFixed(2) + "x";

/**
 * Card Comissão — número principal = comissão PENDENTE (estilo PromosApp).
 * Concluída não entra aqui; fica na legenda.
 */
export function comissaoPendenteKpiValor(kpis = {}) {
  if (kpis.splitIndisponivel) {
    return Number(kpis.comissaoEstimada ?? kpis.totalComissao ?? 0);
  }
  return Number(kpis.comissaoPendente ?? 0);
}

/** Abaixo do valor: quantidade de conversões pendentes (critério PromosApp). */
export function comissaoKpiTrendPedidosPendentes(kpis = {}) {
  if (kpis.splitIndisponivel) return null;
  const qtd = Number(kpis.pedidosPendentes || 0);
  if (qtd <= 0) return null;
  return `${fmtNum(qtd)} conversões pendentes`;
}

/** Progresso da meta mensal de faturamento — evita cap enganoso em 999%. */
export function formatMetaMensalProgress(fatBruto, metaMensal) {
  const meta = Number(metaMensal) || 0;
  const fat = Number(fatBruto) || 0;
  if (meta <= 0) {
    return { headline: "—", barPct: 0, fat, meta, ratio: 0 };
  }
  const ratio = fat / meta;
  const pct = ratio * 100;
  const barPct = Math.min(100, pct);
  const headline = ratio >= 10
    ? `${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× da meta`
    : `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da meta`;
  const detailPct = `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da meta`;
  return { headline, barPct, fat, meta, ratio, detailPct };
}

/** Soma diretas/indiretas a partir das linhas SubID (bate com TOTAL da tabela). */
export function somarVendasDiretasIndiretasSubIds(subIds = []) {
  let vendasDiretas = 0;
  let vendasIndiretas = 0;
  for (const r of subIds) {
    vendasDiretas += Number(r.vendas_diretas || 0);
    vendasIndiretas += Number(r.vendas_indiretas || 0);
  }
  return { vendasDiretas, vendasIndiretas };
}

export function contarSubIdsComVenda(subIds = []) {
  return (subIds || []).filter(
    (r) => (Number(r.comissoes || r.comissoes_estimadas || 0) > 0)
      || (Number(r.total_vendas || 0) > 0),
  ).length;
}

export function contarSubIdsNoPeriodo(subIds = []) {
  return (subIds || []).length;
}

/** Linhas de legenda — comissão KPI (nível conversão) e contagens claras. */
export function comissaoKpiLegendaLinhas(kpis = {}) {
  if (kpis.splitIndisponivel) {
    return ["Split concl./pend. indisponível nesta fonte"];
  }

  const spn = kpis.splitPedidoNivel;
  const qtdConc = Number(kpis.pedidosConcluidos || 0);
  const qtdConcPedido = Number(spn?.pedidos_concluidos || 0);
  const conc = Number(kpis.comissaoConcluida || 0);
  const pend = Number(kpis.comissaoPendente || 0);
  const total = Math.round((conc + pend + Number.EPSILON) * 100) / 100;
  const linhas = [];

  const comParts = [];
  if (conc > 0) comParts.push(`concl. ${fmt(conc)}`);
  if (pend > 0) comParts.push(`pend. ${fmt(pend)}`);
  if (total > 0) comParts.push(`total ${fmt(total)}`);
  if (comParts.length) {
    linhas.push(`Comissão (nível conversão): ${comParts.join(" · ")}`);
  }

  if (qtdConcPedido > 0 && qtdConcPedido !== qtdConc) {
    linhas.push(
      `${fmtNum(qtdConc)} conversões concluídas · ${fmtNum(qtdConcPedido)} pedidos COMPLETED (status individual)`,
    );
  } else if (qtdConc > 0) {
    linhas.push(`${fmtNum(qtdConc)} conversões concluídas`);
  }

  return linhas;
}

export function comissaoKpiSubTrendSplit(kpis = {}) {
  const linhas = comissaoKpiLegendaLinhas(kpis);
  return linhas.length ? linhas.join("\n") : null;
}

export function splitCriterioPromosAppTooltip(kpis = {}) {
  const spn = kpis.splitPedidoNivel;
  const qtdPedido = Number(spn?.pedidos_concluidos || 0);
  const qtdConv = Number(kpis.pedidosConcluidos || 0);
  const parts = [
    "Comissão KPI usa totalCommission uma vez por conversão (node_once), como no PromosApp.",
    "Conversão concluída: todos os pedidos válidos da conversão estão COMPLETED.",
  ];
  if (qtdPedido > 0 && qtdPedido !== qtdConv) {
    parts.push(
      `Há ${fmtNum(qtdConv)} conversões concluídas no critério PromosApp, mas ${fmtNum(qtdPedido)} pedidos já aparecem como COMPLETED individualmente na API.`,
    );
  }
  if (spn && (spn.comissao_concluida > 0 || spn.comissao_pendente > 0)) {
    parts.push(
      `Referência técnica (soma por item): concl. ${fmt(spn.comissao_concluida || 0)} · pend. ${fmt(spn.comissao_pendente || 0)}. Pode diferir do KPI node_once.`,
    );
  }
  const legado = kpis.splitCriterio !== "conversao_promosapp"
    ? " Critério antigo (por pedido) em parte do período — re-sync recomendado."
    : "";
  return parts.join(" ") + legado;
}

/** Taxa pedidos ÷ cliques em anúncios — null se não houver cliques. */
export function calcTaxaConversaoPedidos(kpis = {}) {
  const cliques = Number(kpis.totalCliques || kpis.totalCliquesShopee || 0);
  const pedidos = Number(kpis.totalPedidos || 0);
  if (cliques <= 0 || pedidos <= 0) return null;
  return pedidos / cliques;
}

export function formatTaxaConversaoPedidos(kpis = {}) {
  const rate = calcTaxaConversaoPedidos(kpis);
  if (rate == null) return null;
  return `Taxa pedidos/cliques ads: ${(rate * 100).toFixed(2)}%`;
}

/** GMV ÷ pedidos validados (distinct order level). */
export function calcTicketPorPedido(kpis = {}) {
  const pedidos = Number(kpis.totalPedidos || 0);
  const gmv = Number(kpis.faturamentoBruto || 0);
  if (pedidos <= 0) return 0;
  return gmv / pedidos;
}

/** Comissão total projetada (concluída + pendente). */
export function comissaoProjetadaValor(kpis = {}) {
  return comissaoProjetadaPeriodo(kpis);
}

/** Mensagem de contexto abaixo do bloco liquidado. */
export function comissaoLiquidacaoContexto(kpis = {}) {
  const pend = Number(kpis.comissaoPendente || 0);
  if (pend <= 0) return null;
  return `${fmt(pend)} ainda pendentes de liquidação na Shopee`;
}

/** ROAS liquidado (comissão concluída ÷ gasto). */
export function roasLiquidado(kpis = {}) {
  const g = Number(kpis.totalInvestimento || kpis.gastoTotal || 0);
  if (g <= 0) return 0;
  return Number(kpis.comissaoConcluida || 0) / g;
}

/** ROAS projetado (comissão total ÷ gasto). */
export function roasProjetado(kpis = {}) {
  const g = Number(kpis.totalInvestimento || kpis.gastoTotal || 0);
  const total = comissaoProjetadaPeriodo(kpis);
  if (g <= 0) return 0;
  return Number(kpis.roasProjetado ?? total / g);
}

/** Soma cliques Meta/Pinterest dos SubIDs quando o KPI global ainda está zerado. */
export function enriquecerKpisComTrafego(kpis = {}, subIds = []) {
  if (!Array.isArray(subIds) || subIds.length === 0) return kpis;

  let totalCliques = Number(kpis.totalCliques || 0);
  let totalCliquesShopee = Number(kpis.totalCliquesShopee || 0);

  if (totalCliques <= 0) {
    totalCliques = subIds.reduce((s, r) => s + Number(r.cliques_anuncio || 0), 0);
  }
  if (totalCliquesShopee <= 0) {
    totalCliquesShopee = subIds.reduce((s, r) => s + Number(r.cliques_shopee || 0), 0);
  }

  const enriched = { ...kpis, totalCliques, totalCliquesShopee };
  const convRate = calcTaxaConversaoPedidos(enriched);
  return {
    ...enriched,
    convRate: convRate ?? kpis.convRate ?? 0,
  };
}

/** Legenda do card Lucro — base liquidada (só comissão concluída). */
export function lucroKpiTrendLiquidado(kpis = {}, gasto = 0, impostoTotal = 0) {
  const conc = Number(kpis.comissaoConcluida || 0);
  const g = Number(gasto || 0);
  if (g <= 0) return `Liquidado: ${fmt(conc)} (sem gasto no período)`;
  if (impostoTotal > 0) {
    return `Liquidado: ${fmt(conc)} − gasto ${fmt(g)} − impostos ${fmt(impostoTotal)}`;
  }
  return `Liquidado: ${fmt(conc)} − gasto ${fmt(g)}`;
}

/** @deprecated alias — use lucroKpiTrendLiquidado */
export const lucroKpiTrendRealizado = lucroKpiTrendLiquidado;

/** Legenda principal do card Lucro projetado. */
export function lucroKpiTrendProjetado(kpis = {}) {
  const proj = Number(kpis.lucroProjetado ?? NaN);
  const total = comissaoProjetadaPeriodo(kpis);
  const g = Number(kpis.totalInvestimento || kpis.gastoTotal || 0);
  if (!Number.isFinite(proj) || total <= 0) return null;
  if (g <= 0) return `Projetado: ${fmt(total)} (sem gasto no período)`;
  return `Projetado: ${fmt(total)} − gasto ${fmt(g)} → ${fmt(proj)}`;
}

/** Segunda linha legado — preferir lucroKpiTrendProjetado no card dedicado. */
export function lucroKpiSubTrendProjetado(kpis = {}) {
  const proj = Number(kpis.lucroProjetado ?? NaN);
  const roiProj = Number(kpis.roiProjetado ?? 0);
  const total = comissaoProjetadaPeriodo(kpis);
  if (!Number.isFinite(proj) || total <= 0) return null;
  const roiTxt = (kpis.gastoTotal || kpis.totalInvestimento || 0) > 0
    ? ` · ROI ${(roiProj * 100).toFixed(2)}%`
    : "";
  return `Projetado: Total ${fmt(total)} − gasto → ${fmt(proj)}${roiTxt}`;
}

/** Legenda do card ROI — liquidado. */
export function roiKpiTrendLiquidado(kpis = {}) {
  const conc = Number(kpis.comissaoConcluida || 0);
  const g = Number(kpis.totalInvestimento || kpis.gastoTotal || 0);
  const roasLiq = g > 0 ? conc / g : 0;
  return `Liquidado: ${fmt(conc)} ÷ gasto · ROAS ${fmtRoas(roasLiq)}`;
}

/** @deprecated alias — use roiKpiTrendLiquidado */
export const roiKpiTrendRealizado = roiKpiTrendLiquidado;

/** Legenda principal do card ROI projetado. */
export function roiKpiTrendProjetado(kpis = {}) {
  const total = comissaoProjetadaPeriodo(kpis);
  const g = Number(kpis.totalInvestimento || kpis.gastoTotal || 0);
  if (g <= 0 || total <= 0) return null;
  const roiProj = Number(kpis.roiProjetado ?? 0);
  const roasProj = roasProjetado(kpis);
  return `Projetado: ${fmt(total)} ÷ gasto · ROAS ${fmtRoas(roasProj)} · ROI ${(roiProj * 100).toFixed(2)}%`;
}

/** Segunda linha legado — preferir roiKpiTrendProjetado no card dedicado. */
export function roiKpiSubTrendProjetado(kpis = {}) {
  const total = comissaoProjetadaPeriodo(kpis);
  const g = Number(kpis.totalInvestimento || kpis.gastoTotal || 0);
  if (g <= 0 || total <= 0) return null;
  const roiProj = Number(kpis.roiProjetado ?? 0);
  const roasProj = Number(kpis.roasProjetado ?? total / g);
  return `Projetado: ROI ${(roiProj * 100).toFixed(2)}% · ROAS ${fmtRoas(roasProj)}`;
}

/** Ex.: "há 5 minutos", "há 2 horas" */
export function formatarTempoAtras(date) {
  if (!date) return "—";
  const minutos = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutos < 1) return "agora mesmo";
  if (minutos === 1) return "há 1 minuto";
  if (minutos < 60) return `há ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas === 1) return "há 1 hora";
  if (horas < 24) return `há ${horas} horas`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  return `há ${dias} dias`;
}

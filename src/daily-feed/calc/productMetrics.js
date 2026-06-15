import { dedupeAdIds } from "../../utils/adLinkIds";

export function calcMetrics(produto) {
  const vendas = produto.vendas || 0;
  const comissao_total = produto.comissao_total || 0;
  const comissao_concluida = produto.comissao_concluida ?? comissao_total;
  const comissao_pendente = produto.comissao_pendente ?? 0;
  const comissao_cancelada = produto.comissao_cancelada ?? 0;
  const cliques = produto.cliques || 0;
  const investimento = produto.investimento || 0;

  const lucro = comissao_concluida - investimento;
  const roi = investimento > 0 ? lucro / investimento : 0;
  const roas = investimento > 0 ? comissao_concluida / investimento : 0;
  const cpa = vendas > 0 ? investimento / vendas : 0;
  const conv_rate = cliques > 0 ? vendas / cliques : 0;
  const cpc_real = cliques > 0 ? investimento / cliques : 0;

  let status = "Pausado";
  if (roi >= 1.7) status = "Escalando";
  else if (roi >= 1.0) status = "Validando";
  else if (investimento === 0 && vendas > 0) status = "Validando";

  const fonte = produto.fonte || "";
  const origem =
    (fonte === "produto_daily" || fonte === "shopee_venda" || fonte === "shopee_venda_append") ? "Shopee" :
    (fonte === "shopee_clique" || fonte === "shopee_clique_append" || fonte === "shopee_cliques") ? "Cliques" :
    "Manual";

  return {
    comissao_total,
    comissao_concluida,
    comissao_pendente,
    comissao_cancelada,
    lucro,
    roi,
    roas,
    cpa,
    conv_rate,
    cpc_real,
    status,
    origem,
  };
}

export function resolveProductInvestimento(produto, metaIndex, pinIndex) {
  const investimentoMeta = dedupeAdIds(produto.metaAdIds).reduce(
    (s, id) => s + (metaIndex[id]?.valorUsado || 0),
    0,
  );
  const investimentoPin = dedupeAdIds(produto.pinterestAdIds).reduce(
    (s, id) => s + (pinIndex[id]?.spend || 0),
    0,
  );
  const total = investimentoMeta + investimentoPin;
  return total > 0 ? Math.round(total * 100) / 100 : produto.investimento || 0;
}

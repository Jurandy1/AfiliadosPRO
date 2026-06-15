import { parseBRL, parsePct } from "../../../utils/numbers";
import { normalizeColumnName, buildColumnIndex, findColumn } from "../../../utils/columnNormalizer";
import { normalizeSubId } from "../../../utils/normalizeSubId";

function classifyStatus(rawStatus) {
  const sl = normalizeColumnName(String(rawStatus || "")).replace(/_/g, " ");
  if (
    sl.includes("cancelad") ||
    sl.includes("incompleto") ||
    sl.includes("nao pago") ||
    sl.includes("ainda nao pagou") ||
    sl.includes("nao pagou") ||
    sl.includes("estornado") ||
    sl.includes("reembols")
  ) {
    return "cancelada";
  }
  if (sl.includes("conclu") || sl.includes("complet") || sl.includes("finaliz") || sl.includes("confirmad")) {
    return "concluida";
  }
  return "pendente";
}

export function parseShopeeSalesRows(rows) {
  if (!rows || rows.length === 0) return { prodMap: {}, subIdMap: {}, processed: 0, colunas: [] };

  const colIdx = buildColumnIndex(rows[0]);

  const COL_NOME = findColumn(colIdx, "nome_do_item", "nome_do_produto", "nome_item", "nome");
  const COL_PRECO = findColumn(colIdx, "preco_r", "precor");
  const COL_VALOR = findColumn(colIdx, "valor_de_compra");
  const COL_QTD = findColumn(colIdx, "qtd");
  const COL_LOJA = findColumn(colIdx, "nome_da_loja");
  const COL_ID_LOJA = findColumn(colIdx, "id_da_loja");
  const COL_ID_ITEM = findColumn(colIdx, "id_do_item");
  const COL_CAT1 = findColumn(colIdx, "categoria_global_l1");
  const COL_CAT2 = findColumn(colIdx, "categoria_global_l2");
  const COL_TAXA = findColumn(colIdx, "taxa_de_comissao");
  const COL_COMIS =
    findColumn(colIdx, "comissao_liquida") ||
    findColumn(colIdx, "comissao_total_do_item") ||
    findColumn(colIdx, "comissao_total") ||
    Object.keys(rows[0] || {}).slice(-1)[0] ||
    null;
  const COL_REEMBOLSO = findColumn(colIdx, "valor_do_reembolso");
  const COL_STATUS = findColumn(colIdx, "status_do_pedido");
  const COL_NOTAS = findColumn(colIdx, "notas", "status_do_item");
  const COL_CANAL = findColumn(colIdx, "canal");
  const COL_SUB = findColumn(colIdx, "sub_id1");
  const COL_ATRIB = findColumn(colIdx, "tipo_de_atribuicao", "atribuicao");

  const prodMap = {};
  const subIdMap = {};
  let processed = 0;

  for (const row of rows) {
    const idItemFallback = COL_ID_ITEM ? String(row[COL_ID_ITEM] || "").trim() : "";
    const subFallback = COL_SUB ? String(row[COL_SUB] || "").trim() : "";
    const nome = COL_NOME ? String(row[COL_NOME] || "").trim() : "";
    const nomeResolvido = nome || idItemFallback || subFallback;
    if (!nomeResolvido) continue;

    const statusRaw = COL_STATUS ? String(row[COL_STATUS] || "") : "";
    const notasRaw = COL_NOTAS ? String(row[COL_NOTAS] || "") : "";
    const statusNormRaw = normalizeColumnName(statusRaw);
    const notasNormRaw = normalizeColumnName(notasRaw);
    const statusNorm = statusNormRaw.replace(/_/g, " ");
    const notasNorm = notasNormRaw.replace(/_/g, " ");

    const key = nomeResolvido.toLowerCase();
    const preco = COL_PRECO ? parseBRL(row[COL_PRECO]) : 0;
    const reembolso = COL_REEMBOLSO ? parseBRL(row[COL_REEMBOLSO]) : 0;
    const gmvBase = COL_VALOR ? parseBRL(row[COL_VALOR]) || preco : preco;
    const gmv = gmvBase - reembolso;
    const qty = COL_QTD ? parseInt(row[COL_QTD], 10) || 1 : 1;
    const loja = COL_LOJA ? String(row[COL_LOJA] || "").trim() : "";
    const idLoja = COL_ID_LOJA ? String(row[COL_ID_LOJA] || "").trim() : "";
    const idItem = COL_ID_ITEM ? String(row[COL_ID_ITEM] || "").trim() : "";
    const cat1 = COL_CAT1 ? String(row[COL_CAT1] || "").trim() : "";
    const cat2 = COL_CAT2 ? String(row[COL_CAT2] || "").trim() : "";
    const taxaComissao = COL_TAXA ? parsePct(row[COL_TAXA]) : 0;
    const comissaoVal = COL_COMIS ? parseBRL(row[COL_COMIS]) : 0;
    const subId = COL_SUB ? String(row[COL_SUB] || "").trim() : "";
    const canalRaw = COL_CANAL ? String(row[COL_CANAL] || "") : "";
    const canal = canalRaw.replace(/;/g, "").trim() || "Others";

    let isDireta = 0;
    let isIndireta = 1;
    if (COL_ATRIB) {
      const atrib = normalizeColumnName(String(row[COL_ATRIB] || "")).replace(/_/g, " ");
      isDireta = atrib.includes("mesma") ? 1 : 0;
      isIndireta = atrib.includes("diferente") ? 1 : 0;
    }

    if (!prodMap[key]) {
      prodMap[key] = {
        nome: nomeResolvido,
        plataforma: "Shopee",
        loja,
        preco,
        id_item: idItem,
        id_loja: idLoja,
        link_shopee: idLoja && idItem ? `https://shopee.com.br/product/${idLoja}/${idItem}` : "",
        link_afiliado: "",
        categoria: [cat1, cat2].filter(Boolean).join(" > "),
        comissao_pct: taxaComissao,
        vendas: 0,
        gmv_total: 0,
        comissao_total: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_cancelada: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        pedidos_pendentes: 0,
        pedidos_concluidos: 0,
        pedidos_cancelados: 0,
        canais: {},
        cliques: 0,
        sub_ids: new Set(),
      };
    }

    const p = prodMap[key];
    p.vendas += qty;
    p.gmv_total += gmv;
    p.comissao_total += comissaoVal;
    if (preco > 0 && (!p.preco || p.preco === 0)) p.preco = preco;
    if (taxaComissao > 0) p.comissao_pct = taxaComissao;
    if (subId) p.sub_ids.add(subId);

    p.vendas_diretas += isDireta;
    p.vendas_indiretas += isIndireta;

    const status = classifyStatus(statusRaw);
    if (status === "concluida") {
      p.pedidos_concluidos++;
      p.comissao_concluida += comissaoVal;
    } else if (status === "cancelada") {
      p.pedidos_cancelados++;
      p.comissao_cancelada += comissaoVal;
    } else {
      p.pedidos_pendentes++;
      p.comissao_pendente += comissaoVal;
    }

    if (canal) p.canais[canal] = (p.canais[canal] || 0) + 1;

    const subIdNorm = normalizeSubId(subId);
    const subKey = subIdNorm || "missing_subid";
    if (!subIdMap[subKey]) {
      subIdMap[subKey] = {
        subid: subIdNorm || "",
        comissoes: 0,
        faturamento: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        qtd_itens: 0,
      };
    }
    subIdMap[subKey].comissoes += comissaoVal;
    subIdMap[subKey].faturamento += gmv;
    subIdMap[subKey].vendas_diretas += isDireta;
    subIdMap[subKey].vendas_indiretas += isIndireta;
    subIdMap[subKey].qtd_itens += qty;
    processed++;
  }

  return { prodMap, subIdMap, processed, colunas: Object.keys(rows[0] || {}) };
}

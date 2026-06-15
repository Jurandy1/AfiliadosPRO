/** Traduções de campos retornados em inglês pela API de afiliados Shopee. */

const DISPLAY_ITEM_STATUS = {
  UNPAID: "Não pago",
  PAID: "Pago",
  COMPLETED: "Concluído",
  COMPLETE: "Concluído",
  PENDING: "Pendente",
  CANCELLED: "Cancelado",
  CANCELED: "Cancelado",
  INVALID: "Inválido",
  REJECTED: "Rejeitado",
  PROCESSING: "Processando",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  RETURNED: "Devolvido",
  REFUNDED: "Reembolsado",
  TO_RETURN: "Em devolução",
  TO_CONFIRM: "Aguardando confirmação",
  TO_SHIP: "Aguardando envio",
  READY_TO_SHIP: "Pronto para envio",
  UNVERIFIED: "Não verificado",
  VERIFIED: "Verificado",
  FRAUD: "Fraude",
  NORMAL: "Normal",
  ABNORMAL: "Anormal",
};

/** Match exato após normalização (sem pontuação extra). */
const FRASES_API_EXATAS = {
  "the rating of this product is too low you are not advised to promote it":
    "A avaliação deste produto está muito baixa. A Shopee não recomenda promovê-lo.",
  "the rating of this product is too low you are not advised to promote this product":
    "A avaliação deste produto está muito baixa. A Shopee não recomenda promovê-lo.",
  "product with low rating and high return rate it is recommended to check the product quality and supplier":
    "Produto com avaliação baixa e alta taxa de devolução. Verifique a qualidade e o fornecedor.",
  "product is set to have a pending status and will only be updated after it is fixed":
    "Produto com status pendente na Shopee. Só será atualizado após correção.",
  "this product is not recommended for promotion due to low rating":
    "Este produto não é recomendado para promoção por causa da avaliação baixa.",
  "this product is not recommended for promotion":
    "Este produto não é recomendado para promoção.",
  "invalid click": "Clique inválido pela Shopee.",
  "invalid order": "Pedido inválido pela Shopee.",
  "duplicate order": "Pedido duplicado.",
  "duplicate conversion": "Conversão duplicada.",
  "self purchase": "Autocompra detectada (compra própria).",
  "self purchase is not allowed": "Autocompra não permitida.",
  "self buying is not allowed": "Autocompra não permitida.",
  "same device": "Compra no mesmo dispositivo.",
  "same shop affiliate": "Compra na mesma loja/afiliado.",
  "traffic source invalid": "Fonte de tráfego inválida.",
  "invalid traffic": "Tráfego inválido.",
  "click is invalid": "Clique inválido.",
  "order is cancelled": "Pedido cancelado.",
  "order is canceled": "Pedido cancelado.",
  "order cancelled": "Pedido cancelado.",
  "order canceled": "Pedido cancelado.",
  "order amount is abnormal": "Valor do pedido anormal.",
  "abnormal order": "Pedido anormal.",
  "risk control rejected": "Rejeitado pelo controle de risco da Shopee.",
  "buyer is seller": "Comprador identificado como vendedor.",
  "fraudulent activity": "Atividade fraudulenta detectada.",
  "fraud detected": "Fraude detectada.",
  "unverified traffic": "Tráfego não verificado.",
  "unverified order": "Pedido não verificado.",
  "commission is invalid": "Comissão inválida.",
  "invalid commission": "Comissão inválida.",
  "attribution invalid": "Atribuição inválida.",
  "invalid attribution": "Atribuição inválida.",
  "order not eligible": "Pedido não elegível para comissão.",
  "not eligible for commission": "Não elegível para comissão.",
  "cross shop purchase": "Compra entre lojas não permitida.",
  "policy violation": "Violação das políticas da Shopee.",
  "suspicious activity": "Atividade suspeita detectada.",
  "abnormal user behavior": "Comportamento anormal do usuário.",
  "returned order": "Pedido devolvido.",
  "refunded order": "Pedido reembolsado.",
  "payment failed": "Pagamento não concluído.",
  "order expired": "Pedido expirado.",
};

/**
 * Padrões → frase 100% em português (nunca tradução palavra a palavra).
 * Ordem: do mais específico ao mais genérico.
 */
const INFERENCIAS_PT = [
  {
    test: /rating.*too low|not advised to promote|not recommended.*promot/i,
    completo: "A avaliação deste produto está muito baixa. A Shopee não recomenda promovê-lo.",
    resumo: "Avaliação baixa — evite promover",
  },
  {
    test: /low rating.*return|high return rate|return rate.*quality/i,
    completo: "Produto com avaliação baixa e muitas devoluções. Verifique qualidade e fornecedor.",
    resumo: "Avaliação baixa e muitas devoluções",
  },
  {
    test: /pending status.*fixed|will only be updated after/i,
    completo: "Produto com status pendente na Shopee. Só será atualizado após correção.",
    resumo: "Status pendente na Shopee",
  },
  {
    test: /invalid click|click is invalid/i,
    completo: "Clique considerado inválido pela Shopee.",
    resumo: "Clique inválido",
  },
  {
    test: /self purchase|self buying|self-buy/i,
    completo: "Autocompra detectada. A Shopee não paga comissão nesse caso.",
    resumo: "Autocompra",
  },
  {
    test: /duplicate order|duplicate conversion/i,
    completo: "Pedido ou conversão duplicada.",
    resumo: "Duplicado",
  },
  {
    test: /same device/i,
    completo: "Compra feita no mesmo dispositivo (suspeita de autocompra).",
    resumo: "Mesmo dispositivo",
  },
  {
    test: /invalid traffic|traffic source invalid/i,
    completo: "Fonte de tráfego considerada inválida pela Shopee.",
    resumo: "Tráfego inválido",
  },
  {
    test: /fraudulent|fraud detected|\bfraud\b/i,
    completo: "Fraude detectada pela Shopee nesta conversão.",
    resumo: "Fraude detectada",
  },
  {
    test: /unverified/i,
    completo: "Conversão ainda não verificada pela Shopee.",
    resumo: "Não verificado",
  },
  {
    test: /not eligible|invalid commission|invalid attribution/i,
    completo: "Conversão não elegível para comissão.",
    resumo: "Sem comissão",
  },
  {
    test: /cancel/i,
    completo: "Pedido cancelado — comissão não será paga.",
    resumo: "Pedido cancelado",
  },
  {
    test: /returned|refunded/i,
    completo: "Pedido devolvido ou reembolsado — comissão pode ser cancelada.",
    resumo: "Devolução/reembolso",
  },
  {
    test: /risk control|policy violation|suspicious|abnormal/i,
    completo: "Bloqueio ou restrição aplicada pelo controle de risco da Shopee.",
    resumo: "Restrição da Shopee",
  },
  {
    test: /buyer is seller/i,
    completo: "Comprador identificado como vendedor.",
    resumo: "Comprador = vendedor",
  },
  {
    test: /payment failed|order expired/i,
    completo: "Pagamento não concluído ou pedido expirado.",
    resumo: "Pagamento não concluído",
  },
];

const FALLBACK_PT =
  "A Shopee sinalizou uma restrição neste item. Abra o produto no painel de afiliados para mais detalhes.";

function normalizarChave(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:'"()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pareceIngles(texto) {
  return /\b(the|this|you|are|is|not|product|order|promote|advised|rating|recommended|will|only|after|check)\b/i.test(
    texto,
  );
}

function inferirTraducao(texto, modo = "completo") {
  const raw = String(texto || "").trim();
  if (!raw) return "";

  if (!pareceIngles(raw)) return raw;

  for (const regra of INFERENCIAS_PT) {
    if (regra.test.test(raw)) {
      return modo === "resumo" ? regra.resumo : regra.completo;
    }
  }

  return modo === "resumo" ? "Restrição da Shopee" : FALLBACK_PT;
}

function traduzirFragmento(texto) {
  const raw = String(texto || "").trim();
  if (!raw) return "";

  const chave = normalizarChave(raw);
  if (FRASES_API_EXATAS[chave]) return FRASES_API_EXATAS[chave];

  if (!pareceIngles(raw)) return raw;

  return inferirTraducao(raw, "completo");
}

/** Tradutor central — sempre retorna texto 100% em português. */
export function traduzirTextoApiShopee(texto) {
  const raw = String(texto || "").trim();
  if (!raw) return "";

  return raw
    .split(/\s*\/\/\s*/)
    .map(traduzirFragmento)
    .filter(Boolean)
    .join(" · ");
}

export function traduzirItemNotes(notes) {
  return traduzirTextoApiShopee(notes);
}

export function traduzirDisplayItemStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return "";

  const token = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (DISPLAY_ITEM_STATUS[token]) return DISPLAY_ITEM_STATUS[token];
  if (DISPLAY_ITEM_STATUS[raw.toUpperCase()]) return DISPLAY_ITEM_STATUS[raw.toUpperCase()];

  if (/^[A-Z0-9_]+$/.test(raw) && raw.length <= 24) {
    return raw
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return traduzirTextoApiShopee(raw);
}

export function traduzirDisplayItemStatusResumo(status) {
  const raw = String(status || "").trim();
  if (!raw) return "";

  const token = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (DISPLAY_ITEM_STATUS[token]) return DISPLAY_ITEM_STATUS[token];

  if (pareceIngles(raw)) return inferirTraducao(raw, "resumo");

  const trad = traduzirTextoApiShopee(raw);
  if (trad.length > 42) return `${trad.slice(0, 40)}…`;
  return trad;
}

/** Texto original da API (inglês) para exibir sob demanda. */
export function obterTextoOriginalApi(item) {
  const partes = [item?.itemNotes, item?.displayItemStatus]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const vistos = new Set();
  const unicos = [];
  for (const p of partes) {
    const k = normalizarChave(p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    unicos.push(p);
  }
  return unicos.join(" · ");
}

/** Junta itemNotes + displayItemStatus traduzidos, sem repetir. */
export function obterNotasApiTraduzidas(item) {
  const vistos = new Set();
  const saida = [];

  for (const campo of [item?.itemNotes, item?.displayItemStatus]) {
    const trad = traduzirTextoApiShopee(campo);
    if (!trad) continue;
    const chave = normalizarChave(trad);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(trad);
  }

  return saida.join(" · ");
}

export function traduzirFraudStatus(status) {
  const s = String(status || "").toUpperCase().trim();
  if (s === "FRAUD") return "Fraude";
  if (s === "UNVERIFIED") return "Não verificado";
  if (s === "VERIFIED") return "Verificado";
  return status || "";
}

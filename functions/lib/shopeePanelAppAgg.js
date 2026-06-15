"use strict";

/**
 * Agregação PromosApp node_once — mesma regra do buildShopeePanelAppDayMap (functions/index.js).
 * Usado por scripts de audit/sync locais.
 */

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const AGGREGATION_MODE = "promosapp-node-once";

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseNum(v) {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function parseQty(v) {
  const q = parseInt(v, 10);
  return q > 0 ? q : 1;
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET")) return "concluida";
  if (shopeeIsStatusPerda(s)) return "cancelada";
  if (s === "UNPAID") return "unpaid";
  return "pendente";
}

function shopeeIsStatusPerda(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (!s) return false;
  const pendentes = new Set([
    "UNPAID", "PENDING", "PROCESSING", "WAITING_PAYMENT",
    "TO_CONFIRM", "TO_SHIP", "SHIPPING", "SHIPPED",
    "COMPLETED", "PAID", "READY_TO_SHIP", "PROCESSED",
    "TO_CONFIRM_RECEIVE", "RETRY_SHIP", "IN_CANCEL",
  ]);
  if (pendentes.has(s)) return false;
  if (["CANCELLED", "CANCELED", "FAILED", "FRAUD", "EXPIRED", "REFUNDED", "REJECTED", "VOID", "INVALID"].includes(s)) {
    return true;
  }
  if (s.includes("CANCEL") || s.includes("FRAUD") || s.includes("REFUND")) return true;
  return false;
}

function shopeeIsDireta(attr) {
  const val = String(attr || "").toUpperCase();
  return val.includes("SAME SHOP") || val.includes("SAME_SHOP") ? 1 : 0;
}

function parseItemTotalCommission(it) {
  if (it == null) return 0;
  if (it.itemTotalCommission != null && it.itemTotalCommission !== "") {
    return parseFloat(it.itemTotalCommission) || 0;
  }
  const shopee = parseFloat(it.itemShopeeCommissionCapped ?? it.itemCommission ?? 0) || 0;
  const seller = parseFloat(it.itemSellerCommission ?? it.grossBrandCommission ?? 0) || 0;
  return shopee + seller;
}

function comissaoItemOrdemUnpaid(ord) {
  let s = 0;
  for (const it of ord.items || []) {
    if (String(it.fraudStatus || "").toUpperCase().trim() === "FRAUD") continue;
    s += parseItemTotalCommission(it);
  }
  return s;
}

/** Igual comissaoDoNode / painel Shopee: totalCommission (não netCommission). */
function comissaoDoNode(node) {
  let tc = parseNum(node?.totalCommission);
  if (tc === 0) {
    tc = parseNum(node?.shopeeCommissionCapped) + parseNum(node?.sellerCommission);
  }
  if (tc === 0) {
    for (const ord of node?.orders || []) {
      for (const it of ord?.items || []) {
        tc += parseItemTotalCommission(it);
      }
    }
  }
  return roundMoney(tc);
}

function nodeOnceCommission(node) {
  return comissaoDoNode(node);
}

function formatUnixToBRTDate(unixValue, timeZone = DEFAULT_TIME_ZONE) {
  let sec = Number(unixValue);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec > 1e12) sec = Math.floor(sec / 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(sec * 1000));
}

/** Dedupe pull API — par (conversionId, orderId), igual shopeePullRangeComplete. */
function dedupePullNodes(nodes) {
  const seen = new Set();
  const out = [];
  for (const node of nodes || []) {
    const cid = String(node?.conversionId || "").trim();
    const orderId = String(node?.orders?.[0]?.orderId || "").trim();
    const key = cid && orderId
      ? `${cid}__${orderId}`
      : cid || `__noid_${node?.purchaseTime || ""}_${orderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(node);
  }
  return out;
}

function groupNodesByConversionId(nodes) {
  const map = new Map();
  for (const node of nodes || []) {
    const cid = String(node?.conversionId || "").trim()
      || `__solo_${node?.purchaseTime || 0}_${node?.orders?.[0]?.orderId || "?"}`;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(node);
  }
  return map;
}

function pedidosValidadosNaConversao(node) {
  const out = [];
  for (const ord of node?.orders || []) {
    const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    if (st === "UNPAID" || st === "CANCELLED" || st === "CANCELED") continue;
    const oid = String(ord.orderId || "").trim();
    if (!oid) continue;
    out.push({ ord, st });
  }
  return out;
}

function pedidosValidadosNoGrupo(nodes) {
  const out = [];
  for (const node of nodes) {
    for (const item of pedidosValidadosNaConversao(node)) out.push(item);
  }
  return out;
}

function conversaoConcluidaPromosAppGrupo(nodes) {
  const validados = pedidosValidadosNoGrupo(nodes);
  if (!validados.length) return false;
  return validados.every(({ st }) => st === "COMPLETED");
}

function comissaoNodeOnceGrupo(nodes) {
  let sum = 0;
  for (const node of nodes) sum += nodeOnceCommission(node);
  return roundMoney(sum);
}

function somaComissaoItensOrdem(ord) {
  let s = 0;
  for (const it of ord?.items || []) s += parseItemTotalCommission(it);
  return s;
}

function createSubAcc(subid) {
  return {
    subid,
    commissionLiquidated: 0,
    commissionPending: 0,
    commissionProjected: 0,
    validOrders: new Set(),
    cancelledOrders: 0,
    unpaidOrders: 0,
    itemsSold: 0,
    directItems: 0,
    indirectItems: 0,
    gmv: 0,
    conversionsCompleted: 0,
    conversionsPendingOrders: 0,
  };
}

function ensureSub(subMap, subid) {
  if (!subMap.has(subid)) subMap.set(subid, createSubAcc(subid));
  return subMap.get(subid);
}

function createDayShell(date) {
  return {
    data: date,
    pedidos: 0,
    pedidos_pendentes: 0,
    pedidos_concluidos: 0,
    pedidos_cancelados: 0,
    pedidos_nao_pagos: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
    faturamento: 0,
    gmv_total: 0,
    comissao_real: 0,
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
    comissao_nao_paga: 0,
    aggregation_mode: AGGREGATION_MODE,
    splitCriterio: "conversao_promosapp",
    _pedidosSet: new Set(),
    _pedidosConcluidosSet: new Set(),
    _pedidosConcluidosConv: 0,
    _pedidosPendentesConv: 0,
    _conversoesConcluidas: 0,
    _conversoesPendentes: 0,
    _canceladosSet: new Set(),
    _naoPagosSet: new Set(),
    _splitPedidoNivel: {
      pedidos_concluidos: 0,
      pedidos_pendentes: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
    },
    _comConcItemsH2: 0,
    _comPendItemsH2: 0,
    _subMap: new Map(),
  };
}

function finalizeDayEntry(day) {
  day.pedidos = day._pedidosSet.size;
  day.pedidos_concluidos = day._pedidosConcluidosConv;
  day.pedidos_pendentes = day._pedidosPendentesConv;
  day.conversoes_concluidas = day._conversoesConcluidas;
  day.conversoes_pendentes = day._conversoesPendentes;
  day.pedidos_cancelados = day._canceladosSet.size;
  day.comissao_estimada = roundMoney(day.comissao_estimada);
  day.comissao_real = roundMoney(day.comissao_real);
  day.comissao_total = roundMoney(day.comissao_total);
  day.comissao_nao_paga = roundMoney(day.comissao_nao_paga || 0);
  day.faturamento = roundMoney(day.faturamento);
  day.gmv_total = roundMoney(day.gmv_total);

  const brutoItemSplit = (day._comConcItemsH2 || 0) + (day._comPendItemsH2 || 0);
  if (brutoItemSplit > 0 && day.comissao_total > 0) {
    day.comissao_concluida = roundMoney(day.comissao_total * ((day._comConcItemsH2 || 0) / brutoItemSplit));
    day.comissao_pendente = roundMoney(day.comissao_total - day.comissao_concluida);
  } else {
    day.comissao_concluida = roundMoney(day.comissao_concluida);
    day.comissao_pendente = roundMoney(day.comissao_pendente);
  }

  day.splitPedidoNivel = {
    pedidos_concluidos: day._splitPedidoNivel.pedidos_concluidos,
    pedidos_pendentes: day._splitPedidoNivel.pedidos_pendentes,
    comissao_concluida: roundMoney(day._splitPedidoNivel.comissao_concluida),
    comissao_pendente: roundMoney(day._splitPedidoNivel.comissao_pendente),
  };

  delete day._pedidosSet;
  delete day._pedidosConcluidosSet;
  delete day._pedidosConcluidosConv;
  delete day._pedidosPendentesConv;
  delete day._canceladosSet;
  delete day._naoPagosSet;
  delete day._splitPedidoNivel;
  delete day._comConcItemsH2;
  delete day._comPendItemsH2;
  delete day._conversoesConcluidas;
  delete day._conversoesPendentes;

  return day;
}

/**
 * @param {object[]} nodes
 * @param {string|null} dateKey filtra purchaseTime
 * @param {object} options { normalizeSubId, trackSubIds, timeZone }
 */
function buildShopeePanelAppDayMap(nodes, dateKey = null, mode = "node_once", options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const normalizeSubId = typeof options.normalizeSubId === "function"
    ? options.normalizeSubId
    : (raw) => String(raw || "").trim() || "_sem_subid";
  const trackSubIds = options.trackSubIds !== false;

  const scopedNodes = dateKey
    ? (nodes || []).filter((n) => formatUnixToBRTDate(n.purchaseTime, timeZone) === dateKey)
    : (nodes || []);

  const dayMap = {};
  const groups = groupNodesByConversionId(scopedNodes);

  function ensure(date) {
    if (!dayMap[date]) dayMap[date] = createDayShell(date);
    return dayMap[date];
  }

  for (const node of scopedNodes) {
    const date = formatUnixToBRTDate(node.purchaseTime, timeZone);
    if (!date) continue;
    const day = ensure(date);

    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st === "CANCELLED" || st === "CANCELED") {
        const oidCancel = String(ord.orderId || "").trim();
        if (oidCancel) day._canceladosSet.add(oidCancel);
      }
    }

    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st === "CANCELLED" || st === "CANCELED") continue;
      const pk = String(ord.orderId || "").trim();
      if (!pk) continue;

      const subid = trackSubIds ? normalizeSubId(node.utmContent) : null;
      const sub = trackSubIds ? ensureSub(day._subMap, subid) : null;

      if (st === "UNPAID") {
        if (!day._naoPagosSet.has(pk)) {
          day._naoPagosSet.add(pk);
          day.pedidos_nao_pagos += 1;
          if (sub) sub.unpaidOrders += 1;
        }
        day.comissao_nao_paga = roundMoney(
          (day.comissao_nao_paga || 0) + comissaoItemOrdemUnpaid(ord),
        );
        continue;
      }

      day._pedidosSet.add(pk);
      if (shopeeClassifyStatus(st) === "concluida") day._pedidosConcluidosSet.add(pk);
      if (sub) sub.validOrders.add(pk);

      for (const it of ord.items || []) {
        if (String(it.fraudStatus || "").toUpperCase().trim() === "FRAUD") continue;
        const qty = parseQty(it.qty);
        const price = parseNum(it.itemPrice);
        const actual = parseNum(it.actualAmount);
        const g = actual > 0 ? actual : price * qty;
        const isDireta = shopeeIsDireta(it.attributionType);

        day.vendas += qty;
        day.vendas_diretas += isDireta * qty;
        day.vendas_indiretas += (isDireta ? 0 : 1) * qty;
        day.faturamento += g;
        day.gmv_total += g;

        if (sub) {
          sub.itemsSold += qty;
          sub.gmv += g;
          if (isDireta) sub.directItems += qty;
          else sub.indirectItems += qty;
        }
      }
    }
  }

  if (mode !== "max_per_order") {
    for (const groupNodes of groups.values()) {
      const validadosConv = pedidosValidadosNoGrupo(groupNodes);
      if (!validadosConv.length) continue;

      const tcGrupo = comissaoNodeOnceGrupo(groupNodes);
      const convConcluida = conversaoConcluidaPromosAppGrupo(groupNodes);
      const refNode = groupNodes[0];
      const date = formatUnixToBRTDate(refNode.purchaseTime, timeZone);
      if (!date) continue;
      const day = ensure(date);
      const subid = trackSubIds ? normalizeSubId(refNode.utmContent) : null;
      const sub = trackSubIds ? ensureSub(day._subMap, subid) : null;

      day.comissao_estimada += tcGrupo;
      day.comissao_real += tcGrupo;
      day.comissao_total += tcGrupo;

      let itemSumConv = 0;
      for (const { ord } of validadosConv) itemSumConv += somaComissaoItensOrdem(ord);

      let splitConc = 0;
      let splitPend = 0;
      if (convConcluida) {
        day._pedidosConcluidosConv += validadosConv.length;
        day._conversoesConcluidas += 1;
        day._comConcItemsH2 += itemSumConv;
        splitConc = tcGrupo;
      } else {
        day._pedidosPendentesConv += validadosConv.length;
        day._conversoesPendentes += 1;
        day._comPendItemsH2 += itemSumConv;
        splitPend = tcGrupo;
      }

      if (sub) {
        sub.commissionProjected += tcGrupo;
        sub.commissionLiquidated += splitConc;
        sub.commissionPending += splitPend;
        if (convConcluida) {
          sub.conversionsCompleted += 1;
        } else {
          sub.conversionsPendingOrders += validadosConv.length;
        }
      }

      for (const { ord, st } of validadosConv) {
        const comPed = somaComissaoItensOrdem(ord);
        if (shopeeClassifyStatus(st) === "concluida") {
          day._splitPedidoNivel.pedidos_concluidos += 1;
          day._splitPedidoNivel.comissao_concluida += comPed;
        } else {
          day._splitPedidoNivel.pedidos_pendentes += 1;
          day._splitPedidoNivel.comissao_pendente += comPed;
        }
      }
    }
  }

  for (const date of Object.keys(dayMap)) {
    finalizeDayEntry(dayMap[date]);
  }

  return {
    dayMap,
    conversionGroups: groups.size,
    pullUniqueNodes: scopedNodes.length,
  };
}

function mapDayEntryToAudit(dateKey, day) {
  const commissionLiquidated = roundMoney(day.comissao_concluida);
  const commissionPending = roundMoney(day.comissao_pendente);
  const commissionProjected = roundMoney(
    day.comissao_total || commissionLiquidated + commissionPending,
  );
  const validOrders = Number(day.pedidos || 0);
  const itemsSold = Number(day.vendas || 0);

  return {
    dateKey,
    conversionsCompleted: Number(day.pedidos_concluidos || 0),
    conversionsPending: Number(day.pedidos_pendentes || 0),
    conversionGroupsCompleted: Number(day.conversoes_concluidas || 0),
    conversionGroupsPending: Number(day.conversoes_pendentes || 0),
    validOrders,
    cancelledOrders: Number(day.pedidos_cancelados || 0),
    unpaidOrders: Number(day.pedidos_nao_pagos || 0),
    itemsSold,
    directItems: Number(day.vendas_diretas || 0),
    indirectItems: Number(day.vendas_indiretas || 0),
    gmv: roundMoney(day.faturamento || day.gmv_total || 0),
    commissionLiquidated,
    commissionPending,
    commissionProjected,
    ticketPerItem: itemsSold > 0 ? roundMoney((day.faturamento || 0) / itemsSold) : 0,
    ticketPerOrder: validOrders > 0 ? roundMoney((day.faturamento || 0) / validOrders) : 0,
  };
}

function mapSubAccToAudit(sub) {
  return {
    subid: sub.subid,
    conversionsCompleted: sub.conversionsCompleted,
    conversionsPending: sub.conversionsPendingOrders,
    validOrders: sub.validOrders.size,
    cancelledOrders: sub.cancelledOrders,
    unpaidOrders: sub.unpaidOrders,
    itemsSold: sub.itemsSold,
    directItems: sub.directItems,
    indirectItems: sub.indirectItems,
    gmv: roundMoney(sub.gmv),
    commissionLiquidated: roundMoney(sub.commissionLiquidated),
    commissionPending: roundMoney(sub.commissionPending),
    commissionProjected: roundMoney(sub.commissionProjected),
  };
}

function sumAuditDays(byDay) {
  const totals = {
    key: "TOTAL",
    conversionsCompleted: 0,
    conversionsPending: 0,
    validOrders: 0,
    cancelledOrders: 0,
    unpaidOrders: 0,
    itemsSold: 0,
    directItems: 0,
    indirectItems: 0,
    gmv: 0,
    commissionLiquidated: 0,
    commissionPending: 0,
    commissionProjected: 0,
  };

  for (const row of byDay) {
    totals.conversionsCompleted += row.conversionsCompleted;
    totals.conversionsPending += row.conversionsPending;
    totals.validOrders += row.validOrders;
    totals.cancelledOrders += row.cancelledOrders;
    totals.unpaidOrders += row.unpaidOrders;
    totals.itemsSold += row.itemsSold;
    totals.directItems += row.directItems;
    totals.indirectItems += row.indirectItems;
    totals.gmv += row.gmv;
    totals.commissionLiquidated += row.commissionLiquidated;
    totals.commissionPending += row.commissionPending;
    totals.commissionProjected += row.commissionProjected;
  }

  totals.gmv = roundMoney(totals.gmv);
  totals.commissionLiquidated = roundMoney(totals.commissionLiquidated);
  totals.commissionPending = roundMoney(totals.commissionPending);
  totals.commissionProjected = roundMoney(totals.commissionProjected);
  totals.ticketPerItem = totals.itemsSold > 0 ? roundMoney(totals.gmv / totals.itemsSold) : 0;
  totals.ticketPerOrder = totals.validOrders > 0 ? roundMoney(totals.gmv / totals.validOrders) : 0;

  return totals;
}

function mergeSubIdMaps(target, source) {
  for (const [subid, sub] of source.entries()) {
    const acc = ensureSub(target, subid);
    acc.commissionLiquidated += sub.commissionLiquidated;
    acc.commissionPending += sub.commissionPending;
    acc.commissionProjected += sub.commissionProjected;
    acc.conversionsCompleted += sub.conversionsCompleted;
    acc.conversionsPendingOrders += sub.conversionsPendingOrders;
    acc.cancelledOrders += sub.cancelledOrders;
    acc.unpaidOrders += sub.unpaidOrders;
    acc.itemsSold += sub.itemsSold;
    acc.directItems += sub.directItems;
    acc.indirectItems += sub.indirectItems;
    acc.gmv += sub.gmv;
    for (const oid of sub.validOrders) acc.validOrders.add(oid);
  }
}

/**
 * Agrega a partir de um único pull deduplicado (igual shopeePullRangeComplete + agruparPorData).
 */
function aggregateShopeeRangeFromPull(allNodes, range, options = {}) {
  const normalizeSubId = options.normalizeSubId || ((raw) => String(raw || "").trim() || "_sem_subid");
  const pullNodes = dedupePullNodes(allNodes || []);
  const byDay = [];
  const subIdMap = new Map();

  for (const day of range.days) {
    const { dayMap } = buildShopeePanelAppDayMap(
      pullNodes,
      day.dateKey,
      "node_once",
      { normalizeSubId, trackSubIds: true, timeZone: options.timeZone },
    );
    const dayEntry = dayMap[day.dateKey];
    if (dayEntry) {
      byDay.push(mapDayEntryToAudit(day.dateKey, dayEntry));
      mergeSubIdMaps(subIdMap, dayEntry._subMap || new Map());
    } else {
      byDay.push({
        dateKey: day.dateKey,
        conversionsCompleted: 0,
        conversionsPending: 0,
        conversionGroupsCompleted: 0,
        conversionGroupsPending: 0,
        validOrders: 0,
        cancelledOrders: 0,
        unpaidOrders: 0,
        itemsSold: 0,
        directItems: 0,
        indirectItems: 0,
        gmv: 0,
        commissionLiquidated: 0,
        commissionPending: 0,
        commissionProjected: 0,
        ticketPerItem: 0,
        ticketPerOrder: 0,
      });
    }
  }

  byDay.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const bySubId = Array.from(subIdMap.values())
    .map(mapSubAccToAudit)
    .sort((a, b) => b.commissionProjected - a.commissionProjected || b.gmv - a.gmv);

  return {
    source: {
      shopeePages: options.pages || 0,
      rawNodes: (allNodes || []).length,
      pullUniqueNodes: pullNodes.length,
      conversionGroups: groupNodesByConversionId(pullNodes).size,
      aggregationMode: AGGREGATION_MODE,
      pullMode: "range_deduped",
    },
    totals: sumAuditDays(byDay),
    byDay,
    bySubId,
  };
}

function aggregateShopeeRangePromosApp(dayResults, options = {}) {
  const normalizeSubId = options.normalizeSubId || ((raw) => String(raw || "").trim() || "_sem_subid");

  let totalPages = 0;
  let totalRawNodes = 0;
  let totalPullUnique = 0;
  let totalConversionGroups = 0;

  const byDay = [];
  const subIdMap = new Map();

  for (const dayResult of dayResults) {
    totalPages += dayResult.pages || 0;
    totalRawNodes += dayResult.rawNodes || dayResult.nodes?.length || 0;

    const pullNodes = dedupePullNodes(dayResult.nodes || []);
    totalPullUnique += pullNodes.length;

    const { dayMap, conversionGroups } = buildShopeePanelAppDayMap(
      pullNodes,
      dayResult.dateKey,
      "node_once",
      { normalizeSubId, trackSubIds: true, timeZone: options.timeZone },
    );

    totalConversionGroups += conversionGroups;

    const dayEntry = dayMap[dayResult.dateKey];
    if (dayEntry) {
      byDay.push(mapDayEntryToAudit(dayResult.dateKey, dayEntry));
      mergeSubIdMaps(subIdMap, dayEntry._subMap || new Map());
    } else {
      byDay.push({
        dateKey: dayResult.dateKey,
        conversionsCompleted: 0,
        conversionsPending: 0,
        validOrders: 0,
        cancelledOrders: 0,
        unpaidOrders: 0,
        itemsSold: 0,
        directItems: 0,
        indirectItems: 0,
        gmv: 0,
        commissionLiquidated: 0,
        commissionPending: 0,
        commissionProjected: 0,
        ticketPerItem: 0,
        ticketPerOrder: 0,
      });
    }
  }

  byDay.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const bySubId = Array.from(subIdMap.values())
    .map(mapSubAccToAudit)
    .sort((a, b) => b.commissionProjected - a.commissionProjected || b.gmv - a.gmv);

  return {
    source: {
      shopeePages: totalPages,
      rawNodes: totalRawNodes,
      pullUniqueNodes: totalPullUnique,
      conversionGroups: totalConversionGroups,
      aggregationMode: AGGREGATION_MODE,
    },
    totals: sumAuditDays(byDay),
    byDay,
    bySubId,
  };
}

function createEmptyDayEntry(dateKey) {
  return finalizeDayEntry(createDayShell(dateKey));
}

function dayEntryToFirestoreDoc(day) {
  return {
    data: day.data,
    pedidos: day.pedidos,
    pedidos_concluidos: day.pedidos_concluidos,
    pedidos_pendentes: day.pedidos_pendentes,
    pedidos_cancelados: day.pedidos_cancelados,
    pedidos_nao_pagos: day.pedidos_nao_pagos,
    vendas: day.vendas,
    vendas_diretas: day.vendas_diretas,
    vendas_indiretas: day.vendas_indiretas,
    faturamento: day.faturamento,
    gmv_total: day.gmv_total,
    comissao_concluida: day.comissao_concluida,
    comissao_pendente: day.comissao_pendente,
    comissao_nao_paga: day.comissao_nao_paga,
    comissao_total: day.comissao_total,
    comissao_real: day.comissao_real,
    comissao_estimada: day.comissao_estimada,
    aggregation_mode: day.aggregation_mode,
    splitCriterio: day.splitCriterio,
    splitPedidoNivel: day.splitPedidoNivel,
    conversoes_concluidas: day.conversoes_concluidas,
    conversoes_pendentes: day.conversoes_pendentes,
  };
}

function finalizeSubFirestore(sub, dateKey) {
  return {
    data: dateKey,
    subid: sub.subid,
    pedidos: sub.validOrders.size,
    qtd_itens: sub.itemsSold,
    faturamento: roundMoney(sub.gmv),
    comissoes: roundMoney(sub.commissionProjected),
    comissoes_estimadas: roundMoney(sub.commissionProjected),
    comissao_concluida: roundMoney(sub.commissionLiquidated),
    comissao_pendente: roundMoney(sub.commissionPending),
    vendas_diretas: sub.directItems,
    vendas_indiretas: sub.indirectItems,
  };
}

module.exports = {
  roundMoney,
  dedupePullNodes,
  groupNodesByConversionId,
  buildShopeePanelAppDayMap,
  aggregateShopeeRangePromosApp,
  aggregateShopeeRangeFromPull,
  mapDayEntryToAudit,
  dayEntryToFirestoreDoc,
  createEmptyDayEntry,
  finalizeSubFirestore,
  formatUnixToBRTDate,
  comissaoDoNode,
  nodeOnceCommission,
  comissaoNodeOnceGrupo,
  AGGREGATION_MODE,
};

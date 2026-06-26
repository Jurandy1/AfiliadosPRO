"use strict";

const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { normalizeSubId } = require("./normalizeSubId");

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function comissaoDoDia(x) {
  return Number(x?.comissao_estimada ?? x?.comissao_total ?? x?.comissao_real ?? 0);
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const first = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

function previousMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptySubidDayCell() {
  return {
    pedidos: 0,
    qtd_itens: 0,
    faturamento: 0,
    comissoes: 0,
    comissoes_estimadas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
    gasto_meta: 0,
    cliques_meta: 0,
    cliques_shopee: 0,
  };
}

function ensureSubidCell(subids, subidKey, date) {
  if (!subids[subidKey]) subids[subidKey] = {};
  if (!subids[subidKey][date]) subids[subidKey][date] = emptySubidDayCell();
  return subids[subidKey][date];
}

function ensurePainelDia(dias, date) {
  if (!dias[date]) {
    dias[date] = {
      comissao_estimada: 0,
      comissao_real: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
      comissao_cancelada: 0,
      faturamento: 0,
      gmv_total: 0,
      vendas: 0,
      pedidos: 0,
      pedidos_concluidos: 0,
      pedidos_pendentes: 0,
      pedidos_cancelados: 0,
      pedidos_nao_pagos: 0,
      comissao_nao_paga: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
      gasto_meta: 0,
      gasto_pin: 0,
      cliques_meta: 0,
      perdas_pedidos: 0,
      perdas_fat: 0,
      perdas_comissao: 0,
    };
  }
  return dias[date];
}

function rollupPerdasIntoDiasMap(dias, perdasRows) {
  if (!dias || !perdasRows?.length) return;
  const seenByDay = {};

  for (const date of Object.keys(dias)) {
    dias[date].perdas_pedidos = 0;
    dias[date].perdas_fat = 0;
    dias[date].perdas_comissao = 0;
  }

  for (const row of perdasRows) {
    const date = row.data;
    if (!date) continue;
    const dia = ensurePainelDia(dias, date);

    if (!seenByDay[date]) seenByDay[date] = new Set();
    const pedidoKey = row.orderId
      ? String(row.orderId)
      : `${row.conversionId || ""}_${row.itemId || ""}`;
    if (seenByDay[date].has(pedidoKey)) continue;
    seenByDay[date].add(pedidoKey);

    dia.perdas_pedidos += 1;
    dia.perdas_fat = roundMoney(
      (dia.perdas_fat || 0) + Number(row.faturamento_perdido || 0),
    );
    dia.perdas_comissao = roundMoney(
      (dia.perdas_comissao || 0) + Number(row.comissao_perdida || 0),
    );
  }
}

async function fetchAllSupabase(supabase, table, first, last) {
  let allData = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table)
      .select("*")
      .gte("data", first)
      .lte("data", last)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`[Supabase Fetch] table: ${table} | err: ${error.message}`);
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return allData;
}

/**
 * Reconstrói painel_resumo/{YYYY-MM} e subid_mensal/{YYYY-MM} a partir das coleções granulares no Supabase.
 */
async function rebuildMonthlyBuckets(db, supabase, monthKey) {
  const { first, last } = monthBounds(monthKey);

  if (!supabase) {
    throw new Error("[monthlyRollup] Supabase client is required for rebuildMonthlyBuckets");
  }

  const [shopeeRows, subidRows, metaRows, perdasRows, cliqueRows, produtoRows] = await Promise.all([
    fetchAllSupabase(supabase, "shopee_daily", first, last),
    fetchAllSupabase(supabase, "subid_daily", first, last),
    fetchAllSupabase(supabase, "meta_ads_daily", first, last),
    fetchAllSupabase(supabase, "log_perdas", first, last),
    fetchAllSupabase(supabase, "clique_daily", first, last),
    fetchAllSupabase(supabase, "produto_daily", first, last),
  ]);

  const shopeeSnap = shopeeRows.map(x => ({
    id: x.data,
    data: () => ({
      comissao_estimada: Number(x.comissao || 0),
      comissao_real: Number(x.comissao_real || x.comissao || 0),
      comissao_concluida: Number(x.comissao_concluida || 0),
      comissao_pendente: Number(x.comissao_pendente || 0),
      comissao_cancelada: Number(x.comissao_cancelada || 0),
      faturamento: Number(x.fat_bruto || 0),
      gmv_total: Number(x.fat_bruto || 0),
      vendas: Number(x.vendas || 0),
      pedidos: Number(x.pedidos || 0),
      pedidos_concluidos: Number(x.pedidos_completos || 0),
      pedidos_pendentes: Number(x.pedidos_pendentes || 0),
      pedidos_cancelados: Number(x.pedidos_cancelados || 0),
      pedidos_nao_pagos: Number(x.pedidos_nao_pagos || 0),
      comissao_nao_paga: Number(x.comissao_nao_paga || 0),
      vendas_diretas: Number(x.vendas_diretas || 0),
      vendas_indiretas: Number(x.vendas_indiretas || 0),
      perdas_pedidos: Number(x.perdas_pedidos || 0),
      perdas_fat: Number(x.perdas_fat || 0),
      perdas_comissao: Number(x.perdas_comissao || 0),
    })
  }));

  const subidSnap = subidRows.map(x => ({
    data: () => ({
      data: x.data,
      subid: x.subid,
      comissoes: Number(x.comissoes || 0),
      comissoes_estimadas: Number(x.comissoes_estimadas || 0),
      faturamento: Number(x.faturamento || 0),
      vendas_diretas: Number(x.vendas_diretas || 0),
      vendas_indiretas: Number(x.vendas_indiretas || 0),
      qtd_itens: Number(x.qtd_itens || 0),
      total_vendas: Number(x.total_vendas || 0),
      pedidos: Number(x.pedidos || 0),
      cliques_anuncio: Number(x.cliques_anuncio || 0),
      cliques_shopee: Number(x.cliques_shopee || 0),
    })
  }));

  const metaSnap = metaRows.map(x => ({
    data: () => ({
      data: x.data,
      subid: x.subid,
      nomeAnuncio: x.subid,
      valorUsado: Number(x.gasto || 0),
      cliquesTotal: Number(x.cliques || 0),
    })
  }));

  const perdasSnap = perdasRows.map(x => ({
    data: () => ({
      data: x.data,
      orderId: x.order_id,
      itemId: x.item_id,
      conversionId: x.conversion_id,
      subid: x.subid,
      comissao_perdida: Number(x.comissao_perdida || 0),
      faturamento_perdido: Number(x.valor_pedido || 0),
      motivo: x.motivo,
      itemNotes: x.item_notes,
    })
  }));

  const cliqueSnap = cliqueRows.map(x => ({
    data: () => ({
      data: x.data,
      subid: x.subid,
      cliques: Number(x.cliques || 0),
    })
  }));

  const produtoSnap = produtoRows.map(x => ({
    data: () => ({
      data: x.data,
      produto_id: x.item_id,
      nome: x.nome,
      comissao_estimada: Number(x.comissao || 0),
      comissoes_pendentes: Number(x.comissao_pendente || 0),
      comissoes_concluidas: Number(x.comissao_concluida || 0),
      qtd_itens: Number(x.qtd_itens || 0),
      faturamento: Number(x.faturamento || 0),
      cliques: Number(x.cliques || 0),
    })
  }));

  const dias = {};
  const subids = {};

  shopeeSnap.forEach((docSnap) => {
    const x = docSnap.data() || {};
    const date = docSnap.id;
    dias[date] = {
      comissao_estimada: comissaoDoDia(x),
      comissao_real: Number(x.comissao_real || 0),
      comissao_concluida: Number(x.comissao_concluida || 0),
      comissao_pendente: Number(x.comissao_pendente || 0),
      comissao_cancelada: Number(x.comissao_cancelada || 0),
      faturamento: Number(x.faturamento ?? x.gmv_total ?? 0),
      gmv_total: Number(x.gmv_total ?? x.faturamento ?? 0),
      vendas: Number(x.vendas || 0),
      pedidos: Number(x.pedidos || 0),
      pedidos_concluidos: Number(x.pedidos_concluidos || 0),
      pedidos_pendentes: Number(x.pedidos_pendentes || 0),
      pedidos_cancelados: Number(x.pedidos_cancelados || 0),
      pedidos_nao_pagos: Number(x.pedidos_nao_pagos || 0),
      comissao_nao_paga: roundMoney(x.comissao_nao_paga || 0),
      vendas_diretas: Number(x.vendas_diretas || 0),
      vendas_indiretas: Number(x.vendas_indiretas || 0),
      gasto_meta: 0,
      gasto_pin: 0,
      cliques_meta: 0,
      perdas_pedidos: Number(x.perdas_pedidos || 0),
      perdas_fat: roundMoney(x.perdas_fat || 0),
      perdas_comissao: roundMoney(x.perdas_comissao || 0),
    };
  });

  metaSnap.forEach((docSnap) => {
    const m = docSnap.data() || {};
    const date = m.data;
    if (!date || date < first || date > last) return;
    const subid = normalizeSubId(m.subid || m.nomeAnuncio || "");
    const gasto = Number(m.valorUsado || 0);
    const cliques = Number(m.cliquesTotal || 0);

    const dia = ensurePainelDia(dias, date);
    dia.gasto_meta = roundMoney((dia.gasto_meta || 0) + gasto);
    dia.cliques_meta += cliques;

    if (subid) {
      const cell = ensureSubidCell(subids, subid, date);
      cell.gasto_meta = roundMoney((cell.gasto_meta || 0) + gasto);
      cell.cliques_meta += cliques;
    }
  });

  subidSnap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const date = d.data;
    if (!date || date < first || date > last) return;
    const subidKey = normalizeSubId(String(d.subid || "").trim()) || String(d.subid || "").trim() || "ORGANICO";
    const cell = ensureSubidCell(subids, subidKey, date);
    cell.pedidos += Number(d.pedidos || 0);
    cell.qtd_itens += Number(d.qtd_itens || 0);
    cell.faturamento += Number(d.faturamento || 0);
    cell.comissoes += Number(d.comissoes || 0);
    cell.comissoes_estimadas += Number(d.comissoes_estimadas || d.comissoes || 0);
    cell.vendas_diretas += Number(d.vendas_diretas || 0);
    cell.vendas_indiretas += Number(d.vendas_indiretas || 0);
    if (d.subids_count != null) cell.subids_count = Number(d.subids_count);
  });

  cliqueSnap.forEach((docSnap) => {
    const c = docSnap.data() || {};
    const date = c.data;
    if (!date || date < first || date > last) return;
    const subid = normalizeSubId(c.subid || c.sub_id_norm || "");
    if (!subid) return;
    const cell = ensureSubidCell(subids, subid, date);
    cell.cliques_shopee += Number(c.cliques || 0);
  });

  const produtos = {};
  produtoSnap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const pid = String(d.produto_id || "").trim() || "desconhecido";
    if (!produtos[pid]) {
      produtos[pid] = {
        produto_id: pid,
        nome: d.nome || "Produto",
        comissao_estimada: 0,
        comissoes_pendentes: 0,
        comissoes_concluidas: 0,
        qtd_itens: 0,
        faturamento: 0,
        cliques: 0,
        sub_ids: new Set(),
        porDia: {},
      };
    }
    const p = produtos[pid];
    const com = Number(d.comissao_estimada ?? d.comissoes ?? 0);
    p.comissao_estimada = roundMoney(p.comissao_estimada + com);
    p.comissoes_pendentes = roundMoney(p.comissoes_pendentes + Number(d.comissoes_pendentes || 0));
    p.comissoes_concluidas = roundMoney(p.comissoes_concluidas + Number(d.comissoes_concluidas || 0));
    p.qtd_itens += Number(d.qtd_itens || 0);
    p.faturamento = roundMoney(p.faturamento + Number(d.faturamento || 0));
    p.cliques += Number(d.cliques || 0);
    if (d.sub_id) p.sub_ids.add(d.sub_id);
    if (Array.isArray(d.sub_ids)) d.sub_ids.forEach((s) => p.sub_ids.add(s));
    if (d.data) {
      if (!p.porDia[d.data]) {
        p.porDia[d.data] = { comissao_estimada: 0, qtd_itens: 0, faturamento: 0, cliques: 0 };
      }
      p.porDia[d.data].comissao_estimada = roundMoney(p.porDia[d.data].comissao_estimada + com);
      p.porDia[d.data].qtd_itens += Number(d.qtd_itens || 0);
      p.porDia[d.data].faturamento = roundMoney(p.porDia[d.data].faturamento + Number(d.faturamento || 0));
      p.porDia[d.data].cliques += Number(d.cliques || 0);
    }
  });

  const produtosArr = Object.values(produtos)
    .sort((a, b) => (b.comissao_estimada || 0) - (a.comissao_estimada || 0));
  const top300 = produtosArr.slice(0, 300).map((p) => ({
    produto_id: p.produto_id,
    nome: p.nome,
    comissao_estimada: p.comissao_estimada,
    comissoes_pendentes: p.comissoes_pendentes,
    comissoes_concluidas: p.comissoes_concluidas,
    qtd_itens: p.qtd_itens,
    faturamento: p.faturamento,
    cliques: p.cliques,
    sub_ids: [...p.sub_ids],
    porDia: p.porDia,
  }));
  const restantes = produtosArr.slice(300);
  if (restantes.length > 0) {
    const outros = {
      produto_id: "__OUTROS__",
      nome: "Outros",
      comissao_estimada: 0,
      comissoes_pendentes: 0,
      comissoes_concluidas: 0,
      qtd_itens: 0,
      faturamento: 0,
      cliques: 0,
      sub_ids: [],
      porDia: null,
    };
    for (const p of restantes) {
      outros.comissao_estimada = roundMoney(outros.comissao_estimada + p.comissao_estimada);
      outros.comissoes_pendentes = roundMoney(outros.comissoes_pendentes + p.comissoes_pendentes);
      outros.comissoes_concluidas = roundMoney(outros.comissoes_concluidas + p.comissoes_concluidas);
      outros.qtd_itens += p.qtd_itens;
      outros.faturamento = roundMoney(outros.faturamento + p.faturamento);
      outros.cliques += p.cliques;
    }
    top300.push(outros);
  }

  const mappedPerdas = [];
  perdasSnap.forEach((docSnap) => {
    mappedPerdas.push(docSnap.data() || {});
  });
  rollupPerdasIntoDiasMap(dias, mappedPerdas);

  const batch = db.batch();
  // merge:false — mapas aninhados (dias/subids) com merge:true deixam chaves antigas
  // (ex.: subid renomeado STORY---- → STORY) e inflam o bucket vs subid_daily.
  batch.set(db.collection("painel_resumo").doc(monthKey), {
    month: monthKey,
    dias,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("subid_mensal").doc(monthKey), {
    month: monthKey,
    subids,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("produto_mensal").doc(monthKey), {
    month: monthKey,
    produtos: top300,
    totalAgregados: produtosArr.length,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false });
  await batch.commit();

  return {
    monthKey,
    diasCount: Object.keys(dias).length,
    subidKeys: Object.keys(subids).length,
    subidDocs: subidSnap.length,
    perdasDocs: perdasSnap.length,
    produtoDocs: produtoSnap.length,
    produtoMensalCount: top300.length,
  };
}

function monthKeysForDates(dateStrs) {
  const keys = new Set();
  for (const d of dateStrs || []) {
    if (typeof d === "string" && d.length >= 7) keys.add(d.slice(0, 7));
  }
  return [...keys];
}

// PATCH C: lock em memória por mês.
// Evita rollups concorrentes do mesmo mês na mesma instância da Cloud Function.
const _rollupLocks = new Map();

async function withRollupLock(monthKey, fn) {
  while (_rollupLocks.has(monthKey)) {
    await _rollupLocks.get(monthKey).catch(() => null);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      _rollupLocks.delete(monthKey);
    }
  })();
  _rollupLocks.set(monthKey, promise);
  return promise;
}

/**
 * Atualiza buckets mensais a partir das coleções granulares.
 *
 * @param {Array<string>} dateStrs - datas no formato YYYY-MM-DD que foram tocadas
 * @param {Object} opts
 * @param {boolean} opts.reconcile - mantido para compatibilidade; sem efeito
 * @param {number} opts.throttleMs - se > 0, pula meses cujo painel_resumo foi atualizado há menos de throttleMs
 */
async function refreshMonthlyBucketsForDates(db, supabase, dateStrs, { reconcile = false, throttleMs = 0 } = {}) {
  // PATCH A: removida a expansão `previousMonthKey` em reconcile.
  // Se mudança retroativa atinge maio/abril, o dia afetado entra em dateStrs
  // pelo próprio runShopeeSync e o mês é reconstruído organicamente.
  void reconcile;

  const months = monthKeysForDates(dateStrs);
  const unique = [...new Set(months)].filter(Boolean).sort();
  const results = [];

  for (const monthKey of unique) {
    // PATCH B: throttle por mês usando painel_resumo.updatedAt como timestamp.
    if (throttleMs > 0) {
      try {
        const snap = await db.collection("painel_resumo").doc(monthKey).get();
        const lastTs = snap.exists ? (snap.data()?.updatedAt?.toMillis?.() || 0) : 0;
        if (lastTs > 0 && (Date.now() - lastTs) < throttleMs) {
          const ageMin = Math.round((Date.now() - lastTs) / 60000);
          console.log(`[monthlyRollup] ${monthKey} skip (throttle: rebuilt ${ageMin}min ago)`);
          results.push({ monthKey, skipped: "throttled", ageMs: Date.now() - lastTs });
          continue;
        }
      } catch (e) {
        console.warn(`[monthlyRollup] throttle check ${monthKey}:`, e?.message || e);
      }
    }

    try {
      // PATCH C: serializa rollups do mesmo mês na mesma instância
      const r = await withRollupLock(monthKey, () => rebuildMonthlyBuckets(db, supabase, monthKey));
      results.push(r);
    } catch (err) {
      console.warn(`[monthlyRollup] falha ${monthKey}:`, err?.message || err);
    }
  }
  return results;
}

module.exports = {
  rebuildMonthlyBuckets,
  refreshMonthlyBucketsForDates,
  monthBounds,
  previousMonthKey,
  monthKeysForDates,
};

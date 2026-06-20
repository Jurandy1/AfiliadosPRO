/**
 * Módulo para sincronização (Dual-Write) transparente do Firebase para o Supabase.
 * Intercepta as gravações do Firebase batch e replica para o Supabase.
 */

async function syncToSupabase(supabase, upserts, deletes) {
  if (!supabase) return;
  const startedAt = Date.now();

  try {
    let groupedUpserts = upserts;
    if (Array.isArray(upserts)) {
      groupedUpserts = {};
      for (const item of upserts) {
        const col = item.tabela || item.collection;
        if (!col) continue;
        if (!groupedUpserts[col]) groupedUpserts[col] = [];
        groupedUpserts[col].push(item);
      }
    }

    for (const collection of Object.keys(groupedUpserts)) {
      const rows = groupedUpserts[collection] || [];
      if (rows.length === 0) continue;

      let tabela = collection;
      let mappedRows = [];
      let onConflict = "id";

      switch (collection) {
        case "shopee_daily":
          tabela = "shopee_daily";
          onConflict = "data";
          mappedRows = rows.map(({ id, data }) => ({
            data: data.data || id,
            // CORREÇÃO: vendas = qtd_itens (total de itens vendidos), 
            // qtd_itens duplica vendas, e total separado de pedidos
            pedidos: Number(data.pedidos || 0),
            vendas: Number(data.vendas ?? data.qtd_itens ?? 0),
            qtd_itens: Number(data.vendas ?? data.qtd_itens ?? 0),
            vendas_diretas: Number(data.vendas_diretas || 0),
            vendas_indiretas: Number(data.vendas_indiretas || 0),
            comissao: Number(data.comissao_estimada ?? data.comissao_total ?? data.comissao ?? 0),
            comissao_concluida: Number(data.comissao_concluida || 0),
            comissao_pendente: Number(data.comissao_pendente || 0),
            comissao_cancelada: Number(data.comissao_cancelada ?? data.perdas_comissao ?? 0),
            fat_bruto: Number(data.faturamento ?? data.fat_bruto ?? data.gmv_total ?? 0),
            pedidos_pendentes: Number(data.pedidos_pendentes || 0),
            pedidos_cancelados: Number(data.pedidos_cancelados || 0),
            pedidos_completos: Number(data.pedidos_concluidos ?? data.pedidos_completos ?? 0),
            pedidos_nao_pagos: Number(data.pedidos_nao_pagos || 0),
            comissao_nao_paga: Number(data.comissao_nao_paga || 0),
            mcn_fee: Number(data.mcn_fee || 0),
            perdas_pedidos: Number(data.perdas_pedidos || 0),
            perdas_fat: Number(data.perdas_fat || 0),
            perdas_comissao: Number(data.perdas_comissao || 0),
            agg_mode: data.aggregation_mode || data.agg_mode || 'promosapp',
            ultima_sync: new Date().toISOString(),
          }));
          break;

        case "subid_daily":
          tabela = "subid_daily";
          onConflict = "data,subid";
          mappedRows = rows.map(({ id, data }) => ({
            data: data.data || id.split('_')[0],
            subid: data.subid || "(sem_subid)",
            comissoes: data.comissoes || data.comissao_real || data.comissao_total || 0,
            comissoes_estimadas: data.comissoes_estimadas || data.comissao_estimada || 0,
            faturamento: data.faturamento || data.gmv_total || 0,
            vendas_diretas: data.vendas_diretas || 0,
            vendas_indiretas: data.vendas_indiretas || 0,
            qtd_itens: data.qtd_itens || 0,
            total_vendas: data.total_vendas || data.vendas || 0,
            pedidos: data.pedidos || 0,
            cliques_anuncio: data.cliques_anuncio || 0,
            cliques_shopee: data.cliques_shopee || 0,
            ultima_sync: new Date().toISOString()
          }));
          break;

        case "produto_daily":
          tabela = "produto_daily";
          onConflict = "data,item_id";
          mappedRows = rows.map(({ data }) => ({
            data: data.data,
            item_id: String(data.produto_id || data.item_id || "desconhecido"),
            shop_id: data.shop_id || data.id_loja || null,
            nome: String(data.nome || "Produto"),
            comissao: Number(data.comissao_estimada ?? data.comissoes ?? 0),
            comissao_concluida: Number(data.comissoes_concluidas ?? data.comissao_concluida ?? 0),
            comissao_pendente: Number(data.comissoes_pendentes ?? data.comissao_pendente ?? 0),
            comissao_cancelada: Number(data.comissoes_canceladas ?? data.comissao_cancelada ?? 0),
            vendas: Math.round(Number(data.vendas ?? data.qtd_itens ?? 0)),
            qtd_itens: Math.round(Number(data.qtd_itens ?? 0)),
            faturamento: Number(data.faturamento ?? 0),
            cliques: Math.round(Number(data.cliques ?? 0)),
            ultima_sync: new Date().toISOString(),
          }));
          // Deduplicar no lote
          mappedRows = Object.values(mappedRows.reduce((acc, row) => {
            acc[`${row.data}_${row.item_id}`] = row;
            return acc;
          }, {}));
          break;

        case "log_perdas":
          tabela = "log_perdas";
          onConflict = "data,order_id,item_id,conversion_id";
          mappedRows = rows.map(({ data }) => ({
            data: data.data,
            order_id: String(data.orderId || data.order_id || "no"),
            item_id: String(data.itemId || data.item_id || "ni"),
            conversion_id: String(data.conversionId || data.conversion_id || "nc"),
            subid: data.subid || data.sub_id || null,
            comissao_perdida: Number(data.comissao_perdida ?? 0),
            valor_pedido: Number(data.faturamento_perdido ?? data.valor_pedido ?? 0),
            motivo: (String(data.status || data.motivo || "").trim() || null),
            item_notes: data.item_notes || data.itemNotes || null,
            detectado_em: new Date().toISOString(),
          }));
          // Deduplicar no lote
          mappedRows = Object.values(mappedRows.reduce((acc, row) => {
            acc[`${row.data}_${row.order_id}_${row.item_id}_${row.conversion_id}`] = row;
            return acc;
          }, {}));
          break;

        case "importacoes":
          tabela = "importacoes";
          onConflict = "id";
          mappedRows = rows.map(({ id, data }) => ({
            id,
            data_blob: data,
          }));
          break;

        case "meta_ads":
          tabela = "meta_ads";
          onConflict = "ad_id";
          mappedRows = rows.map(({ id, data }) => ({
            ...data,
            ad_id: id,
            updatedAt: new Date().toISOString()
          }));
          break;

        case "meta_ads_daily":
          tabela = "meta_ads_daily";
          onConflict = "data,subid,ad_id";
          mappedRows = rows.map(({ id, data }) => ({
            data: data.data || id.split('_')[0],
            subid: data.subid || '(sem_subid)',
            account_id: data.account_id || data._accountId || '',
            campaign_id: data.campaign_id || '',
            campaign_name: data.campaign_name || '',
            adset_id: data.adset_id || '',
            ad_id: String(data.adId || data.ad_id || ""),
            gasto: data.gasto || data.valorUsado || data.spend || 0,
            impressoes: data.impressoes || data.impressions || 0,
            cliques: data.cliques || data.cliquesTotal || data.clicks || 0,
            ctr: data.ctr || 0,
            cpc: data.cpc || 0,
            ultima_sync: new Date().toISOString()
          }));
          break;

        case "meta_demographics":
          tabela = "meta_demographics";
          onConflict = "id";
          mappedRows = rows.map(({ id, data }) => ({
            id,
            data_blob: data,
          }));
          break;

        case "sync_state":
          tabela = "sync_state";
          onConflict = "key";
          mappedRows = rows.map(({ id, data }) => ({
            key: id,
            data_blob: data,
          }));
          break;

        default:
          // Ignorar outras tabelas por enquanto
          continue;
      }

      if (mappedRows.length > 0) {
        // Enviar para o Supabase em lotes de 500 para evitar limites
        const BATCH_SIZE = 500;
        for (let i = 0; i < mappedRows.length; i += BATCH_SIZE) {
          const chunk = mappedRows.slice(i, i + BATCH_SIZE);
          // Converter FieldValue.serverTimestamp() para strings ISO
          const cleanChunk = chunk.map(cleanFirestoreTypes);
          
          const { error } = await supabase.from(tabela).upsert(cleanChunk, { onConflict });
          if (error) {
            console.error(`[SupabaseSync] Erro ao sincronizar ${tabela}:`, error.message);
          }
        }
      }
    }
  } catch (err) {
    console.error("[SupabaseSync] Falha na sincronização:", err?.message || err);
  }
}

function cleanFirestoreTypes(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanFirestoreTypes);

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    // Remover ou converter Sentinel objects do Firestore
    if (val && typeof val === "object" && val.constructor && val.constructor.name === "FieldValue") {
      if (val.isEqual && val.isEqual(require("firebase-admin").firestore.FieldValue.serverTimestamp())) {
        clean[key] = new Date().toISOString();
      } else {
        // Ignorar outros FieldValues como increment por enquanto, pois o payload do `merge`
        // idealmente já vem com os valores absolutos após os gets, ou o upsert vai sobrescrever.
        // No contexto atual, os 'increments' são problemáticos para replicação cega,
        // mas as tabelas *_daily da Shopee são atualizadas por replace absoluto no modo padrão.
        continue;
      }
    } else if (val && typeof val === "object" && val.toDate) {
      // É um Timestamp
      clean[key] = val.toDate().toISOString();
    } else {
      clean[key] = cleanFirestoreTypes(val);
    }
  }
  return clean;
}

module.exports = { syncToSupabase };

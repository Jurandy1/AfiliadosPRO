/**
 * Módulo para sincronização (Dual-Write) transparente do Firebase para o Supabase.
 * Intercepta as gravações do Firebase batch e replica para o Supabase.
 */

async function syncToSupabase(supabase, upserts, deletes) {
  if (!supabase) return;
  const startedAt = Date.now();

  try {
    for (const collection of Object.keys(upserts)) {
      const rows = upserts[collection] || [];
      if (rows.length === 0) continue;

      let tabela = collection;
      let mappedRows = [];
      let onConflict = "id";

      switch (collection) {
        case "shopee_daily":
          tabela = "shopee_daily";
          onConflict = "data";
          mappedRows = rows.map(({ id, data }) => ({
            ...data,
            data: data.data || id,
            updatedAt: new Date().toISOString()
          }));
          break;

        case "subid_daily":
          tabela = "subid_daily";
          onConflict = "data,subid";
          mappedRows = rows.map(({ data }) => ({
            ...data,
            subid: data.subid || "(sem_subid)",
            updatedAt: new Date().toISOString()
          }));
          break;

        case "produto_daily":
          tabela = "produto_daily";
          onConflict = "data,item_id";
          mappedRows = rows.map(({ data }) => ({
            ...data,
            item_id: String(data.produto_id || data.item_id || ""),
            updatedAt: new Date().toISOString()
          }));
          break;

        case "log_perdas":
          tabela = "log_perdas";
          onConflict = "data,order_id,item_id";
          mappedRows = rows.map(({ data }) => ({
            ...data,
            updatedAt: new Date().toISOString()
          }));
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
          mappedRows = rows.map(({ data }) => ({
            ...data,
            ad_id: String(data.adId || data.ad_id || ""),
            subid: data.subid || "(sem_subid)",
            updatedAt: new Date().toISOString()
          }));
          // Remove adId from payload se existir, o Supabase espera ad_id
          mappedRows.forEach(r => delete r.adId);
          break;

        case "meta_demographics":
          tabela = "meta_demographics";
          onConflict = "id";
          mappedRows = rows.map(({ id, data }) => ({
            id,
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

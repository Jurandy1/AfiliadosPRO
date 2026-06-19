/**
 * Pinterest Ads - leitura do Supabase.
 */

import { supabase } from "../../../services/supabase/client";

export async function getPinterest(importacaoId = null) {
  let query = supabase.from("pinterest_ads").select("ad_id, data_blob");
  if (importacaoId) {
    query = query.eq("data_blob->>importacaoId", importacaoId);
  }
  const { data: snap, error } = await query;
  if (error) {
    console.warn("Erro lendo pinterest_ads:", error);
    return [];
  }
  return (snap || []).map((d) => ({ id: d.ad_id, ...(d.data_blob || {}) }));
}

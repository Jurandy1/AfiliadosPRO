import { supabase } from "../../services/supabase/client";
import { normalizeSubId } from "../../utils/normalizeSubId";
import { invalidateProdutosCache } from "../../platforms/shopee/repositories/productsRepository";
import { invalidateAllPeriodCaches } from "../../platforms/dashboard/services/periodDataCache";

export async function linkCliquesToProdutos() {
  const [{ data: cliquesSnap }, { data: prodSnap }] = await Promise.all([
    supabase.from("cliques_shopee").select("id, data_blob"),
    supabase.from("produtos").select("id, data_blob")
  ]);

  const cliquesIndex = {};
  (cliquesSnap || []).forEach((d) => {
    const data = d.data_blob || {};
    const norm = data.sub_id_norm || normalizeSubId(data.sub_id || "");
    if (norm) cliquesIndex[norm] = (cliquesIndex[norm] || 0) + (data.cliques || 0);
  });

  const updates = [];
  
  (prodSnap || []).forEach((docSnap) => {
    const prod = docSnap.data_blob || {};
    const sub_ids = prod.sub_ids || (prod.sub_id ? [prod.sub_id] : []);
    if (!sub_ids.length) return;

    const cliquesTotal = sub_ids.reduce(
      (sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0),
      0,
    );
    
    if (prod.cliques !== cliquesTotal) {
      prod.cliques = cliquesTotal;
      updates.push({ id: docSnap.id, data_blob: prod, updated_at: new Date().toISOString() });
    }
  });

  for (let i = 0; i < updates.length; i += 1000) {
    await supabase.from("produtos").upsert(updates.slice(i, i + 1000));
  }

  if (updates.length > 0) {
    invalidateProdutosCache();
    invalidateAllPeriodCaches();
  }
  return {
    produtosAtualizados: updates.length,
    subIdsIndexados: Object.keys(cliquesIndex).length,
  };
}

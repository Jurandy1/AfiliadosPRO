import { supabase } from "../../services/supabase/client";
import { normalizeSubId } from "../../utils/normalizeSubId";
import { invalidateProdutosCache } from "../../platforms/shopee/repositories/productsRepository";
import { invalidateAllPeriodCaches } from "../../platforms/dashboard/services/periodDataCache";

export async function linkCliquesToProdutos() {
  // Lê clique_daily (schema Supabase: data, subid, cliques)
  const { data: cliquesSnap, error: cliquesError } = await supabase
    .from("clique_daily")
    .select("subid, cliques");

  if (cliquesError) {
    console.warn("[linkCliques] Erro ao buscar clique_daily:", cliquesError.message);
    return { produtosAtualizados: 0, subIdsIndexados: 0 };
  }

  // Agrupa cliques por subid normalizado
  const cliquesIndex = {};
  (cliquesSnap || []).forEach((row) => {
    const norm = normalizeSubId(row.subid || "");
    if (norm) cliquesIndex[norm] = (cliquesIndex[norm] || 0) + Number(row.cliques || 0);
  });

  // Lê produtos com sub_ids preenchidos (schema Supabase: doc_id, sub_ids, cliques)
  const { data: prodSnap, error: prodError } = await supabase
    .from("produtos")
    .select("doc_id, sub_ids, cliques")
    .not("sub_ids", "is", null);

  if (prodError) {
    console.warn("[linkCliques] Erro ao buscar produtos:", prodError.message);
    return { produtosAtualizados: 0, subIdsIndexados: Object.keys(cliquesIndex).length };
  }

  const updates = [];

  (prodSnap || []).forEach((prod) => {
    const sub_ids = Array.isArray(prod.sub_ids) ? prod.sub_ids : [];
    if (!sub_ids.length) return;

    const cliquesTotal = sub_ids.reduce(
      (sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0),
      0,
    );

    if (prod.cliques !== cliquesTotal) {
      updates.push({
        doc_id: prod.doc_id,
        cliques: cliquesTotal,
        updated_at: new Date().toISOString(),
      });
    }
  });

  for (let i = 0; i < updates.length; i += 1000) {
    await supabase
      .from("produtos")
      .upsert(updates.slice(i, i + 1000), { onConflict: "doc_id" });
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

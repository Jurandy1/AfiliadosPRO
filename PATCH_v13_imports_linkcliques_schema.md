# PATCH v13 — Corrige schema Supabase em importsRepository + linkCliquesToProdutos

## Arquivo 1: `src/domain/reconciliation/linkCliquesToProdutos.js`

Substitui o arquivo INTEIRO por:

```js
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
```

---

## Arquivo 2: `src/platforms/imports/repositories/importsRepository.js`

### Troca 1 — `cleanupImportedDataByTipo` para `shopee_clique`

**Localiza (exatamente):**
```js
  if (tipo === "shopee_clique") {
    const cliquesRemovidos = await deleteCollectionDocs("cliques_shopee");
    const cliqueDailyRemovidos = await deleteCollectionDocs("clique_daily");
    
    // Zera os cliques nos produtos
    const { data: prodSnap } = await supabase.from("produtos").select("id, data_blob");
    const toUpdate = (prodSnap || []).filter(p => (p.data_blob?.cliques || 0) > 0).map(p => {
       p.data_blob.cliques = 0;
       return { id: p.id, data_blob: p.data_blob, updated_at: new Date().toISOString() };
    });
    if (toUpdate.length > 0) {
      await supabase.from("produtos").upsert(toUpdate);
    }
    
    invalidateDashboardCaches();
    return { cliquesRemovidos, cliqueDailyRemovidos };
  }
```

**Substitui por:**
```js
  if (tipo === "shopee_clique") {
    const cliqueDailyRemovidos = await deleteCollectionDocs("clique_daily");

    // Zera os cliques nos produtos (schema Supabase: doc_id, cliques)
    const { data: prodSnap } = await supabase
      .from("produtos")
      .select("doc_id, cliques")
      .gt("cliques", 0);
    const toUpdate = (prodSnap || []).map(p => ({
      doc_id: p.doc_id,
      cliques: 0,
      updated_at: new Date().toISOString(),
    }));
    if (toUpdate.length > 0) {
      await supabase.from("produtos").upsert(toUpdate, { onConflict: "doc_id" });
    }

    invalidateDashboardCaches();
    return { cliqueDailyRemovidos };
  }
```

### Troca 2 — `cleanupImportedDataByTipo` para `meta_ads`

**Localiza (exatamente):**
```js
  if (tipo === "meta_ads") {
    const metaRemovidos = await deleteCollectionDocs("meta_ads");
    // limpa referencias nos produtos
    const { data: prodSnap } = await supabase.from("produtos").select("id, data_blob");
    const toUpdate = (prodSnap || []).filter(p => (p.data_blob?.investimento || 0) > 0).map(p => {
       p.data_blob.metaAdIds = [];
       p.data_blob.investimento = 0; // simplified
       return { id: p.id, data_blob: p.data_blob, updated_at: new Date().toISOString() };
    });
    if (toUpdate.length > 0) await supabase.from("produtos").upsert(toUpdate);
    invalidateDashboardCaches();
    return { metaRemovidos };
  }
```

**Substitui por:**
```js
  if (tipo === "meta_ads") {
    const metaRemovidos = await deleteCollectionDocs("meta_ads");

    // Limpa referências nos produtos (schema Supabase)
    const { data: prodSnap } = await supabase
      .from("produtos")
      .select("doc_id")
      .gt("investimento", 0);
    const toUpdate = (prodSnap || []).map(p => ({
      doc_id: p.doc_id,
      meta_ad_ids: [],
      investimento: 0,
      updated_at: new Date().toISOString(),
    }));
    if (toUpdate.length > 0) {
      await supabase.from("produtos").upsert(toUpdate, { onConflict: "doc_id" });
    }
    invalidateDashboardCaches();
    return { metaRemovidos };
  }
```

### Troca 3 — `cleanupImportedDataByTipo` para `pinterest`

**Localiza (exatamente):**
```js
  if (tipo === "pinterest") {
    const pinterestRemovidos = await deleteCollectionDocs("pinterest_ads");
    // limpa referencias nos produtos
    const { data: prodSnap } = await supabase.from("produtos").select("id, data_blob");
    const toUpdate = (prodSnap || []).filter(p => (p.data_blob?.investimento || 0) > 0).map(p => {
       p.data_blob.pinterestAdIds = [];
       p.data_blob.investimento = 0; // simplified
       return { id: p.id, data_blob: p.data_blob, updated_at: new Date().toISOString() };
    });
    if (toUpdate.length > 0) await supabase.from("produtos").upsert(toUpdate);
    invalidateDashboardCaches();
    return { pinterestRemovidos };
  }
```

**Substitui por:**
```js
  if (tipo === "pinterest") {
    const pinterestRemovidos = await deleteCollectionDocs("pinterest_ads");

    // Limpa referências nos produtos (schema Supabase)
    const { data: prodSnap } = await supabase
      .from("produtos")
      .select("doc_id")
      .gt("investimento", 0);
    const toUpdate = (prodSnap || []).map(p => ({
      doc_id: p.doc_id,
      pinterest_ad_ids: [],
      investimento: 0,
      updated_at: new Date().toISOString(),
    }));
    if (toUpdate.length > 0) {
      await supabase.from("produtos").upsert(toUpdate, { onConflict: "doc_id" });
    }
    invalidateDashboardCaches();
    return { pinterestRemovidos };
  }
```

### Troca 4 — `removerHistoricoShopeeVendas`

**Localiza (exatamente):**
```js
export async function removerHistoricoShopeeVendas() {
  const { data } = await supabase.from("importacoes").delete().eq("data_blob->>tipo", "shopee_venda").select("id");
  return data ? data.length : 0;
}
```

**Substitui por:**
```js
export async function removerHistoricoShopeeVendas() {
  // importacoes tem campo tipo direto (não dentro de data_blob)
  const { data } = await supabase
    .from("importacoes")
    .delete()
    .eq("tipo", "shopee_venda")
    .select("id");
  return data ? data.length : 0;
}
```

### Troca 5 — `clique_daily` onConflict

**Localiza (exatamente):**
```js
  for (let i = 0; i < supabaseRows.length; i += 1000) {
    await supabase.from("clique_daily").upsert(supabaseRows.slice(i, i + 1000));
  }
```

**Substitui por:**
```js
  for (let i = 0; i < supabaseRows.length; i += 1000) {
    await supabase.from("clique_daily").upsert(supabaseRows.slice(i, i + 1000), {
      onConflict: "data,subid"
    });
  }
```

---

## Commit e push

```powershell
cd C:\Users\PC\Music\Afiliadoteste-Superbase
git add src/domain/reconciliation/linkCliquesToProdutos.js
git add src/platforms/imports/repositories/importsRepository.js
git commit -m "fix v13: linkCliques + importsRepository usam schema Supabase (sem data_blob)"
git push
```

---

## SQL — apaga shopee_daily futuras zeradas

```sql
DELETE FROM shopee_daily
WHERE data > '2026-06-20'
  AND pedidos = 0
  AND comissao = 0;
```

---

## Após aplicar

Testa na tela **Importar**:
1. Sobe CSV de cliques → deve importar sem erro
2. Clica **Reconciliar Cliques** → deve atualizar cliques nos produtos
3. Testa **Remover** em alguma importação antiga → não deve quebrar

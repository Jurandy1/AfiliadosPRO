# PATCH SYNC v4 (REVISADO) — Replicar sync_state usando coluna `key`

## Por que esse patch substitui o v4 anterior

O v4 que mandei usava `id` como nome da coluna no Supabase. Errado: a coluna real é `key`. Mesmo bug no frontend (`getSyncHealthStatus`) — por isso o painel mostra "—" mesmo antes do dual-write.

São **3 arquivos** pra editar.

---

## 1️⃣ `functions/lib/supabaseSync.js`

**Localizar** o `case "sync_state":` e substituir o case inteiro por:

```js
        case "sync_state":
          tabela = "sync_state";
          onConflict = "key";
          mappedRows = rows.map(({ id, data }) => ({
            key: id,
            data_blob: data,
          }));
          break;
```

(mudança: `onConflict: "id"` → `"key"`, e payload `id` → `key`)

---

## 2️⃣ `functions/index.js`

### Adicionar helper ANTES de `touchShopeeSyncHealth`

```js
/**
 * Replica um update de sync_state pro Supabase, fazendo merge com o doc existente.
 * Coluna real no Supabase é `key`, não `id`.
 */
async function syncStateToSupabase(docId, patch) {
  if (!supabase || !docId || !patch || typeof patch !== "object") return;
  try {
    const cleanPatch = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val == null) {
        cleanPatch[k] = null;
        continue;
      }
      if (typeof val === "object" && val.constructor && val.constructor.name === "FieldValue") {
        try {
          if (val.isEqual && val.isEqual(FieldValue.serverTimestamp())) {
            cleanPatch[k] = new Date().toISOString();
            continue;
          }
        } catch { /* ignore */ }
        continue;
      }
      if (typeof val === "object" && typeof val.toDate === "function") {
        cleanPatch[k] = val.toDate().toISOString();
        continue;
      }
      cleanPatch[k] = val;
    }
    cleanPatch.updatedAt = new Date().toISOString();

    const { data: existing } = await supabase
      .from("sync_state")
      .select("data_blob")
      .eq("key", docId)
      .maybeSingle();

    const merged = { ...(existing?.data_blob || {}), ...cleanPatch };

    const { error } = await supabase
      .from("sync_state")
      .upsert({ key: docId, data_blob: merged }, { onConflict: "key" });

    if (error) {
      console.error(`[SupabaseSync] sync_state/${docId} upsert falhou:`, error.message);
    }
  } catch (err) {
    console.error(`[SupabaseSync] sync_state/${docId} erro:`, err?.message || err);
  }
}
```

### Substituir `touchShopeeSyncHealth` por:

```js
async function touchShopeeSyncHealth(patch) {
  await db.collection("sync_state").doc("shopee_health").set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await syncStateToSupabase("shopee_health", patch).catch(() => null);
}
```

### Substituir `touchMetaSyncHealth` por:

```js
async function touchMetaSyncHealth(patch) {
  await db.collection("sync_state").doc("meta_health").set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await syncStateToSupabase("meta_health", patch).catch(() => null);
}
```

---

## 3️⃣ `src/platforms/dashboard/repositories/metricsRepository.js`

**Localizar a função `getSyncHealthStatus`** (busca por `getSyncHealthStatus`). Tem 2 linhas com `eq("id", ...)`. **Trocar `"id"` por `"key"`**:

**Antes:**
```js
    const [shopeeSnap, metaSnap, ultimaHoje] = await Promise.all([
      supabase.from("sync_state").select("data_blob").eq("id", "shopee_health").single().then(r => r.data || null).catch(() => null),
      supabase.from("sync_state").select("data_blob").eq("id", "meta_health").single().then(r => r.data || null).catch(() => null),
      getUltimaAtualizacaoHoje(),
    ]);
```

**Depois:**
```js
    const [shopeeSnap, metaSnap, ultimaHoje] = await Promise.all([
      supabase.from("sync_state").select("data_blob").eq("key", "shopee_health").single().then(r => r.data || null).catch(() => null),
      supabase.from("sync_state").select("data_blob").eq("key", "meta_health").single().then(r => r.data || null).catch(() => null),
      getUltimaAtualizacaoHoje(),
    ]);
```

---

## Deploy

### Backend
```powershell
cd C:\Users\PC\Music\Afiliadoteste-Superbase
firebase deploy --only functions
```

### Frontend
Se você tá usando o Vercel pra hospedar:
```powershell
cd C:\Users\PC\Music\Afiliadoteste-Superbase
git add -A
git commit -m "fix: sync_state usa coluna key no Supabase"
git push
```

Vercel rebuilda sozinho.

---

## Verificação

### A) Confirma que a coluna existe e tem dados

```sql
SELECT key, jsonb_object_keys(data_blob) AS campo
FROM sync_state
WHERE key IN ('shopee_health', 'meta_health')
ORDER BY key;
```

Antes do patch + deploy: 0 linhas.
Depois do patch + deploy + 1 cron rodando: várias linhas por key, mostrando campos do JSONB.

### B) Vê o conteúdo

```sql
SELECT 
  key,
  data_blob ->> 'aggregationMode' AS agg_mode,
  data_blob ->> 'lastIncrementalAt' AS last_incremental,
  data_blob ->> 'lastRecent3dAt' AS last_recent3d,
  data_blob ->> 'updatedAt' AS atualizado
FROM sync_state 
WHERE key = 'shopee_health';

SELECT 
  key,
  data_blob ->> 'lastDailySyncAt' AS last_daily,
  data_blob ->> 'lastAdsSyncAt' AS last_ads,
  data_blob ->> 'updatedAt' AS atualizado
FROM sync_state 
WHERE key = 'meta_health';
```

### C) Painel no app
Recarrega o `SyncStatusPanel`. Vai mostrar timestamps reais, gradualmente preenchendo conforme cada cron roda.

---

## ⚠️ Importante

- O painel **só vai começar a popular gradualmente** conforme os crons rodam. `shopeeRecentDaysSync` (a cada 6h) preenche primeiro, depois `shopeeIncrementalSync`, depois `shopeeDailyReconcile` (04h BRT). Em até 24h tudo aparece.
- Pra **forçar** os campos do shopee_health rapidamente, dispara:
  ```powershell
  curl -X POST -H "Authorization: Bearer SEU_META_SYNC_SECRET" -H "Content-Length: 0" "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?days=3&force=1"
  ```
  Mas isso só popula `aggregationMode` e `dataVersion` — os `lastXxxAt` só vêm dos crons agendados mesmo.

---

## Schema fica claro pra futuras pesquisas

Tabela `sync_state` no Supabase tem 7 colunas:
- `key` text NOT NULL — chave única (`shopee_health`, `meta_health`, `daily_versions`, etc.)
- `last_cursor` text NULL — cursor da última sync (Shopee usa pra incremental)
- `last_run_at` timestamptz NULL — última execução
- `last_success_at` timestamptz NULL — último sucesso
- `last_error` text NULL — última mensagem de erro
- `health` text NULL — status agregado ("ok" / "error" / "warn")
- `data_blob` jsonb NULL — payload completo (é o que `data_blob ->> 'lastIncrementalAt'` lê)

Esse patch só popula `key` e `data_blob`. As outras colunas (`last_run_at`, `health`, etc.) ficam NULL — não impacta o painel atual, mas se quiser usar essas colunas estruturadas no futuro, dá pra estender o `syncStateToSupabase`.

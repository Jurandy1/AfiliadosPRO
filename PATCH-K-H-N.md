# Patch K + H' + N — Schedulers + Reconcile 5d + Cache de coleções diárias

**Projeto:** AffiliateHub Pro
**Arquivos:** `functions/index.js` (K + H'), `src/platforms/dashboard/cache/dailyRangeCache.js` (novo, N), `src/platforms/dashboard/repositories/metricsRepository.js` (N)
**Economia esperada:** ~22-28k reads/dia
**Risco:** baixo
**Dependência:** aplicar G + M primeiro (já feito)

---

## Resumo dos 3 patches

| Patch | O que faz | Onde | Economia/dia |
|---|---|---|---|
| **K** | Reduz cron de 3 schedulers | `functions/index.js` (3 linhas) | ~5k reads |
| **H'** | Reconcile diário 15d → 5d | `functions/index.js` (2 linhas) | ~8k reads |
| **N** | Cache LRU + dedup pra `shopee_daily`, `subid_daily`, `clique_daily` | 1 arquivo novo + ~10 modificações | ~10-15k reads |

**Projeção pós-aplicação:** dos ~90-100k atuais (com G + M) → **~62-72k/dia**.

---

# PATCH K — Reduzir frequência de schedulers

## Por que

Os schedulers `recent_3d` (6×/dia), `month_auto` (4×/dia) e `metaDailyRecentSync` (6×/dia) rodam mais do que precisam. Para dados de afiliados, refresh a cada 6h é tão útil quanto a cada 4h.

**Atenção:** mantemos `shopeeIncrementalSync` em 4×/dia (cursor de pull frequente, importante pra detecção rápida de novos pedidos) e `shopeeDailyReconcile` em 1×/dia (garantia mínima).

## O que muda

No arquivo `functions/index.js`:

### Mudança K.1 — `shopeeRecentDaysSync`

**Procure:**
```js
exports.shopeeRecentDaysSync = onSchedule(
  {
    schedule: "0 */4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
```

**Substitua por:**
```js
exports.shopeeRecentDaysSync = onSchedule(
  {
    // PATCH K: 6×/dia → 4×/dia (00h, 06h, 12h, 18h BRT).
    // Mantém cobertura suficiente pra refletir vendas atrasadas no painel,
    // mas economiza 33% das execuções diárias.
    schedule: "0 */6 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
```

### Mudança K.2 — `shopeeMonthAutoSync`

**Procure:**
```js
exports.shopeeMonthAutoSync = onSchedule(
  {
    schedule: "30 1,7,13,19 * * *",
    timeZone: "America/Sao_Paulo",
```

**Substitua por:**
```js
exports.shopeeMonthAutoSync = onSchedule(
  {
    // PATCH K: 4×/dia → 2×/dia (01:30, 13:30 BRT). Chunks do mês corrente
    // não precisam rodar tantas vezes; reconcile diário + recent_3d cobrem.
    schedule: "30 1,13 * * *",
    timeZone: "America/Sao_Paulo",
```

### Mudança K.3 — `metaDailyRecentSync`

**Procure:**
```js
exports.metaDailyRecentSync = onSchedule(
  {
    schedule: "0 */4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
```

**Substitua por:**
```js
exports.metaDailyRecentSync = onSchedule(
  {
    // PATCH K: 6×/dia → 4×/dia. Gasto diário Meta muda devagar dentro do dia
    // (a Meta consolida fechamento em batches), 6h entre refreshes basta.
    schedule: "0 */6 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
```

## Validação K

Após deploy, logs do Cloud Functions devem mostrar:
- `shopeeRecentDaysSync` executando 4×/dia (a cada 6h)
- `shopeeMonthAutoSync` executando 2×/dia (01:30 e 13:30 BRT)
- `metaDailyRecentSync` executando 4×/dia

---

# PATCH H' — Reconcile diário de 15 dias para 5 dias

## Por que

O `shopeeDailyReconcile` roda 1×/dia às 04h BRT e re-sincroniza 15 dias. Cada dia faz ~800 docs de prefetch em `produto_daily`, totalizando ~12k reads/dia.

**Mas dados de 6-15 dias atrás raramente mudam:**
- Atraso típico de atribuição Shopee: 24-72h (no máximo).
- Reconciliações tardias são pegas pelo `shopeeMonthAutoSync` (que cobre o mês corrente em chunks).

Reduzir o reconcile diário pra 5 dias mantém a janela crítica coberta e corta ~8k reads/dia.

## O que muda

### Mudança H'.1 — Range do reconcile

No arquivo `functions/index.js`, **procure**:

```js
exports.shopeeDailyReconcile = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 15 * 86400;
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "reconcile_15d",
        updateCursor: false, // reconcile não mexe no cursor do incremental
        forceReplace: true,
        updateDaily: true,
        dailyOnly: true,
      });
```

**Substitua por:**

```js
exports.shopeeDailyReconcile = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    // PATCH H': 15 dias → 5 dias. Dias 6-15 raramente mudam após o atraso
    // típico de atribuição da Shopee (24-72h). monthAutoSync cobre o resto.
    // Economia: ~8k reads/dia em produto_daily prefetch.
    const start = now - 5 * 86400;
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "reconcile_5d",
        updateCursor: false, // reconcile não mexe no cursor do incremental
        forceReplace: true,
        updateDaily: true,
        dailyOnly: true,
      });
```

### Mudança H'.2 — Campo de saúde

No mesmo arquivo, **logo abaixo do `await runShopeeSync(...)` acima**, **procure**:

```js
      await touchShopeeSyncHealth({
        lastReconcile15dAt: FieldValue.serverTimestamp(),
        aggregationMode: shopeeAggModeHealthLabel(),
        lastReconcile15dError: null,
        lastReconcile15dFailedAt: null,
      });
    } catch (e) {
      console.error("[shopee] reconcile falhou:", e?.message || e);
      await touchShopeeSyncHealth({
        lastReconcile15dError: String(e?.message || e),
        lastReconcile15dFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);
```

**Substitua por:**

```js
      await touchShopeeSyncHealth({
        // PATCH H': mantém nome _15d do campo pra não quebrar UI que lê
        // sync_state/shopee_health. Agora cobre 5 dias.
        lastReconcile15dAt: FieldValue.serverTimestamp(),
        aggregationMode: shopeeAggModeHealthLabel(),
        lastReconcile15dError: null,
        lastReconcile15dFailedAt: null,
      });
    } catch (e) {
      console.error("[shopee] reconcile falhou:", e?.message || e);
      await touchShopeeSyncHealth({
        lastReconcile15dError: String(e?.message || e),
        lastReconcile15dFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);
```

(O campo `lastReconcile15dAt` é mantido pra compatibilidade com a UI da aba "Status e sincronização".)

## Deploy K + H'

```
firebase deploy --only functions:shopeeRecentDaysSync,functions:shopeeMonthAutoSync,functions:metaDailyRecentSync,functions:shopeeDailyReconcile
```

## Validação K + H'

Amanhã às 22h BRT, ler `[shopee] fim reconcile_5d` (em vez de `reconcile_15d`) com `nodes` bem menor que antes. E nos logs do `[monthlyRollup]` deve aparecer menos rebuilds vindos de schedulers.

---

# PATCH N — Cache LRU + in-flight dedup pra coleções diárias

## Por que

Hoje numa única sessão de "Este mês":

```
shopee_daily   60 docs (8×) ← lido 8 vezes em sequência
subid_daily  1582 docs (2×) ← duplicação entre caminhos
clique_daily 1660 docs (2×) ← duplicação entre caminhos
```

Cada função (`fetchShopeeDailyDocsForRange`, `agregarKPIsDeSubIdDaily`, `montarBundleGranular`, `sumSplitShopeeDailyPeriodo`, etc) lê independentemente sem cache compartilhado.

Aplicando o mesmo padrão LRU + in-flight dedup do Patch M:

| Coleção | Antes/sessão | Depois/sessão |
|---|---|---|
| shopee_daily | ~120 | ~15 |
| subid_daily | ~1582 | ~791 |
| clique_daily | ~1660 | ~830 |

## N.1 — Criar arquivo novo de cache

**Crie o arquivo `src/platforms/dashboard/cache/dailyRangeCache.js` com este conteúdo:**

```js
/**
 * dailyRangeCache.js
 *
 * Cache LRU + in-flight dedup para coleções "date-bucketed" lidas por range.
 * Aplica o mesmo padrão do metaAdsDailyCache.js a shopee_daily, subid_daily
 * e clique_daily — coleções lidas múltiplas vezes na mesma sessão por
 * caminhos paralelos do dashboard.
 *
 * Cada coleção tem seu próprio Map LRU. TTL curto (60s) protege contra
 * repico no mesmo render cycle sem segurar dados velhos.
 *
 * Para invalidar (ex.: após backfill manual), chame
 * invalidateDailyRangeCache() ou invalidateDailyRangeCache("subid_daily").
 */
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../services/firebase/client";

const TTL_MS = 60_000;
const MAX_SLOTS = 6;

const _caches = new Map();   // collectionName → Map<key, {data, ts}>
const _inFlight = new Map(); // `${collectionName}|${key}` → Promise

function getCache(collectionName) {
  if (!_caches.has(collectionName)) _caches.set(collectionName, new Map());
  return _caches.get(collectionName);
}

function lruGet(collectionName, key) {
  const cache = getCache(collectionName);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function lruSet(collectionName, key, data) {
  const cache = getCache(collectionName);
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { data, ts: Date.now() });
  while (cache.size > MAX_SLOTS) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export function invalidateDailyRangeCache(collectionName = null) {
  if (collectionName) {
    _caches.delete(collectionName);
    for (const k of [..._inFlight.keys()]) {
      if (k.startsWith(`${collectionName}|`)) _inFlight.delete(k);
    }
  } else {
    _caches.clear();
    _inFlight.clear();
  }
}

/**
 * Lê coleção range-bucketed por `data` (campo) entre startDate/endDate (YYYY-MM-DD).
 * Retorna array de objetos `{ id, ...data }`. NÃO retorna snapshot do Firestore.
 */
async function fetchByDataField(collectionName, startDate, endDate) {
  const q = query(
    collection(db, collectionName),
    where("data", ">=", startDate),
    where("data", "<=", endDate),
  );
  const snap = await getDocs(q).catch(() => ({ forEach: () => {} }));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

/**
 * Wrapper genérico com LRU + in-flight dedup.
 * fetchFn deve retornar array de objetos.
 */
async function cachedFetch(collectionName, key, fetchFn) {
  const cached = lruGet(collectionName, key);
  if (cached) return cached;

  const flightKey = `${collectionName}|${key}`;
  const pending = _inFlight.get(flightKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const data = await fetchFn();
      lruSet(collectionName, key, data);
      return data;
    } finally {
      _inFlight.delete(flightKey);
    }
  })();

  _inFlight.set(flightKey, promise);
  return promise;
}

/** subid_daily com cache. */
export async function fetchSubIdDailyForRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const key = `${startDate}|${endDate}`;
  return cachedFetch("subid_daily", key, () => fetchByDataField("subid_daily", startDate, endDate));
}

/** clique_daily com cache. */
export async function fetchCliqueDailyForRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const key = `${startDate}|${endDate}`;
  return cachedFetch("clique_daily", key, () => fetchByDataField("clique_daily", startDate, endDate));
}

/**
 * shopee_daily com cache. Indexado por documentId (não por campo `data`).
 * Retorna array de `{ id, ...data }` filtrando docs com métricas reais
 * (preserva o behavior de fetchShopeeDailyDocsForRange).
 */
export async function fetchShopeeDailyForRange(startDate, endDate, isDailyMetricsVazio) {
  if (!startDate || !endDate) return [];
  const key = `${startDate}|${endDate}`;
  return cachedFetch("shopee_daily", key, async () => {
    const out = [];
    if (startDate === endDate) {
      const snapDoc = await getDoc(doc(db, "shopee_daily", startDate));
      if (snapDoc.exists()) {
        const data = snapDoc.data();
        if (!isDailyMetricsVazio || !isDailyMetricsVazio(data)) {
          out.push({ id: snapDoc.id, ...data });
        }
      }
    } else {
      const q = query(
        collection(db, "shopee_daily"),
        where(documentId(), ">=", startDate),
        where(documentId(), "<=", endDate),
      );
      const snap = await getDocs(q).catch(() => ({ forEach: () => {} }));
      snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    }
    return out;
  });
}
```

## N.2 — Adaptar `fetchShopeeDailyDocsForRange` em `metricsRepository.js`

A função atual retorna snapshot docs (com `.data()` callable). O cache retorna objetos planos. Em vez de mudar todos os callers, adaptamos a função pra usar o cache internamente e devolver objetos compatíveis com `.data()`.

**Em `src/platforms/dashboard/repositories/metricsRepository.js`**, **procure**:

```js
export async function fetchShopeeDailyDocsForRange(startDate, endDate) {
  const dailyRef = collection(db, "shopee_daily");
  let docs = [];
  if (startDate === endDate) {
    const snapDoc = await getDoc(doc(db, "shopee_daily", startDate));
    const docValido = snapDoc.exists() && !isDailyMetricsVazio(snapDoc.data());
    if (docValido) {
      docs = [snapDoc];
    }
  } else {
    const q = query(
      dailyRef,
      where(documentId(), ">=", startDate),
      where(documentId(), "<=", endDate),
    );
    const snap = await getDocs(q);
    docs = snap.docs;
  }
  return docs;
}
```

**Substitua por:**

```js
// PATCH N: usa cache LRU compartilhado para evitar leituras duplicadas
// quando múltiplos caminhos do dashboard (KPIs, perdas, alvo, split) leem
// o mesmo período em paralelo.
export async function fetchShopeeDailyDocsForRange(startDate, endDate) {
  const cached = await fetchShopeeDailyForRange(startDate, endDate, isDailyMetricsVazio);
  // Adapta pra interface `.data()` que callers existentes esperam.
  return cached.map((row) => ({
    id: row.id,
    data: () => {
      const { id, ...rest } = row;
      return rest;
    },
  }));
}
```

**E adicione no topo do arquivo**, junto com os outros imports do cache, **logo após** `import { fetchDataVersions, invalidateDataVersionsCache } from "../cache/dataVersions.js";`:

```js
import {
  fetchShopeeDailyForRange,
  fetchSubIdDailyForRange,
  fetchCliqueDailyForRange,
  invalidateDailyRangeCache,
} from "../cache/dailyRangeCache.js";
```

## N.3 — Substituir leituras diretas de `subid_daily` por cache

Em `metricsRepository.js`, há 2 lugares que leem `subid_daily` direto:

### N.3.a — `agregarKPIsDeSubIdDaily`

**Procure:**

```js
async function agregarKPIsDeSubIdDaily(startDate, endDate) {
  try {
    const q = query(
      collection(db, "subid_daily"),
      where("data", ">=", startDate),
      where("data", "<=", endDate),
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
```

**Substitua por:**

```js
async function agregarKPIsDeSubIdDaily(startDate, endDate) {
  try {
    // PATCH N: usa cache compartilhado
    const rows = await fetchSubIdDailyForRange(startDate, endDate);
    if (!rows.length) return null;
    const snapshot = {
      empty: false,
      forEach: (cb) => rows.forEach((r) => cb({ id: r.id, data: () => {
        const { id, ...rest } = r;
        return rest;
      }})),
    };
```

### N.3.b — `montarBundleGranular`

**Procure:**

```js
  const subidSnap = await getDocs(query(
    collection(db, "subid_daily"),
    where("data", ">=", startStr),
    where("data", "<=", endStr),
  )).catch(() => ({ empty: true, forEach: () => {} }));
```

**Substitua por:**

```js
  // PATCH N: usa cache compartilhado
  const subidRows = await fetchSubIdDailyForRange(startStr, endStr).catch(() => []);
  const subidSnap = subidRows.length
    ? {
        empty: false,
        forEach: (cb) => subidRows.forEach((r) => cb({
          id: r.id,
          data: () => { const { id, ...rest } = r; return rest; },
        })),
      }
    : { empty: true, forEach: () => {} };
```

## N.4 — Substituir leituras diretas de `clique_daily` por cache

Em `metricsRepository.js`, há 2 lugares principais:

### N.4.a — `enriquecerProdutoDayMapComCliques`

**Procure:**

```js
  for (const date of dates) {
    const snap = await db.collection("clique_daily").where("data", "==", date).get();
    snap.forEach((d) => {
      const x = d.data() || {};
```

⚠️ Espera — esse trecho usa `db.collection(...).where(...).get()` (sintaxe Admin SDK / firebase v8). Verifica no Cursor se de fato é assim, ou se é Web SDK v9 com `query(collection(db, ...), where(...))`. **Cole pra mim o trecho real desse arquivo de `enriquecerProdutoDayMapComCliques` que eu confirmo a sintaxe** — não quero quebrar nada num refactor de SDK.

**Por enquanto, deixa essa função intocada**. Aplica só N.3 + N.4.b abaixo.

### N.4.b — `enrichSubIdsComMetaNoPeriodo`

**Procure:**

```js
    preloaded.cliqueDailySnap != null
      ? Promise.resolve(preloaded.cliqueDailySnap)
      : getDocs(query(
        collection(db, "clique_daily"),
        where("data", ">=", startStr),
        where("data", "<=", endStr),
      )).catch(() => ({ empty: true, forEach: () => {} })),
```

**Substitua por:**

```js
    preloaded.cliqueDailySnap != null
      ? Promise.resolve(preloaded.cliqueDailySnap)
      // PATCH N: usa cache compartilhado
      : fetchCliqueDailyForRange(startStr, endStr).then((rows) => rows.length
          ? {
              empty: false,
              forEach: (cb) => rows.forEach((r) => cb({
                id: r.id,
                data: () => { const { id, ...rest } = r; return rest; },
              })),
            }
          : { empty: true, forEach: () => {} }
        ).catch(() => ({ empty: true, forEach: () => {} })),
```

### N.4.c — Mesma transformação em `montarBundleGranular`

**Procure no `montarBundleGranular`**:

```js
  if (enrichMeta && includeCliques) {
    cliqueDailySnap = await getDocs(query(
      collection(db, "clique_daily"),
      where("data", ">=", startStr),
      where("data", "<=", endStr),
    )).catch(() => ({ empty: true, forEach: () => {} }));
  }
```

**Substitua por:**

```js
  if (enrichMeta && includeCliques) {
    // PATCH N: usa cache compartilhado
    const cliqueRows = await fetchCliqueDailyForRange(startStr, endStr).catch(() => []);
    cliqueDailySnap = cliqueRows.length
      ? {
          empty: false,
          forEach: (cb) => cliqueRows.forEach((r) => cb({
            id: r.id,
            data: () => { const { id, ...rest } = r; return rest; },
          })),
        }
      : { empty: true, forEach: () => {} };
  }
```

## N.5 — Invalidação do cache em `clearDashboardQueryCaches`

**Procure (em metricsRepository.js):**

```js
export function clearDashboardQueryCaches() {
  invalidateMetaAdsDailyCache(1500); // 1.5s debounce to prevent churn
  perdasKpiCache.clear();
  alvoAlinhamentoCache.clear();
  clearMetaAdsCache();
  // PATCH M: NÃO invalidar dataVersions aqui...
  invalidateProdutoMensalCache();
}
```

**Substitua por:**

```js
export function clearDashboardQueryCaches() {
  invalidateMetaAdsDailyCache(1500); // 1.5s debounce to prevent churn
  perdasKpiCache.clear();
  alvoAlinhamentoCache.clear();
  clearMetaAdsCache();
  // PATCH M: NÃO invalidar dataVersions aqui — TTL de 30s já basta.
  invalidateProdutoMensalCache();
  // PATCH N: invalida cache compartilhado de shopee_daily, subid_daily, clique_daily
  invalidateDailyRangeCache();
}
```

## Validação N

Janela anônima, abre Dashboard, filtra "Este mês". Aba Diagnóstico Firestore:

**Antes (hoje):**
- shopee_daily: ~120 reads (8×)
- subid_daily: ~1582 reads (2×)
- clique_daily: ~1660 reads (2×)

**Depois esperado:**
- shopee_daily: ~15 reads (1×)
- subid_daily: ~791 reads (1×)
- clique_daily: ~830 reads (1×)

Total da aba pra "Este mês" sozinho: cai de ~4.052 → **~2.000**.

## Deploy N

Só frontend:
```
git add src/platforms/dashboard/cache/dailyRangeCache.js \
        src/platforms/dashboard/repositories/metricsRepository.js
git commit -m "patch N: LRU + in-flight dedup pra shopee/subid/clique daily"
git push
```

Hard refresh (Ctrl+Shift+R) na primeira visita após o build do Vercel.

---

## Ordem de aplicação recomendada

1. Aplicar **K** e **H'** primeiro (só backend, deploy de functions).
2. Esperar 1 hora — confirmar nos logs que `recent_3d` e `month_auto` estão na nova frequência e `reconcile_5d` rodou.
3. Aplicar **N** depois (só frontend, push pro Vercel).
4. Esperar 24h e medir.

Aplicar tudo junto também funciona — só fica mais difícil saber qual deu o resultado se algo der errado.

## Rollback

Cada patch é independente:
- **K**: reverter as 3 cron strings.
- **H'**: reverter o `5 * 86400` pra `15 * 86400` e o label `reconcile_5d` pra `reconcile_15d`.
- **N**: deletar `dailyRangeCache.js` e reverter as mudanças em `metricsRepository.js`. Função `fetchShopeeDailyDocsForRange` volta ao original.

---

## Pendente pra confirmar antes de aplicar N

Em **N.4.a** identifiquei um trecho de `enriquecerProdutoDayMapComCliques` que parece usar sintaxe diferente (`db.collection(...).where(...).get()`). Não toquei naquele trecho até você confirmar a sintaxe real. **Cola aqui o trecho atual da função pra eu te dizer se aplica o cache lá também ou não.**

Se a sintaxe for Admin SDK (Cloud Functions), aquela função roda no backend e não precisa do cache do frontend.

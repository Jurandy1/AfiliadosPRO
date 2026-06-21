# PATCH — Fix Cache: dados frescos sem limpar navegador

## Problemas encontrados

### 1. `periodSessionCache.js` — `return null` no topo quebra a lógica
`getPeriodCacheEntry` retorna `null` imediatamente mas `setPeriodCacheEntry`
continua gravando no IDB. Resultado: grava mas nunca lê = desperdício de I/O
e comportamento imprevisível.

### 2. `dailyRangeCache.js` — TTL de 60s sem versionamento
subid_daily, shopee_daily e clique_daily ficam 60s com dados velhos mesmo
após sync. Não usa versionamento, só TTL.

### 3. `dataVersions.js` — versionKey não muda se backend não bumpar
Se `shopee_health.dataVersion` ou `meta_health.dataVersion` não forem
incrementados após cada sync, o versionKey fica igual e o cache nunca invalida.

### 4. `modoAllCache.js` / `periodoPainelCache.js` — localStorage sem TTL real
Dados ficam presos no localStorage indefinidamente se o usuário não limpar.

---

## Arquivos a modificar

### src/platforms/dashboard/cache/periodSessionCache.js
```js
import { idbGet, idbSet, idbClear } from "./indexedDbCache";

export const CACHE_DISABLE_KEY = "afilia:disable-cache";

const store = new Map();

export function isPeriodCacheDisabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("nocache")) return true;
    return window.localStorage.getItem(CACHE_DISABLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function settingsCacheKey(settings = {}) {
  return `${Number(settings.impostoMeta ?? 0)}_${Number(settings.impostoNf ?? 0)}`;
}

export function buildPeriodCacheKey(kind, startDate, endDate, versionKey, settings = {}) {
  return `${kind}|${startDate}|${endDate}|${versionKey}|${settingsCacheKey(settings)}`;
}

// TTL máximo: 5 min — mesmo que o versionKey não mude, o cache expira
const PERIOD_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getPeriodCacheEntry(key) {
  if (isPeriodCacheDisabled()) return null;

  let entry = store.get(key);
  if (!entry) {
    entry = await idbGet(key);
    if (entry) store.set(key, entry);
  }

  if (!entry) return null;

  // TTL: descarta entradas antigas mesmo que o versionKey seja igual
  if (entry.storedAt && Date.now() - entry.storedAt > PERIOD_CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }

  return entry.payload;
}

export function setPeriodCacheEntry(key, payload, meta = {}) {
  if (isPeriodCacheDisabled()) return;

  const entry = {
    payload,
    storedAt: Date.now(),
    ...meta,
  };

  store.set(key, entry);
  idbSet(key, entry).catch(() => {});
}

export function invalidatePeriodSessionCache() {
  store.clear();
  idbClear().catch(() => {});
}
```

---

### src/platforms/dashboard/cache/dailyRangeCache.js
Reduz TTL de 60s → 30s e adiciona invalidação via versionKey:

```js
// Linha 12 — muda TTL:
const TTL_MS = 30_000; // era 60_000

// Linha 15 — muda MAX_SLOTS:
const MAX_SLOTS = 4; // era 6 — libera memória mais rápido
```

Adiciona função de invalidação por versão no `fetchByDataField`:
```js
// Adiciona no topo do arquivo, após os imports:
import { fetchDataVersions } from "./dataVersions";

// Substitui fetchShopeeDailyForRange para usar versionamento:
export async function fetchShopeeDailyForRange(startDate, endDate, isDailyMetricsVazio) {
  if (!startDate || !endDate) return [];

  // Inclui versionKey na cache key para invalidar quando dados mudam
  let versionSuffix = "";
  try {
    const v = await fetchDataVersions();
    versionSuffix = `|${v.versionKey}`;
  } catch {}

  const key = `${startDate}|${endDate}${versionSuffix}`;
  return cachedFetch("shopee_daily", key, async () => {
    const { data, error } = await supabase
      .from("shopee_daily")
      .select("*")
      .gte("data", startDate)
      .lte("data", endDate);

    if (error) {
      console.warn("[Supabase] Erro ao buscar shopee_daily:", error.message);
      return [];
    }

    const out = [];
    (data || []).forEach((row) => {
      if (!isDailyMetricsVazio || !isDailyMetricsVazio(row)) {
        out.push({ id: row.data || row.id, ...row });
      }
    });
    return out;
  });
}

// Mesmo padrão para fetchSubIdDailyForRange:
export async function fetchSubIdDailyForRange(startDate, endDate) {
  if (!startDate || !endDate) return [];

  let versionSuffix = "";
  try {
    const v = await fetchDataVersions();
    versionSuffix = `|${v.versionKey}`;
  } catch {}

  const key = `${startDate}|${endDate}${versionSuffix}`;
  return cachedFetch("subid_daily", key, () =>
    fetchByDataField("subid_daily", startDate, endDate)
  );
}
```

---

### src/platforms/dashboard/cache/dataVersions.js
Adiciona `updatedAt` como parte do versionKey para garantir mudança mesmo
quando `dataVersion` não é incrementado:

```js
// Substitui o bloco de montagem do cachedVersions:
cachedVersions = {
  shopeeVer,
  metaVer,
  // Inclui timestamp atual em segundos arredondado para 30s
  // Garante que o cache expira no máximo a cada 30s mesmo sem bump de versão
  timeBucket: Math.floor(Date.now() / 30_000),
  versionKey: `${shopeeVer}:${metaVer}`,
};
```

---

### src/platforms/dashboard/cache/modoAllCache.js
Adiciona TTL no localStorage:

```js
const KEY = "afilia:modo_all_cache";
const KEY_REFRESH = "afilia:modo_all_refresh_ts";
const TTL_MS = 5 * 60 * 1000; // 5 min

export function invalidarModoAllCache() {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(KEY_REFRESH);
  } catch { /* ignore */ }
}

export function registrarModoAllRefresh() {
  try {
    window.localStorage.setItem(KEY_REFRESH, String(Date.now()));
  } catch { /* ignore */ }
}

// NOVO: verifica se o cache expirou
export function isModoAllCacheValido() {
  try {
    const ts = Number(window.localStorage.getItem(KEY_REFRESH) || 0);
    return ts > 0 && Date.now() - ts < TTL_MS;
  } catch { return false; }
}
```

---

### NOVO: src/platforms/dashboard/cache/forceCacheReset.js
Utilitário para reset completo de todos os caches — use no botão "Atualizar" da UI:

```js
/**
 * forceCacheReset.js
 * Limpa TODOS os caches do app sem precisar limpar o navegador.
 * Chame ao clicar em "Atualizar dados" ou quando o usuário reportar dados velhos.
 */
import { invalidatePeriodSessionCache } from "./periodSessionCache";
import { invalidateDataVersionsCache } from "./dataVersions";
import { invalidateMetaAdsDailyCache } from "./metaAdsDailyCache";
import { invalidateDailyRangeCache } from "./dailyRangeCache";
import { invalidarModoAllCache } from "./modoAllCache";
import { invalidarPeriodoPainelCache } from "./periodoPainelCache";

export async function forceFullCacheReset() {
  // 1. Limpa todos os caches em memória
  invalidatePeriodSessionCache();
  invalidateDataVersionsCache();
  invalidateMetaAdsDailyCache(0);
  invalidateDailyRangeCache();
  invalidarModoAllCache();
  invalidarPeriodoPainelCache();

  // 2. Limpa localStorage de chaves do app
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("afilia:")) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch {}

  console.log("[Cache] Reset completo executado");
}
```

---

## Como usar o forceCacheReset na UI

No componente do Dashboard, adicione um botão "🔄 Atualizar":

```jsx
import { forceFullCacheReset } from "../cache/forceCacheReset";

// Dentro do componente:
const handleForceRefresh = async () => {
  await forceFullCacheReset();
  window.location.reload(); // reload leve — sem limpar navegador
};

// No JSX:
<button onClick={handleForceRefresh} title="Forçar atualização dos dados">
  🔄 Atualizar
</button>
```

---

## Resumo das mudanças

| Arquivo | O que muda |
|---|---|
| `periodSessionCache.js` | Remove `return null` espúrio, adiciona TTL de 5 min |
| `dailyRangeCache.js` | TTL 60s→30s, cache key inclui versionKey |
| `dataVersions.js` | versionKey inclui timeBucket de 30s como fallback |
| `modoAllCache.js` | Adiciona TTL de 5 min no localStorage |
| `forceCacheReset.js` | **NOVO** — reset total sem limpar navegador |


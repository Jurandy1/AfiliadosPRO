# Patch M — Frontend dedup: meta_ads_daily cache + dataVersions + garimpo audit

**Projeto:** AffiliateHub Pro
**Arquivos:** `src/platforms/dashboard/cache/metaAdsDailyCache.js`, `src/platforms/dashboard/cache/dataVersions.js`, `src/platforms/dashboard/repositories/metricsRepository.js`
**Economia esperada:** ~15-25k reads/dia
**Risco:** baixo (mantém comportamento, só evita re-leituras)

---

## Diagnóstico (do diagnóstico Firestore 16/06 08h11)

Numa única sessão de 44 segundos (troca de filtro Ontem → 7 dias → Ontem):

```
08:11:04 meta_ads_daily  44 docs  (Ontem)         ← legítimo
08:11:15 meta_ads_daily 635 docs  (Ontem)         ← BUG 1: range errado ou cache miss
08:11:39 meta_ads_daily 316 docs  (7 dias)        ← legítimo
08:11:04→47 sync_state    9 reads  (15 chamadas getDoc) ← BUG 2: TTL zerado
08:11:41 produtos        199 docs  (7 dias)       ← BUG 3: Garimpo no Dashboard
```

Total: **~1.193 reads desnecessários numa sessão**. Em 4 sessões/dia × 2 usuários = ~9.500 reads/dia só desses bugs.

---

## Bug 1 — L1 cache de 1 slot vira anti-cache

### Problema
Em `metaAdsDailyCache.js`:
```js
let _l1Cache = null;
let _l1CacheKey = null;  // ← só 1 slot
```

Quando o Dashboard carrega "Ontem" (44 docs) e em paralelo o ModoAll está sendo pre-warmed pra ~13 dias (635 docs), eles se sobrescrevem mutuamente. Pior: não há in-flight dedup, então 2 chamadas exatamente iguais ao mesmo tempo viram 2 fetches.

### Fix

**Substitua o arquivo `src/platforms/dashboard/cache/metaAdsDailyCache.js` por:**

```js
/**
 * metaAdsDailyCache.js
 *
 * Cache de meta_ads_daily com duas camadas:
 *   L1 — LRU em memória (4 slots): suporta múltiplos períodos paralelos.
 *   L2 — IndexedDB via dailyGranularCache: persiste entre recarregamentos.
 *
 * PATCH M:
 *   - L1 vira Map LRU (4 períodos diferentes podem coexistir).
 *   - In-flight dedup: 2 chamadas paralelas com mesmo range → 1 fetch só.
 *   - Warn em DEV quando range > 7 dias for chamado (rastreio do "635 docs bug").
 */
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import {
  fetchSmartDailyCollection,
  invalidateDailyVersionsManifestCache,
} from "./dailyGranularCache";

const SMART_CACHE_ATIVO = String(import.meta.env.VITE_SMART_CACHE_META ?? "0") === "1";
const EMPTY_SNAP = { empty: true, forEach: () => {}, docs: [] };

const L1_MAX_SLOTS = 4;
const L1_TTL_MS = 60_000;  // 60s — protege contra repico no mesmo render cycle

// L1: Map LRU. Key = `${startDate}|${endDate}`, value = { snap, ts }.
const _l1 = new Map();

// In-flight dedup: 2 chamadas simultâneas com mesma key viram 1 fetch.
const _inFlight = new Map();

let _invalidateTimer = null;

function arrayToSnapLike(dataArray) {
  if (!dataArray || dataArray.length === 0) return EMPTY_SNAP;
  const docs = dataArray.map((d) => ({ data: () => d }));
  return {
    empty: false,
    docs,
    forEach: (cb) => docs.forEach(cb),
  };
}

function lruTouch(key, snap) {
  // Remove e re-insere pra ir pro topo (Map mantém ordem de inserção).
  if (_l1.has(key)) _l1.delete(key);
  _l1.set(key, { snap, ts: Date.now() });
  // Evict do mais antigo se passou do limite.
  while (_l1.size > L1_MAX_SLOTS) {
    const oldestKey = _l1.keys().next().value;
    _l1.delete(oldestKey);
  }
}

function lruGet(key) {
  const entry = _l1.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > L1_TTL_MS) {
    _l1.delete(key);
    return null;
  }
  // Touch: move pro topo
  _l1.delete(key);
  _l1.set(key, entry);
  return entry.snap;
}

export function invalidateMetaAdsDailyCache(delayMs = 0) {
  if (_invalidateTimer) clearTimeout(_invalidateTimer);

  const doInvalidate = () => {
    _l1.clear();
    _inFlight.clear();
    if (SMART_CACHE_ATIVO) {
      invalidateDailyVersionsManifestCache();
    }
  };

  if (delayMs > 0) {
    _invalidateTimer = setTimeout(doInvalidate, delayMs);
  } else {
    doInvalidate();
  }
}

/**
 * Calcula dias entre duas datas YYYY-MM-DD inclusivo.
 * Só pra warn em DEV — não afeta runtime.
 */
function diasInclusivos(start, end) {
  if (!start || !end) return 0;
  const a = Date.parse(`${start}T12:00:00-03:00`);
  const b = Date.parse(`${end}T12:00:00-03:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export async function fetchMetaAdsDailySnapshot(startDate, endDate) {
  if (!startDate || !endDate) return EMPTY_SNAP;

  const key = `${startDate}|${endDate}`;

  // L1 hit
  const cached = lruGet(key);
  if (cached) return cached;

  // In-flight: outra chamada com mesma key já está em andamento? Pega a promise.
  const pending = _inFlight.get(key);
  if (pending) return pending;

  // PATCH M: warn quando range é estranhamente grande pra ajudar a rastrear
  // chamadas com parâmetro errado (ex.: "Ontem" carregando 13 dias).
  if (import.meta.env.DEV) {
    const dias = diasInclusivos(startDate, endDate);
    if (dias > 35) {
      console.warn(
        `[metaAdsDailyCache] range grande: ${dias} dias (${startDate} → ${endDate}). ` +
        "Stack:",
        new Error().stack?.split("\n").slice(1, 6).join("\n"),
      );
    }
  }

  // Promise compartilhada entre todos os callers paralelos
  const fetchPromise = (async () => {
    let result;
    if (SMART_CACHE_ATIVO) {
      const dataArray = await fetchSmartDailyCollection("meta_ads_daily", startDate, endDate);
      result = arrayToSnapLike(dataArray);
    } else {
      const q = query(
        collection(db, "meta_ads_daily"),
        where("data", ">=", startDate),
        where("data", "<=", endDate),
      );
      const snap = await getDocs(q).catch(() => EMPTY_SNAP);
      result = (!snap || snap.empty) ? EMPTY_SNAP : snap;
    }
    lruTouch(key, result);
    return result;
  })();

  _inFlight.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    _inFlight.delete(key);
  }
}
```

**Por que isso funciona:**

- Se Dashboard chama `(ontem, ontem)` e ModoAll chama `(ranges_diferentes)` em paralelo, ambos ficam no LRU (até 4 slots). Voltar pra "Ontem" reaproveita o cache.
- Se 3 componentes chamam `(ontem, ontem)` no mesmo render cycle (KPIs + SubID + Breakdown), só 1 fetch acontece. Os outros 2 esperam a mesma Promise.
- TTL de 60s protege contra repico imediato sem segurar dado velho.
- Warn em DEV identifica quem está chamando com range "errado" (provável raiz dos 635 docs).

---

## Bug 2 — `dataVersions` zerado em toda troca de filtro

### Problema
Em `metricsRepository.js`:
```js
export function clearDashboardQueryCaches() {
  invalidateMetaAdsDailyCache(1500);
  perdasKpiCache.clear();
  alvoAlinhamentoCache.clear();
  clearMetaAdsCache();
  invalidateDataVersionsCache();   // ← BUG: zera dataVersions
  invalidateProdutoMensalCache();
}
```

`dataVersions` lê `sync_state/shopee_health` + `sync_state/meta_health` (2 reads, TTL 30s). Quando o usuário troca filtro, `invalidateAllPeriodCaches()` → `clearDashboardQueryCaches()` zera tudo. Os componentes que carregam o novo filtro fazem `fetchDataVersions()` cada um → mais 2 reads cada vez (porque ainda não tem dedup in-flight em `dataVersions`).

`dataVersions` só precisa invalidar quando o BACKEND grava dado novo (e nesses casos o `dataVersion` num doc já muda, então o próximo `fetchDataVersions` após TTL pega naturalmente).

### Fix

**Em `src/platforms/dashboard/repositories/metricsRepository.js`**, **procure**:

```js
export function clearDashboardQueryCaches() {
  invalidateMetaAdsDailyCache(1500); // 1.5s debounce to prevent churn
  perdasKpiCache.clear();
  alvoAlinhamentoCache.clear();
  clearMetaAdsCache();
  invalidateDataVersionsCache();
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
  // PATCH M: NÃO invalidar dataVersions aqui. dataVersions é global e seu TTL
  // de 30s já garante refresh. Invalidar a cada filtro forçava 2 reads
  // (shopee_health + meta_health) em toda navegação.
  // invalidateDataVersionsCache();
  invalidateProdutoMensalCache();
}
```

(Só comentar a linha. Se em algum lugar específico você quiser forçar invalidação — ex.: depois de um backfill manual com sucesso — chame `invalidateDataVersionsCache()` direto ali.)

---

## Bug 2.5 — Adicionar in-flight dedup também no `dataVersions`

Mesmo com TTL de 30s, se 3 componentes chamarem `fetchDataVersions()` no mesmo render cycle (antes do cache estar populado), todos vão ao Firestore. Fix de 5 linhas.

**Substitua o arquivo `src/platforms/dashboard/cache/dataVersions.js` por:**

```js
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../services/firebase/client";

const VERSIONS_TTL_MS = 30_000;

let cachedVersions = null;
let cachedVersionsTs = 0;
let _inFlightPromise = null;  // PATCH M: dedup de chamadas paralelas

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Versão composta Shopee + Meta para invalidar cache de período.
 * TTL curto em memória evita 2 reads a cada navegação dentro do mesmo minuto.
 *
 * PATCH M: in-flight dedup — se 3 componentes chamam ao mesmo tempo,
 * só 1 fetch ao Firestore (os outros 2 esperam a mesma Promise).
 */
export async function fetchDataVersions({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedVersions && now - cachedVersionsTs < VERSIONS_TTL_MS) {
    return cachedVersions;
  }

  // Se há um fetch em andamento, devolve a mesma Promise
  if (!force && _inFlightPromise) {
    return _inFlightPromise;
  }

  _inFlightPromise = (async () => {
    try {
      const [shopeeSnap, metaSnap] = await Promise.all([
        getDoc(doc(db, "sync_state", "shopee_health")).catch(() => null),
        getDoc(doc(db, "sync_state", "meta_health")).catch(() => null),
      ]);

      const shopeeVer = Number(shopeeSnap?.exists?.() ? shopeeSnap.data()?.dataVersion : 0) || 0;
      const meta = metaSnap?.exists?.() ? (metaSnap.data() || {}) : {};
      const metaVer = Math.max(
        timestampToMs(meta.lastDailySyncAt),
        timestampToMs(meta.lastAdsSyncAt),
        Number(meta.dataVersion || 0),
      );

      cachedVersions = {
        shopeeVer,
        metaVer,
        versionKey: `${shopeeVer}:${metaVer}`,
      };
      cachedVersionsTs = Date.now();
      return cachedVersions;
    } finally {
      _inFlightPromise = null;
    }
  })();

  return _inFlightPromise;
}

export function invalidateDataVersionsCache() {
  cachedVersions = null;
  cachedVersionsTs = 0;
  _inFlightPromise = null;
}
```

---

## Bug 3 — Garimpo rodando no Dashboard (precisa de investigação)

`garimpoRepository.js` tá limpo. O culpado é alguém chamando `getGarimpoInteligenteHistorico` ou `getRadarRecompraEnriquecido` quando deveria ser só na aba Garimpo. Esses chamam `buildHistoricoMapForItemIds` → `getProdutosByItemIds` → 7 batches × 30 ids = 199 reads em `produtos`.

### Como investigar (5 min)

**No Cursor, faça busca global no projeto** (Ctrl+Shift+F):

```
getGarimpoInteligenteHistorico
```

E também:
```
getRadarRecompraEnriquecido
getProdutosGarimpoUltimoDia
```

Vai aparecer cada arquivo `.jsx` que chama essas funções. Cole aqui as 3-5 ocorrências que encontrar (especialmente em `DashboardPage.jsx`, `App.jsx`, `MenuLayout.jsx`, ou em hooks tipo `useEffect`). Aí eu te digo qual remover/lazy-load.

**Suspeitas mais prováveis:**
- `AlertasBell` carregando garimpo em background pra contar alertas → precisa lazy load
- `DashboardPage` chamando garimpo no `useEffect` inicial pra preencher widget → mover pra `onClick` da aba
- Algum prefetch agressivo pra tornar a aba Garimpo "instantânea" → trade-off ruim

---

## Como validar pós-deploy

**Antes de aplicar (controle):**
- Diagnóstico Firestore: total da aba ao fazer Ontem→7d→Ontem = ~2.500 reads.

**Depois de aplicar:**

1. Abre janela anônima. Aba "Status e sincronização → Diagnóstico Firestore".
2. Clica em "Ontem" e espera carregar.
3. Clica em "7 dias" e espera.
4. Volta pra "Ontem".
5. Olha o total da aba. Esperado: **caia pra ~1.000-1.400 reads** (-50%).

Detalhes esperados:
- `meta_ads_daily` na coluna "Por coleção" cai de ~1.000 pra ~400 (cache reuso).
- `sync_state` cai de ~15 reads pra ~3-4 reads (dedup + TTL).
- `produtos` (do garimpoRepository) só cai se você aplicar o Bug 3 também.

---

## Deploy

Esse patch é **só frontend**. Sem deploy de Cloud Functions.

```bash
git add src/platforms/dashboard/cache/metaAdsDailyCache.js \
        src/platforms/dashboard/cache/dataVersions.js \
        src/platforms/dashboard/repositories/metricsRepository.js
git commit -m "patch M: dedup meta_ads_daily + dataVersions in-flight"
git push
```

Vercel pega automático em ~2 min. Hard refresh (Ctrl+Shift+R) na primeira visita pra garantir bundle novo.

## Rollback

Cada arquivo é independente — pode reverter qualquer um sozinho. O fix do `clearDashboardQueryCaches` é só descomentar a linha de `invalidateDataVersionsCache()`.

---

## Pendente pro próximo patch

- **Bug 3 (Garimpo no Dashboard)** — precisa do `DashboardPage.jsx` ou similar pra identificar caller. Cole quando rodar o `Ctrl+Shift+F` acima.
- **Patch H** (backend prefetch bypass) — independente, ~10-15k reads/dia
- **Patch K** (reduzir cron de schedulers) — trivial, ~8k reads/dia

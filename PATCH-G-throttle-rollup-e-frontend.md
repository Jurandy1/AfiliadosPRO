# Patch G — Throttle do monthlyRollup + throttle de `refresh_range` no frontend

**Projeto:** AffiliateHub Pro / `projetoafiliado-9ff07`
**Arquivos tocados:** `functions/index.js`, `src/platforms/dashboard/repositories/metricsRepository.js`
**Diagnóstico baseado em:** logs GCP 2026-06-15 (13h–21h30 BRT).
**Economia esperada:** ~30k–40k reads/dia.

---

## Resumo do problema (em 3 linhas)

1. Toda vez que alguém abre o painel filtrado em "ontem", o frontend dispara `dispararBackfillPeriodo` → backend roda `refresh_range_*` → `runShopeeSync` aciona `refreshMonthlyBucketsForDates` → **reconstrói o bucket do mês corrente lendo 6 coleções inteiras** (~3.000 reads).
2. O throttle de 30 min do rollup é **bypassado quando o label começa com `refresh_`** (`throttleMs = 0`). Resultado: 13 rollups completos do mês 2026-06 em um dia (≈ 39k reads).
3. Não há throttle no frontend pra evitar disparar `refresh_range` várias vezes pro mesmo dia passado dentro da mesma sessão. Hoje (15/06) foram **14 disparos** pro dia 14/06 vindos da mesma origem.

## O que NÃO muda

- API Shopee continua sendo consultada na mesma frequência (incremental 4×/dia + recent 6×/dia + reconcile 1×/dia + month_auto 4×/dia).
- Granulares (`shopee_daily`, `subid_daily`, `produto_daily`, `meta_ads_daily`, `log_perdas`, `clique_daily`) continuam sendo gravados em CADA sync. Dado fresco continua chegando do mesmo jeito.
- Botão "Atualizar" no painel continua forçando refresh real (passa `force=1` na URL, que bypassa o throttle local).
- Reconcile diário (04h BRT) e backfill manual (`shopeeBackfillNow` com `days=*`) continuam reconstruindo bucket sem throttle.
- Cálculos de KPI / Lucro / ROI / impostos não mudam em nada.

## O que muda

- Bucket mensal (`painel_resumo/{YYYY-MM}` + `subid_mensal/{YYYY-MM}` + `produto_mensal/{YYYY-MM}`) deixa de ser reconstruído a cada visita do painel. Passa a respeitar 15 min entre rebuilds quando o trigger é `refresh_range`.
- Frontend deixa de redisparar `refresh_range` pra um dia passado se já fez isso há menos de 15 min na mesma sessão.

**Impacto na precisão:** zero. Os dados granulares continuam atualizados em tempo real. O bucket mensal só é usado pra leitura agregada do painel — se foi reconstruído há 15 min, está com os mesmos dados que seriam usados agora.

---

## 1. Backend — `functions/index.js`

**Função alvo:** `runShopeeSync`, dentro do bloco que chama `refreshMonthlyBucketsForDates`.

**Procure por este trecho** (perto da linha 2.520, dentro do bloco `if (gravadosTotais > 0 || perdasRemovidas > 0)`):

```js
    const isReconcile = /reconcile/i.test(String(label || ""));
    const isBackfill = /^backfill_/i.test(String(label || ""));
    const isManualRefresh = /^refresh_/i.test(String(label || ""));
    const throttleMs = (isReconcile || isBackfill || isManualRefresh)
      ? 0
      : 30 * 60 * 1000;
```

**Substitua por:**

```js
    const isReconcile = /reconcile/i.test(String(label || ""));
    const isBackfill = /^backfill_/i.test(String(label || ""));
    const isManualRefresh = /^refresh_/i.test(String(label || ""));
    // PATCH G: refresh_range_* agora respeita throttle de 15 min. Antes era 0,
    // o que fazia o mês corrente ser reconstruído a cada visita do painel
    // (logs 15/06: 13 rebuilds num dia, ~39k reads). Reconcile e backfill
    // continuam com throttle 0 porque são operações intencionais/explícitas.
    const throttleMs = (isReconcile || isBackfill)
      ? 0
      : isManualRefresh
        ? 15 * 60 * 1000
        : 30 * 60 * 1000;
```

Resto do bloco fica igual. Não toca em `refreshMonthlyBucketsForDates` em si nem em `rebuildMonthlyBuckets`.

**Deploy:**
```
firebase deploy --only functions:shopeeBackfillNow,functions:shopeeIncrementalSync,functions:shopeeRecentDaysSync,functions:shopeeMonthAutoSync,functions:shopeeDailyReconcile
```

(Todas chamam `runShopeeSync`, então todas precisam do mesmo bundle.)

**Como validar pós-deploy:**
1. Abra o painel filtrado em "ontem".
2. Olhe o log do Cloud Functions e procure `[monthlyRollup]`.
3. Primeira visita: deve aparecer `[monthlyRollup] refresh_range_*: 2026-06`.
4. Segunda visita dentro de 15 min: deve aparecer `[monthlyRollup] 2026-06 skip (throttle: rebuilt Nmin ago)`.

---

## 2. Frontend — `src/platforms/dashboard/repositories/metricsRepository.js`

**Função alvo:** `garantirDadosAtualizados`. Hoje ela dispara `sincronizarDiaUnico` sem checar se aquele dia já foi sincronizado recentemente nesta sessão.

### 2.1 Adicione este helper logo após `function getStaleThresholdMs(dateStr) { ... }` (perto da linha 470)

```js
/**
 * PATCH G: throttle local de refresh_range por dia (sessionStorage).
 * Evita que duas visitas seguidas ao mesmo dia passado disparem o backfill
 * de novo. Hoje (15/jun) o log mostrou 14 disparos pro dia 14/06.
 *
 * "Hoje" (BRT) NUNCA passa por este throttle — segue sincronizando ao vivo.
 * "Atualizar" no painel passa { force: true } e também ignora o throttle.
 */
const REFRESH_LOCAL_THROTTLE_MS = 15 * 60 * 1000;
const REFRESH_LOCAL_KEY_PREFIX = "afilia:last_refresh_";

function lerLastRefreshLocal(dateStr) {
  try {
    if (typeof window === "undefined") return 0;
    const v = window.sessionStorage.getItem(REFRESH_LOCAL_KEY_PREFIX + dateStr);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

function gravarLastRefreshLocal(dateStr) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(REFRESH_LOCAL_KEY_PREFIX + dateStr, String(Date.now()));
  } catch {
    /* ignora quota/private mode */
  }
}

function diaPassouThrottleLocal(dateStr, hojeStr) {
  if (!dateStr || dateStr === hojeStr) return false; // hoje sempre passa
  const last = lerLastRefreshLocal(dateStr);
  if (last <= 0) return false;
  return (Date.now() - last) < REFRESH_LOCAL_THROTTLE_MS;
}
```

### 2.2 Modifique `garantirDadosAtualizados`

**Procure** (perto da linha 740, logo depois do bloco `if (isApenasHoje) { ... }`):

```js
  if (isDiaUnico && isDiaRecenteBRT(startDate, hojeStr) && startDate !== hojeStr) {
    const shopee = await sincronizarDiaUnico(startDate, {
      label: startDate === ontemStr ? "ontem" : "dia_recente",
    });
    return { ...shopee, metaSync };
  }
```

**Substitua por:**

```js
  if (isDiaUnico && isDiaRecenteBRT(startDate, hojeStr) && startDate !== hojeStr) {
    // PATCH G: se já sincronizamos esse dia há menos de 15 min nesta sessão,
    // pula. Dado granular já foi gravado e o cache do período cobre o resto.
    if (!forceAll && diaPassouThrottleLocal(startDate, hojeStr)) {
      return {
        refreshed: false,
        stale: [startDate],
        throttled: true,
        throttledLocal: true,
        mode: startDate === ontemStr ? "ontem_local_throttle" : "dia_recente_local_throttle",
        metaSync,
      };
    }
    const shopee = await sincronizarDiaUnico(startDate, {
      label: startDate === ontemStr ? "ontem" : "dia_recente",
    });
    if (shopee?.refreshed && !shopee.throttled) {
      gravarLastRefreshLocal(startDate);
    }
    return { ...shopee, metaSync };
  }
```

**E logo abaixo, no bloco `if (forceAll && isDiaUnico)`**, **substitua**:

```js
  if (forceAll && isDiaUnico) {
    const shopee = await sincronizarDiaUnico(startDate, { label: "force_dia" });
    return { ...shopee, metaSync };
  }
```

**Por:**

```js
  if (forceAll && isDiaUnico) {
    const shopee = await sincronizarDiaUnico(startDate, { label: "force_dia" });
    if (shopee?.refreshed && !shopee.throttled) {
      gravarLastRefreshLocal(startDate);
    }
    return { ...shopee, metaSync };
  }
```

(O `forceAll` continua bypassando o throttle local — o `gravarLastRefreshLocal` só atualiza o timestamp depois de uma sync de verdade ter sucesso.)

### 2.3 Não precisa mexer em mais nada

- `isApenasHoje` continua entrando no caminho `dispararBackfillHoje`, sem throttle local — comportamento intencional.
- O bloco `forceAll && !isDiaUnico` (range manual) também não tem throttle — `forceAll=true` significa botão "Atualizar".
- O fluxo final (`stale = await getDatasDesatualizadas(...)`) já tem seu próprio mecanismo via `getStaleThresholdMs` — fica intacto.

---

## Como validar end-to-end

Antes de aplicar:
```
Console Firestore às 21h: 214k reads, 13k writes.
Logs Cloud Functions: 13× monthlyRollup refresh_range em um dia.
```

Depois de aplicar e fazer deploy:
1. Abra o painel filtrado em "ontem". Veja no DevTools → Network: `shopeeBackfillNow` deve ser chamado **uma vez**.
2. Feche, abra de novo dentro de 15 min. **Não deve aparecer chamada** pra `shopeeBackfillNow` (chave `afilia:last_refresh_*` impede).
3. Logs Cloud Functions: deve aparecer no máximo 1 `monthlyRollup refresh_range` a cada 15 min, em vez de a cada visita.
4. Esperado pro dia seguinte: total de reads cai pra 60k–90k/dia.

## Rollback (se precisar)

**Backend:** reverter a linha de `throttleMs` pro original. Redeploy.

**Frontend:** abrir DevTools no painel, no console:
```js
Object.keys(sessionStorage).filter(k => k.startsWith('afilia:last_refresh_')).forEach(k => sessionStorage.removeItem(k))
```

E reverter as 2 alterações em `garantirDadosAtualizados`. Sem migration, sem dado perdido.

---

## O que NÃO está neste patch (próximos)

- **Patch H:** bypass de `prefetchDocMap` em `produto_daily`/`subid_daily` durante `refresh_range`. Corta mais ~10k/dia. Precisa de mais cuidado pra não regredir economia de writes.
- **Patch I:** in-flight dedup em `metaAdsDailyCache`. Corta ~5k/dia. Precisa eu ver o arquivo antes.
- **Patches A–F (frontend):** cache unificado de período, ShopeePage, Garimpo, AlertasBell, Backup, Traffic. Da conversa anterior. Corta mais ~10k/dia somados.

Aplique este G primeiro e me passe o número do console de amanhã.

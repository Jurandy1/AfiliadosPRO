# Patch: Reduzir leituras Firestore de ~92k/dia para ~30-35k/dia

**Projeto:** AffiliateHub Pro / `projetoafiliado-9ff07`
**Arquivos tocados:** `functions/lib/monthlyRollup.js`, `functions/index.js`
**Risco:** Baixo. Cada mudança é localizada e reversível.

## O que muda e o que NÃO muda

**NÃO muda:**
- Dados continuam vindo da API Shopee (`conversionReport`) e Meta (`/insights`)
  na mesma frequência (4x/dia incremental + 6x/dia recent + 1x/dia reconcile).
- Fórmulas de agregação (`buildShopeePanelAppDayMap`, `agruparPorData`, etc).
- Granulares (`shopee_daily`, `subid_daily`, `produto_daily`, `meta_ads_daily`,
  `log_perdas`, `clique_daily`) continuam sendo atualizados em CADA sync.
- `prefetchDocMap` continua ativo (economiza ~14k writes/dia — não mexer).
- `SHOPEE_AGG_MODE=promosapp` e toda calibração permanece.

**MUDA:**
- `painel_resumo` e `subid_mensal` (buckets mensais) deixam de ser reconstruídos
  6-8 vezes/dia. Passam a ter cache de 30 min: se foi reconstruído há menos
  de 30 min, pula. Pior caso: bucket fica até 30 min "atrasado" em relação
  ao granular. O dashboard que consulta granulares para o dia corrente
  não sente diferença.
- Reconcile diário (`shopeeDailyReconcile`, `metaDailyReconcile`) deixa de
  reconstruir o MÊS ANTERIOR automaticamente. Se houver mudança retroativa,
  o `shopee_daily` do dia afetado entra no `diasRollup` e o mês é reconstruído
  por consequência. Reconstrução "preventiva" de mês fechado é removida.

## Diagnóstico que motivou os patches

Logs de 15h (14/jun 22:33 → 15/jun 13:28):
- 27 tentativas de `[monthlyRollup]` → **14 OK + 13 FALHA** (DEADLINE_EXCEEDED, 48% falha)
- `reconcile_15d` puxou 9.598 conversões + tentou reconstruir abril, maio E junho
- Junho é reconstruído ~8x/dia (1x por sync — `recent_3d`, `incremental`,
  `month_auto`, `reconcile`, `metaRecent`, `metaReconcile`)
- Cada `rebuildMonthlyBuckets` lê ~3.500 reads de junho ou ~7.500 reads de maio

---

# PATCH A — Remover reconstrução do mês anterior em reconcile

**Ganho:** ~10-15k reads/dia.
**Por que é seguro:** se um dia de maio é tocado pelo reconcile, ele entra
em `diasRollup` e maio é reconstruído de qualquer forma. A linha removida
força a reconstrução de maio MESMO quando nenhum dia de maio mudou — desperdício.

## Arquivo: `functions/lib/monthlyRollup.js`

### Localizar:

```js
async function refreshMonthlyBucketsForDates(db, dateStrs, { reconcile = false } = {}) {
  const months = monthKeysForDates(dateStrs);
  if (reconcile) {
    for (const mk of [...months]) months.push(previousMonthKey(mk));
  }
  const unique = [...new Set(months)].filter(Boolean).sort();
  const results = [];
  for (const monthKey of unique) {
    try {
      results.push(await rebuildMonthlyBuckets(db, monthKey));
    } catch (err) {
      console.warn(`[monthlyRollup] falha ${monthKey}:`, err?.message || err);
    }
  }
  return results;
}
```

### Substituir por:

```js
/**
 * Atualiza buckets mensais a partir das coleções granulares.
 *
 * @param {Array<string>} dateStrs - datas no formato YYYY-MM-DD que foram tocadas
 * @param {Object} opts
 * @param {boolean} opts.reconcile - mantido para compat; sem efeito (ver PATCH A do log)
 * @param {number} opts.throttleMs - se > 0, pula meses cujo painel_resumo
 *                                   foi atualizado há menos de throttleMs (ver PATCH B)
 */
async function refreshMonthlyBucketsForDates(db, dateStrs, { reconcile = false, throttleMs = 0 } = {}) {
  // PATCH A: removida a expansão `previousMonthKey` em reconcile.
  // Se mudança retroativa atinge maio/abril, o dia afetado entra em dateStrs
  // pelo próprio runShopeeSync e o mês é reconstruído organicamente.
  // Reconstruir mês fechado "por garantia" custa ~7k reads e é redundante.
  void reconcile;

  const months = monthKeysForDates(dateStrs);
  const unique = [...new Set(months)].filter(Boolean).sort();
  const results = [];

  for (const monthKey of unique) {
    // PATCH B: throttle por mês usando painel_resumo.updatedAt como timestamp.
    if (throttleMs > 0) {
      try {
        const snap = await db.collection("painel_resumo").doc(monthKey).get();
        const lastTs = snap.exists ? (snap.data()?.updatedAt?.toMillis?.() || 0) : 0;
        if (lastTs > 0 && (Date.now() - lastTs) < throttleMs) {
          const ageMin = Math.round((Date.now() - lastTs) / 60000);
          console.log(`[monthlyRollup] ${monthKey} skip (throttle: rebuilt ${ageMin}min ago)`);
          results.push({ monthKey, skipped: "throttled", ageMs: Date.now() - lastTs });
          continue;
        }
      } catch (e) {
        // se ler falhar (rede/permission), segue e tenta rebuildar
        console.warn(`[monthlyRollup] throttle check ${monthKey}:`, e?.message || e);
      }
    }

    try {
      results.push(await rebuildMonthlyBuckets(db, monthKey));
    } catch (err) {
      console.warn(`[monthlyRollup] falha ${monthKey}:`, err?.message || err);
    }
  }
  return results;
}
```

**Nota:** `previousMonthKey` continua exportado e usado em outros lugares
(se houver). Apenas a chamada automática em `reconcile: true` foi removida.

---

# PATCH B — Throttle de 30 min nos chamadores de alta frequência

**Ganho:** ~15-25k reads/dia.
**Por que é seguro:** o granular (`shopee_daily`, `subid_daily`, `produto_daily`)
continua sendo gravado em CADA sync. O dashboard pode ler o granular para o
dia corrente. Só o agregado mensal (`painel_resumo`/`subid_mensal`) pode
ficar até 30 min defasado — e quando ele é reconstruído, soma o granular
atualizado, então o resultado final é correto.

## Arquivo: `functions/index.js`

### B.1 — `runShopeeSync` (final da função)

### Localizar:

```js
    const reconcileRollup = /reconcile/i.test(String(label || ""));
    refreshMonthlyBucketsForDates(db, diasRollup, { reconcile: reconcileRollup })
      .then((r) => {
        if (r?.length) console.log(`[monthlyRollup] ${label}:`, r.map((x) => x.monthKey).join(", "));
      })
      .catch((err) => console.warn("[monthlyRollup] falhou:", err?.message || err));
```

### Substituir por:

```js
    // PATCH B: throttle de 30 min para syncs frequentes, force em reconcile.
    // Labels frequentes (recent_3d, month_auto_*, refresh_range_*) rodam várias
    // vezes/hora e geram rollups redundantes. Reconcile (1x/dia) força rebuild.
    const isReconcile = /reconcile/i.test(String(label || ""));
    const isBackfill = /^backfill_/i.test(String(label || ""));
    const isManualRefresh = /^refresh_/i.test(String(label || ""));
    const throttleMs = (isReconcile || isBackfill || isManualRefresh)
      ? 0                    // força rebuild
      : 30 * 60 * 1000;      // 30 min throttle para incremental/recent/month_auto
    refreshMonthlyBucketsForDates(db, diasRollup, { throttleMs })
      .then((r) => {
        if (r?.length) {
          const summary = r.map((x) => x.skipped ? `${x.monthKey}(skip)` : x.monthKey).join(", ");
          console.log(`[monthlyRollup] ${label}:`, summary);
        }
      })
      .catch((err) => console.warn("[monthlyRollup] falhou:", err?.message || err));
```

**Justificativa do `isManualRefresh`:** quando o usuário clica "atualizar
este dia" no painel, ele espera ver bucket atualizado. Mantém force nessa rota.

### B.2 — `metaDailyRecentSync`

### Localizar:

```js
        refreshMonthlyBucketsForDates(db, dias, { reconcile: false })
          .catch((err) => console.warn("[monthlyRollup/metaRecent] falhou:", err?.message || err));
```

### Substituir por:

```js
        // PATCH B: meta recent roda 6x/dia. Throttle de 30 min evita rebuild redundante.
        refreshMonthlyBucketsForDates(db, dias, { throttleMs: 30 * 60 * 1000 })
          .catch((err) => console.warn("[monthlyRollup/metaRecent] falhou:", err?.message || err));
```

### B.3 — `metaDailyReconcile`

### Localizar:

```js
        refreshMonthlyBucketsForDates(db, dias, { reconcile: true })
          .catch((err) => console.warn("[monthlyRollup/metaReconcile] falhou:", err?.message || err));
```

### Substituir por:

```js
        // PATCH B: meta reconcile roda 1x/dia. Sem throttle (força rebuild).
        refreshMonthlyBucketsForDates(db, dias, { throttleMs: 0 })
          .catch((err) => console.warn("[monthlyRollup/metaReconcile] falhou:", err?.message || err));
```

---

# PATCH C — Resiliência do rollup contra rollups concorrentes

**Ganho:** corrige 48% de DEADLINE_EXCEEDED → ~0%. Não é economia direta
de reads, mas evita reads desperdiçados em tentativas que falham.

**Causa raiz das falhas (vista nos logs):**
Múltiplas syncs terminam ao mesmo tempo, cada uma dispara
`refreshMonthlyBucketsForDates` para junho. Vários `rebuildMonthlyBuckets`
do MESMO mês rodam em paralelo competindo por conexões gRPC. Quando a
conexão satura, alguns esperam até 300s e morrem com DEADLINE_EXCEEDED.

Com **Patch B (throttle)**, isso já cai drasticamente: só 1 rollup/mês a
cada 30 min. Mas vale adicionar lock por mês para garantir.

## Arquivo: `functions/lib/monthlyRollup.js`

### Localizar (logo após a função `monthKeysForDates`):

```js
function monthKeysForDates(dateStrs) {
  const keys = new Set();
  for (const d of dateStrs || []) {
    if (typeof d === "string" && d.length >= 7) keys.add(d.slice(0, 7));
  }
  return [...keys];
}
```

### Substituir por:

```js
function monthKeysForDates(dateStrs) {
  const keys = new Set();
  for (const d of dateStrs || []) {
    if (typeof d === "string" && d.length >= 7) keys.add(d.slice(0, 7));
  }
  return [...keys];
}

// PATCH C: lock em memória por mês.
// Evita rollups concorrentes do mesmo mês na mesma instância da Cloud Function.
// (Múltiplas instâncias ainda podem rodar — mas o throttle do Patch B cobre isso.)
const _rollupLocks = new Map();

async function withRollupLock(monthKey, fn) {
  while (_rollupLocks.has(monthKey)) {
    await _rollupLocks.get(monthKey).catch(() => null);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      _rollupLocks.delete(monthKey);
    }
  })();
  _rollupLocks.set(monthKey, promise);
  return promise;
}
```

### Localizar (dentro de `refreshMonthlyBucketsForDates`, o bloco `try` que chama `rebuildMonthlyBuckets`):

```js
    try {
      results.push(await rebuildMonthlyBuckets(db, monthKey));
    } catch (err) {
      console.warn(`[monthlyRollup] falha ${monthKey}:`, err?.message || err);
    }
```

### Substituir por:

```js
    try {
      // PATCH C: serializa rollups do mesmo mês na mesma instância
      const r = await withRollupLock(monthKey, () => rebuildMonthlyBuckets(db, monthKey));
      results.push(r);
    } catch (err) {
      console.warn(`[monthlyRollup] falha ${monthKey}:`, err?.message || err);
    }
```

---

# Verificação após deploy

## Imediato (próximos 30 min)

1. Deploy: `firebase deploy --only functions`
2. Cloud Logging — verificar logs novos:
   ```
   resource.type="cloud_function"
   "[monthlyRollup]" AND ("skip" OR "skip (throttle")
   ```
   Esperado: linhas tipo `[monthlyRollup] recent_3d: 2026-06(skip)` aparecendo em
   syncs `recent_3d`, `month_auto_*`, `incremental_cursor`.

3. Verificar que não há mais tentativas para `2026-04` ou `2026-05` em
   labels que não sejam `reconcile_15d` ou `metaDailyReconcile`:
   ```
   resource.type="cloud_function"
   "[monthlyRollup]" AND ("2026-04" OR "2026-05")
   ```

## 24h depois

4. Console Firebase → Firestore → Uso:
   - Leituras: esperado ~30-40k/dia (vs. ~92k antes)
   - Gravações: deve manter ~3-4k/dia (igual ao antes — não mexemos nessa)

5. Cloud Logging — taxa de falha do rollup:
   ```
   resource.type="cloud_function"
   "[monthlyRollup] falha"
   ```
   Esperado: 0-2 falhas/dia (vs. 13 falhas/15h antes).

## Sanidade dos dados

6. Abrir o painel e conferir alguns dias:
   - Filtro "Hoje" → KPIs idênticos ao antes do patch
   - Filtro "Este mês" → KPIs idênticos ao antes do patch
   - Filtro "Mês anterior" → KPIs idênticos ao antes do patch

   Se algum número estiver diferente, é sinal de que algo no `painel_resumo`
   estava INCORRETO antes (devido às 48% de rollups falhando). Forçar
   reconstrução manual:

   ```
   GET https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/rebuildMonthlyBuckets?token=contar-docs-2026-jurandy&month=2026-06
   ```

---

# Rollback

Caso algo dê errado, reverte na ordem inversa:

1. **Reverter Patch C:** voltar `try { results.push(await rebuildMonthlyBuckets...` original.
2. **Reverter Patch B:** voltar `refreshMonthlyBucketsForDates(db, ..., { reconcile: ... })`
   nos 3 chamadores de `index.js`.
3. **Reverter Patch A:** voltar o `if (reconcile) { for (const mk ...) }` em
   `refreshMonthlyBucketsForDates`.

Após reverter, deploy: `firebase deploy --only functions`.

---

# Resumo do impacto esperado

| Métrica | Antes | Depois |
|---|---|---|
| Leituras/dia | ~92.000 | ~30-35.000 |
| Gravações/dia | ~3.300 | ~3.300 (igual) |
| Rollups OK/dia | ~22 | ~6-8 |
| Rollups FALHA/dia | ~20 | 0-2 |
| `painel_resumo` defasagem máx | erratico (falhas) | 30 min |
| Precisão dos KPIs do dashboard | 100% | **100%** |
| Lucro/ROI cálculo client-side | preservado | preservado |
| `SHOPEE_AGG_MODE=promosapp` | preservado | preservado |

**Próximos passos não cobertos neste patch (futuras otimizações):**
- Cursor temporal em `getNovasConversoes` (ganho menor, ~1-2k reads/dia)
- Investigação do uso de `shopee_events` (45.126 docs — está sendo lido?)
- Lazy-load de `meta_ads` no frontend (~200 reads/sessão hoje)

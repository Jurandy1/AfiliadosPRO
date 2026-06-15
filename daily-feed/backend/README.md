# Backend — alimentacao diaria (Cloud Functions)

Codigo em [`functions/index.js`](../../functions/index.js). Esta pasta documenta o que grava no Firestore.

## Shopee

| Funcao interna | Descricao |
|----------------|-----------|
| `runShopeeSync` | Puxa API Affiliate, agrega, grava colecoes diarias |
| `agruparPorData` | Agregacao central por dia |
| `buildShopeePanelAppDayMap` | Modo PromosApp (`node_once`, sem UNPAID nos KPIs) |
| `getShopeeAggregationMode` | Le `SHOPEE_AGG_MODE` (padrao: `promosapp`) |

### Exports HTTP / agendados

| Export | Tipo | Uso |
|--------|------|-----|
| `shopeeIncrementalSync` | schedule 4x/dia | Pedidos novos via cursor |
| `shopeeRecentDaysSync` | schedule | Refresh ultimos 3 dias |
| `shopeeDailyReconcile` | schedule 04:00 BRT | Reconcilia 15 dias |
| `shopeeBackfillNow` | HTTP | Sync hoje manual |
| `shopeeBackfillRange` | HTTP | Re-sync intervalo (usado pelo `resync-shopee-range.ps1`) |

### Colecoes gravadas

- `shopee_daily/{YYYY-MM-DD}` — KPIs do dia
- `subid_daily/{data}_{subid}` — metricas por campanha
- `produto_daily/{data}_{itemId}` — metricas por produto
- `log_perdas` — cancelamentos

## Meta (Facebook Ads)

| Funcao | Descricao |
|--------|-----------|
| `runMetaDailySync` | Insights por dia → `meta_ads_daily` |
| `runMetaSync` | Snapshot campanhas → `meta_ads` |

### Exports

- `metaDailySync` — gasto diario por SubID
- `metaBackfillDaily` — preenchimento historico
- `metaDailyReconcile` — reconciliacao

## Rollup mensal

[`functions/lib/monthlyRollup.js`](../../functions/lib/monthlyRollup.js):

- `rebuildMonthlyBuckets` — `shopee_daily` → `painel_resumo` + `subid_mensal`
- Endpoint: `rebuildMonthlyBuckets` (HTTP)

Com `VITE_SHOPEE_PROMOSAPP_KPI=1`, o front **ignora** `painel_resumo` e le sempre `shopee_daily`.

## Variaveis de ambiente

Arquivo: `functions/.env.projetoafiliado-9ff07`

```
SHOPEE_AGG_MODE=promosapp
SHOPEE_APP_ID=...
SHOPEE_SECRET=...
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_IDS=...
```

Deploy: `powershell -ExecutionPolicy Bypass -File .\deploy-functions.ps1`

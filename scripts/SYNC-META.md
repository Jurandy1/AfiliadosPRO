# Sync Meta (gasto diário)

## Automático (Firebase)

| Function | Horário (BRT) | O que faz |
|----------|---------------|-----------|
| `metaDailyRecentSync` | **A cada 2h** | `meta_ads_daily` — últimos **7 dias** até ontem |
| `metaDailyReconcile` | **04:00** | Reconcile — últimos **35 dias** |
| `metaDailySync` | A cada 6h | `meta_ads` — bloco `last_30d` (anúncios) |

Health: Firestore `sync_state/meta_health`

## Deploy

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npx firebase deploy --only functions:metaDailyRecentSync,functions:metaDailyReconcile,functions:metaBackfillDaily,functions:metaDailySync --project projetoafiliado-9ff07
```

## Manual (90 dias)

```cmd
curl.exe -X POST "https://metabackfilldaily-ncjpjjcdya-rj.a.run.app/?days=90" -H "Authorization: Bearer SEU_SECRET" -H "Content-Length: 0"
```

## Dashboard

Filtros **Hoje** e **Ontem** disparam também `metaBackfillDaily?days=7` (usa `VITE_BACKFILL_SECRET`).

KPI usa `meta_ads_daily` quando existir (`shopee_daily+meta_daily` no console).

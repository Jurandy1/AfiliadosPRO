# Operacoes diarias

Rotina para manter o dashboard alinhado.

## Todo dia (automatico)

Os jobs agendados nas Cloud Functions ja rodam sozinhos:

1. **Shopee incremental** — 4x/dia
2. **Shopee recent 3d** — atualiza dias recentes
3. **Shopee reconcile** — 04:00 BRT, ultimos 15 dias
4. **Meta daily** — gasto do dia anterior

Nenhuma acao manual necessaria se o deploy estiver atualizado.

## Quando rodar manualmente

### Deploy apos mudanca no backend

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-functions.ps1
```

### Re-sync Shopee (historico ou dia especifico)

```powershell
# Um dia
powershell -ExecutionPolicy Bypass -File .\resync-shopee-range.ps1 -StartDate 2026-06-11 -EndDate 2026-06-11

# Mes inteiro
powershell -ExecutionPolicy Bypass -File .\resync-shopee-range.ps1 -StartDate 2026-06-01
```

### Rebuild buckets mensais (opcional, legado)

```powershell
node scripts/backfill-monthly-buckets.cjs
```

### Diagnosticar lucro/ROI de um dia

```powershell
node scripts/analyze-lucro-roi-dia.cjs 2026-06-11
```

### Auditar split pendente/concluido vs PromosApp

```powershell
node scripts/audit-promosapp-split.cjs 2026-06-11 --target-pend 597 --target-concl 11 --target-pend-com 1821.53

node scripts/audit-promosapp-split.cjs 2026-06-11 --csv "C:\caminho\AffiliateCommissionReport.csv"
```

### Teste Python — metricas iguais ao dashboard (PromosApp)

```powershell
python scripts/test-dashboard-shopee.py 2026-06-11
```

Usa `VITE_AFFILIATE_GRAPHQL_URL` + `VITE_BACKFILL_SECRET` do `.env` (sem colocar secret no codigo).

## Checklist pos-deploy

1. Deploy functions (`deploy-functions.ps1`)
2. Re-sync do periodo visivel no dashboard
3. `npm run dev` e validar KPIs vs PromosApp
4. Conferir `sync_state/shopee` no Firestore (health `promosapp-node-once`)

## Documentacao relacionada

- [`scripts/ATUALIZAR-META-SHOPEE.md`](../../scripts/ATUALIZAR-META-SHOPEE.md)
- [`scripts/SYNC-META.md`](../../scripts/SYNC-META.md)

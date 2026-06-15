# Alinhar mês ao app Shopee (fiel à API)

1. No app **Shopee Afiliados**, abra o mês (ex.: maio/2026) e anote:
   - Pedidos, comissão estimada, vendas/GMV, itens vendidos.

2. Edite `functions/index.js` → `SHOPEE_OFICIAL_PERIOD_REF`:

```js
"2026-05": {
  pedidos: 11900,   // do app
  comissao: 35800,  // do app (sem R$, só número)
  gmv: 701900,
  itens: 13600,
},
```

3. Deploy + backfill:

```cmd
cd C:\Users\PC\Desktop\Afiliadoteste-main
npx firebase deploy --only functions:shopeeBackfillNow --project projetoafiliado-9ff07
curl.exe -X POST "https://shopeebackfillnow-ncjpjjcdya-rj.a.run.app/?startDate=2026-05-01&endDate=2026-05-31&force=1" -H "Authorization: Bearer SEU_SECRET" -H "Content-Length: 0" -m 600
```

4. No JSON de resposta, confira:
   - `promosRulesVersion`: `shopee-official-exact-2026-05`
   - `shopeeOficialPeriodAlign.depois`: comissão 35800, pedidos 11900, etc.

5. F5 no dashboard (período 01/05–31/05) — deve bater **exato** com o app.

**Nota:** Os totais do mês seguem `SHOPEE_OFICIAL_PERIOD_REF` (screenshot do app). O detalhe por dia é proporcional à API.

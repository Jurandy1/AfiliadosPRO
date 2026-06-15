# Metas oficiais Shopee (auditoria — não escala)

Coleção Firestore: `config/shopee_oficial`

```json
{
  "periods": {
    "2026-05": {
      "pedidos": 11900,
      "comissao": 35800,
      "gmv": 701900,
      "itens": 13600
    }
  },
  "updatedAt": "<server timestamp>"
}
```

## Papel das metas

| Uso | Comportamento |
|-----|----------------|
| **Auditoria** | Comparar soma da API (`conversionReport`) vs screenshot do app Shopee |
| **Calibração de regra** | Backend testa `SHOPEE_PANEL_VARIANTES` e escolhe a mais próxima (ex.: `api_faithful_v2`) |
| **Escala ao painel** | **Desligada por padrão** — só se `SHOPEE_ALIGN_PANEL_EXACT=1` (Functions) e `VITE_SHOPEE_ALIGN_PANEL=1` (front) |

Valores no dashboard vêm da **API agregada**, não são multiplicados para bater R$ 35.800.

## Testes locais (API vs CSV)

Na raiz do projeto, com credenciais Shopee no ambiente:

```powershell
cd C:\Users\PC\Desktop\Afiliadoteste-main
$env:SHOPEE_APP_ID="..."
$env:SHOPEE_SECRET="..."
node scripts/test-shopee-mes.cjs 2026-05
node scripts/test-shopee-vs-csv.cjs "C:\Users\PC\Desktop\BATIMENTO DE COMPRAS\MAIO.csv" 2026-05
node scripts/analyze-batimento-csv.cjs "C:\Users\PC\Desktop\BATIMENTO DE COMPRAS\MAIO.csv" 2026-05
```

Wrappers `.cmd`: `scripts\test-shopee-mes.cmd`, `test-shopee-vs-csv.cmd`, `test-shopee-pedido.cmd`.

Documentação completa de batimento: `docs/SHOPEE-API-BATIMENTO-COMPLETO.md` (CSV de referência em `BATIMENTO DE COMPRAS`).

## Deploy / backfill

1. Deploy functions com `SHOPEE_ALIGN_PANEL_EXACT` omitido ou `=0` e `SHOPEE_SNAP_CSV_BATIMENTO=0`.
2. Backfill via URL `shopeeBackfillNow` (ver `.env` / `BACKFILL_SECRET`).
3. Dashboard: badge **Dados: API fiel**; snap CSV só com `VITE_SHOPEE_SNAP_CSV_BATIMENTO=1`.

Backend e frontend leem `config/shopee_oficial`; se não existir, usam fallback em `src/config/shopeeOficialRef.js` e `functions/lib/shopeeOficialRef.js`.

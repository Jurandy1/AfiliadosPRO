# PATCH SYNC v2 — APLICAR AGORA

## 1️⃣ SQL no Supabase (SQL Editor → Run)

```sql
-- produto_daily UNIQUE
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produto_daily_data_item_id_key') THEN
    ALTER TABLE produto_daily ADD CONSTRAINT produto_daily_data_item_id_key UNIQUE (data, item_id);
  END IF;
END $$;

-- log_perdas: normalizar NULLs e criar UNIQUE composto
UPDATE log_perdas SET item_id = 'ni' WHERE item_id IS NULL;
UPDATE log_perdas SET conversion_id = 'nc' WHERE conversion_id IS NULL;

ALTER TABLE log_perdas
  ALTER COLUMN item_id SET DEFAULT 'ni',
  ALTER COLUMN conversion_id SET DEFAULT 'nc',
  ALTER COLUMN item_id SET NOT NULL,
  ALTER COLUMN conversion_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'log_perdas_natural_key') THEN
    ALTER TABLE log_perdas ADD CONSTRAINT log_perdas_natural_key UNIQUE (data, order_id, item_id, conversion_id);
  END IF;
END $$;

-- Verificação
SELECT tc.table_name, tc.constraint_name, string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS colunas
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('produto_daily', 'log_perdas')
  AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_name, tc.constraint_name;
```

Resultado esperado: 2 linhas (uma de cada tabela).

---

## 2️⃣ Editar `functions/lib/supabaseSync.js`

Abre o arquivo. Procura `case "produto_daily":` e substitui o **case inteiro** (até o `break;`) por:

```js
        case "produto_daily":
          tabela = "produto_daily";
          onConflict = "data,item_id";
          mappedRows = rows.map(({ data }) => ({
            data: data.data,
            item_id: String(data.produto_id || data.item_id || "desconhecido"),
            shop_id: data.shop_id || data.id_loja || null,
            nome: String(data.nome || "Produto"),
            comissao: Number(data.comissao_estimada ?? data.comissoes ?? 0),
            comissao_concluida: Number(data.comissoes_concluidas ?? data.comissao_concluida ?? 0),
            comissao_pendente: Number(data.comissoes_pendentes ?? data.comissao_pendente ?? 0),
            comissao_cancelada: Number(data.comissoes_canceladas ?? data.comissao_cancelada ?? 0),
            vendas: Math.round(Number(data.vendas ?? data.qtd_itens ?? 0)),
            qtd_itens: Math.round(Number(data.qtd_itens ?? 0)),
            faturamento: Number(data.faturamento ?? 0),
            cliques: Math.round(Number(data.cliques ?? 0)),
            ultima_sync: new Date().toISOString(),
          }));
          break;
```

Procura `case "log_perdas":` e substitui o **case inteiro** por:

```js
        case "log_perdas":
          tabela = "log_perdas";
          onConflict = "data,order_id,item_id,conversion_id";
          mappedRows = rows.map(({ data }) => ({
            data: data.data,
            order_id: String(data.orderId || data.order_id || "no"),
            item_id: String(data.itemId || data.item_id || "ni"),
            conversion_id: String(data.conversionId || data.conversion_id || "nc"),
            subid: data.subid || data.sub_id || null,
            comissao_perdida: Number(data.comissao_perdida ?? 0),
            valor_pedido: Number(data.faturamento_perdido ?? data.valor_pedido ?? 0),
            motivo: (String(data.status || data.motivo || "").trim() || null),
            item_notes: data.item_notes || data.itemNotes || null,
            detectado_em: new Date().toISOString(),
          }));
          break;
```

**Não toca** nos outros cases (shopee_daily, subid_daily, meta_ads, meta_ads_daily, meta_demographics, importacoes, sync_state). Esses já funcionam.

---

## 3️⃣ Deploy

```powershell
cd C:\Users\PC\Music\Afiliadoteste-Superbase
firebase deploy --only "functions:shopeeRecentDaysSync,functions:shopeeIncrementalSync,functions:shopeeDailyReconcile,functions:shopeeMonthAutoSync"
```

---

## 4️⃣ Disparar sync manual + ver logs

```powershell
curl -X POST -H "Authorization: Bearer SEU_META_SYNC_SECRET" "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?days=3&force=1"
```

Espera 1 min, depois:

```powershell
firebase functions:log --only shopeeBackfillNow --lines 40
```

**Sucesso** = nenhum erro `Could not find the 'XXX' column` e a linha de fim mostra `produto_daily=NNN | log_perdas=NNN` com NNN > 0.

---

## 5️⃣ Confirmar no Supabase

```sql
SELECT data, COUNT(*) AS produtos, SUM(comissao) AS comissao, MAX(ultima_sync) AS ultimo
FROM produto_daily WHERE data >= CURRENT_DATE - INTERVAL '3 days'
GROUP BY data ORDER BY data DESC;

SELECT data, COUNT(*) AS perdas, SUM(comissao_perdida) AS perdido, MAX(detectado_em) AS ultimo
FROM log_perdas WHERE data >= CURRENT_DATE - INTERVAL '3 days'
GROUP BY data ORDER BY data DESC;
```

`ultimo` deve ser de minutos atrás. Se sim, **migração 100% funcional** — Shopee/Meta sincronizando em tempo real do Firebase pro Supabase a cada 6h.

# PATCH SYNC v3 — Corrigir skip-unchanged que mata o Supabase

## Diagnóstico

Backfill de 3 dias hoje (19/06 22:08) processou Shopee corretamente:
- `2026-06-16: 181 pedidos`
- `2026-06-17: 681 pedidos`
- `2026-06-18: 666 pedidos`

Mas resultado no Supabase:
- `2026-06-16: 621 produtos` (atualizou hoje)
- `2026-06-17: 672 produtos` (não atualizou — sobra do backfill antigo)
- `2026-06-18: VAZIO`

O log mostra `writes_omitidos=421`. Esses 421 docs **não foram pro Supabase também** porque o `applyPendingWrites` pula ambos quando o doc do Firestore não mudou.

Como dia 17/18 já estavam estáveis no Firestore desde execuções anteriores, o "skip-unchanged" decidiu "não precisa gravar nada" — sem saber que o Supabase **nunca tinha recebido** esses 17/18.

Resultado: o Supabase fica eternamente desatualizado pros dias que não mexem mais.

---

## Patch — editar `functions/index.js`

Localiza a função `applyPendingWrites`. Tem um bloco que parece com isso (caminho "skip-unchanged"):

```js
  for (const { ref, payload } of pending) {
    const existing = existingMap.get(ref.path);
    if (existing && payloadsIguais(payload, existing)) {
      ignorados++;
      state.skipped = (state.skipped || 0) + 1;
      continue;
    }
    state.batch.set(ref, payload, merge ? { merge: true } : undefined);
    supabaseUpserts.push({ tabela: ref.parent.id, id: ref.id, data: payload });
    state.count++;
    gravados++;
    await flush();
  }
```

**Substituir** por (única mudança: linha `supabaseUpserts.push` antes do `continue`):

```js
  for (const { ref, payload } of pending) {
    const existing = existingMap.get(ref.path);
    if (existing && payloadsIguais(payload, existing)) {
      ignorados++;
      state.skipped = (state.skipped || 0) + 1;
      // Firebase pula (igual), mas Supabase recebe upsert idempotente
      // pra garantir paridade mesmo se Supabase estiver atrás.
      supabaseUpserts.push({ tabela: ref.parent.id, id: ref.id, data: payload });
      continue;
    }
    state.batch.set(ref, payload, merge ? { merge: true } : undefined);
    supabaseUpserts.push({ tabela: ref.parent.id, id: ref.id, data: payload });
    state.count++;
    gravados++;
    await flush();
  }
```

---

## Deploy

```powershell
cd C:\Users\PC\Music\Afiliadoteste-Superbase
firebase deploy --only functions
```

Demora ~3 min. Aceita atualizar tudo — o `applyPendingWrites` é usado em várias funções.

---

## Forçar backfill dos dias defasados

```powershell
curl -X POST -H "Authorization: Bearer SEU_META_SYNC_SECRET" "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?startDate=2026-06-15&endDate=2026-06-19&force=1"
```

A `force=1` faz o `applyPendingWrites` rodar no caminho "sempre escreve". Como agora o caminho skip-unchanged também upserta no Supabase, qualquer execução futura mantém paridade. Mas pra **forçar uma sincronização completa AGORA**, o `force=1` garante.

---

## Verificação

```sql
SELECT data, COUNT(*) AS produtos, MAX(ultima_sync) AS ultimo
FROM produto_daily WHERE data >= '2026-06-15'
GROUP BY data ORDER BY data DESC;
```

Esperado: **5 linhas** (de 15 a 19), todas com `ultimo` próximo do horário atual.

Se o dia 19 vier vazio mesmo após o patch + backfill → me avisa, pode ter outra coisa.

---

## Sobre o PATCH v1 completo

Esse patch v3 é o item mais crítico do v1. As outras melhorias do v1 (logs de runtime claros, contadores de upserts, console.error em vez de warn) **continuam valendo pra apply** depois, mas elas só melhoram **diagnóstico** — não corrigem bug. Pode aplicar quando quiser.

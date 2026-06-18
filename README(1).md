# Teste de Checksum Incremental — Shopee Affiliate API

Script standalone pra validar a hipotese de "puxar tudo mas processar so o que mudou" **sem tocar no Firestore**.

## O que ele faz

1. Conecta direto na API GraphQL da Shopee (`open-api.affiliate.shopee.com.br/graphql`)
2. Puxa `conversionReport` pra cada dia do range que voce passar
3. Calcula um fingerprint do dia: contagem de conversoes, pedidos distintos, comissao total, GMV, status de cada pedido, fraud status de cada item, complete time de cada item
4. Salva tudo em `.checksums-test.json` local
5. Da segunda execucao em diante, mostra quais dias **realmente mudaram** vs **ficaram iguais**

Zero gravacao no Firestore. Zero deploy. Roda 100% na sua maquina.

## Pre-requisitos

- Node.js 18+ (usa `fetch` nativo)
- Suas credenciais Shopee: `SHOPEE_APP_ID` e `SHOPEE_SECRET`

## Setup

1. Crie um arquivo `.env` nesta pasta:
   ```
   SHOPEE_APP_ID=seu_app_id_aqui
   SHOPEE_SECRET=seu_secret_aqui
   ```
   (ou deixe o script encontrar o `.env` da pasta `functions/` do projeto — ele tenta varios caminhos)

2. Pronto. Sem `npm install`.

## Como usar

### Primeira execucao (cria baseline)

```bash
# Teste rapido com 2 dias (sem esperar rate limit)
node test-checksum-shopee.cjs --start 2026-06-15 --end 2026-06-16 --no-wait

# Mes inteiro (vai levar ~8min por causa do rate limit de 30s entre dias)
node test-checksum-shopee.cjs --month 2026-06

# Range customizado
node test-checksum-shopee.cjs --start 2026-06-01 --end 2026-06-10
```

Output esperado:
```
[env] carregado de ./.env
[shopee] APP_ID=123456, secret=********xyz
[range] 2026-06-15 -> 2026-06-16 (2 dias)
[checksums] primeira execucao, nada pra comparar ainda

[1/2] 2026-06-15
  🆕 NOVO | 758 conv, 652 pedidos | comissao=R$ 2374.87 | gmv=R$ 30000.00 | hash=a3f4b2c1... | 1.2s
  ... aguardando 29.8s (rate limit Shopee)

[2/2] 2026-06-16
  🆕 NOVO | 845 conv, 720 pedidos | comissao=R$ 2451.30 | gmv=R$ 31200.00 | hash=b1c2d3e4... | 1.3s

[saved] checksums em ./.checksums-test.json
```

### Segunda execucao (algumas horas depois)

```bash
# Mesmo comando
node test-checksum-shopee.cjs --start 2026-06-15 --end 2026-06-16 --no-wait
```

Output esperado (cenario realista: dia recente mudou, dia antigo nao):
```
[1/2] 2026-06-15
  🔴 MUDOU | 762 conv, 656 pedidos | comissao=R$ 2389.10 | gmv=R$ 30100.00 | hash=c5d6e7f8... | 1.2s
    Campos que mudaram:
      • conversoes: 758  →  762
      • pedidosDistintos: 652  →  656
      • comissaoTotal: 2374.87  →  2389.1
      • gmvTotal: 30000  →  30100
      • hashStatus: a3f4b2c1...  →  c5d6e7f8...

[2/2] 2026-06-16
  ✅ INALTERADO | 845 conv, 720 pedidos | comissao=R$ 2451.30 | gmv=R$ 31200.00 | hash=b1c2d3e4... | 1.3s
```

### Mes inteiro pra validar a tese real

```bash
# Roda 1x agora
node test-checksum-shopee.cjs --month 2026-06 --save-snapshots

# Vai dormir, acorda, roda de novo
node test-checksum-shopee.cjs --month 2026-06 --save-snapshots
```

Resumo final vai mostrar tipo:
```
RESUMO
================================================================================
  Total dias processados: 17
  Novos: 0
  Inalterados: 15  ← esses pulariam o processamento
  Mudaram: 2       ← esses precisariam reprocessar
  Erros: 0
  Total conversoes puxadas da API: 13420

  💰 Estimativa: numa segunda execucao 88% dos dias seriam SKIPADOS,
     o que reduziria reads do Firestore em proporcao similar.

  Dias que mudaram:
    • 2026-06-16  conversoes: 758→762; comissaoTotal: 2374.87→2389.10
    • 2026-06-17  conversoes: 845→1102; comissaoTotal: 2451.30→3120.50
```

**Esse output e a validacao que voce precisa antes de mexer no Cloud Function.**

## Flags

| Flag | O que faz |
|---|---|
| `--start YYYY-MM-DD` | Data inicial |
| `--end YYYY-MM-DD` | Data final |
| `--month YYYY-MM` | Atalho pra mes inteiro |
| `--no-wait` | Pula a espera de 30s entre dias (so use com 1-2 dias!) |
| `--save-snapshots` | Salva JSON bruto de cada dia em `./snapshots/YYYY-MM-DD.json` (util pra diff manual) |
| `--output FILE` | Nome do arquivo de checksums (default: `.checksums-test.json`) |
| `--verbose` | Mostra progresso de cada pagina do scrollId |

## Investigacao manual quando algo muda

Se um dia aparecer como MUDOU mas voce nao espera mudanca, rode com `--save-snapshots`. Vai gerar:

```
snapshots/2026-06-15.json   ← run de hoje
```

Pra comparar com a run anterior, faz backup antes:

```bash
# Antes da segunda run:
cp -r snapshots snapshots-run1

# Depois da segunda run:
diff <(jq -S . snapshots-run1/2026-06-15.json) <(jq -S . snapshots/2026-06-15.json) | head -50
```

Vai mostrar exatamente quais conversoes/pedidos/itens mudaram entre os dois pulls.

## O que esse teste valida

✅ **Valida**: que o hash de um dia "estavel" (sem mudancas) sai identico em duas execucoes consecutivas — provando que da pra usar como skip flag

✅ **Valida**: que o hash detecta mudancas reais quando elas acontecem (status PENDING→COMPLETED, fraudStatus mudando, novas conversoes chegando)

❌ **NAO valida**: a integracao com o Cloud Function — isso e o proximo passo se o teste passar

❌ **NAO valida**: o `monthlyRollup` incremental — outra etapa separada

## Custo do teste

- Chamadas a API Shopee: ~2 por dia (paginacao scrollId) × N dias
- Tempo: ~30s por dia (rate limit Shopee, nao o nosso codigo)
- Reads Firestore: **ZERO**
- Writes Firestore: **ZERO**

## Troubleshooting

**`HTTP 401` ou `Invalid Signature`**: confere se `SHOPEE_APP_ID` e `SHOPEE_SECRET` no `.env` estao corretos e sem aspas extras

**`Rate limit exceeded` (codigo 10030)**: tira o `--no-wait` ou aumenta o intervalo no codigo (linha do `31000` em `setTimeout`)

**`hasNextPage=true mas scrollId vazio`**: bug raro da Shopee, o script para na pagina atual e segue pro proximo dia. Roda de novo pra completar

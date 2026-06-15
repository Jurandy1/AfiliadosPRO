# Alimentacao diaria do dashboard

Pasta central de **tudo que alimenta o dashboard diariamente**: calculos (Shopee, Meta, produtos), sync com APIs, cache e operacoes.

## Onde esta o codigo

| Camada | Pasta | O que faz |
|--------|-------|-----------|
| **Frontend (calculo + leitura)** | [`src/daily-feed/`](../src/daily-feed/) | Formulas, orquestracao Firestore, cache, enriquecimento |
| **Backend (sync + gravacao)** | [`functions/index.js`](../functions/index.js) + [`daily-feed/backend/`](backend/) | API Shopee/Meta → Firestore |
| **Operacoes diarias** | [`daily-feed/ops/`](ops/) | Deploy, re-sync, scripts |

### Import no React

```js
import {
  finalizarKpisComissaoDashboard,
  getDashboardPainelPorPeriodo,
  garantirDadosAtualizados,
} from "@/daily-feed";
```

---

## Fluxo de dados

```
API Shopee ──► Cloud Functions ──► Firestore (shopee_daily, subid_daily, produto_daily)
API Meta   ──► Cloud Functions ──► Firestore (meta_ads_daily)
                                        │
                                        ▼
                              src/daily-feed (le + calcula)
                                        │
                                        ▼
                              DashboardPage (exibe)
```

---

## Estrutura `src/daily-feed/`

```
src/daily-feed/
├── index.js              ← import unico (@/daily-feed)
├── calc/                 ← FORMULAS (lucro, ROI, PromosApp, SubID, produtos)
│   ├── financeiroMetrics.js
│   ├── productMetrics.js
│   ├── subIdIntegrity.js
│   └── monthlyBucketPanel.js
├── feed/                 ← ORQUESTRACAO (Firestore, sync, cache de periodo)
│   ├── metricsRepository.js
│   ├── subIdHybridBundle.js
│   └── periodDataCache.js
├── enrichment/           ← Meta/Pinterest + produtos do periodo
│   ├── adsPeriodSpend.js
│   └── produtoPeriodo.js
├── sync/                 ← Quando sincronizar automaticamente
│   └── syncPolicy.js
├── cache/                ← Cache de leitura Firestore
└── utils/
    └── coldHotRange.js   ← Janela quente (2 dias) vs frio (bucket mensal)
```

---

## Colecoes Firestore (alimentadas diariamente)

| Colecao | Fonte | Usado em |
|---------|-------|----------|
| `shopee_daily/{data}` | Sync Shopee (PromosApp `node_once`) | KPIs gerais |
| `subid_daily/{data}_{subid}` | Sync Shopee | Tabela SubID |
| `produto_daily/{data}_{itemId}` | Sync Shopee | Ranking produtos |
| `meta_ads_daily/{data}_{subid}` | Sync Meta | Gasto por campanha |
| `painel_resumo/{YYYY-MM}` | Rollup mensal | Cache rapido (legado) |
| `clique_daily` | Sync cliques | Produtos / SubID |
| `log_perdas` | Pedidos cancelados | Card perdas |
| `sync_state/shopee`, `sync_state/meta` | Health dos syncs | Painel de status |

---

## Modo PromosApp (padrao)

- Backend: `SHOPEE_AGG_MODE=promosapp` em `functions/.env.projetoafiliado-9ff07`
- Comissao: 1x `totalCommission` por conversao (`node_once`)
- KPIs: exclui pedidos **UNPAID**
- Frontend: `VITE_SHOPEE_PROMOSAPP_KPI=1` (sempre le `shopee_daily`, nunca cache mensal antigo)

---

## Formulas principais (`calc/financeiroMetrics.js`)

| Metrica | Formula |
|---------|---------|
| Lucro KPI | comissao (concl. + pend.) − gasto − impostos |
| ROI | lucro / gasto |
| ROAS | comissao / gasto |
| Lucro SubID | comissao estimada − gasto (sem imposto) |

---

## Sync automatico (backend)

| Job | Horario | Acao |
|-----|---------|------|
| `shopeeIncrementalSync` | 4x/dia | Pedidos novos |
| `shopeeRecentDaysSync` | agendado | Ultimos 3 dias |
| `shopeeDailyReconcile` | 04:00 BRT | Reconcilia 15 dias |
| `metaDailySync` | agendado | Gasto Meta do dia |

Ver detalhes em [`backend/README.md`](backend/README.md) e rotina em [`ops/README.md`](ops/README.md).

---

## Arquivos fora desta pasta (ainda)

Estes arquivos **participam** do dashboard mas sao UI ou cadastro — nao movem para `daily-feed`:

- `src/platforms/dashboard/pages/DashboardPage.jsx` — tela
- `src/components/dashboard/*` — cards e graficos
- `src/platforms/shopee/repositories/productsRepository.js` — cadastro de produtos
- `src/platforms/shopee/config/shopeeOficialRef.js` — alinhamento painel oficial

Registro completo: [`MANIFEST.json`](MANIFEST.json)

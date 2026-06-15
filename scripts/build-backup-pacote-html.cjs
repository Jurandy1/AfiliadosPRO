const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "BACKUP_MENU_PACOTE.html");

const files = [
  "package.json",
  ".env.example",
  "src/services/firebase/client.js",
  "src/app/routes.jsx",
  "src/platforms/shopee/pages/BackupPage.jsx",
  "src/platforms/shopee/repositories/backupRepository.js",
  "src/platforms/shopee/services/shopeeApiService.js",
  "src/platforms/shopee/utils/backupGarimpoSettings.js",
  "src/platforms/shopee/utils/garimpoKeywordUtils.js",
  "src/platforms/shopee/utils/backupGrupoUtils.js",
  "src/platforms/shopee/utils/backupInsights.js",
  "src/platforms/shopee/components/backup/SugestoesRoboGarimpo.jsx",
  "src/platforms/shopee/components/backup/BackupGarimpoConfigTab.jsx",
  "src/platforms/shopee/components/backup/BackupGarimpoHistoricoTab.jsx",
  "src/platforms/shopee/components/backup/BackupListagemTab.jsx",
  "src/platforms/shopee/components/backup/BackupRadarRecompraTab.jsx",
  "src/platforms/shopee/components/backup/BackupToast.jsx",
  "src/platforms/shopee/components/backup/BackupConfirmDialog.jsx",
  "src/platforms/shopee/components/backup/GarimpoProdutoCard.jsx",
];

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readFile(rel) {
  const full = path.join(ROOT, rel);
  return fs.readFileSync(full, "utf8");
}

let sections = "";

for (const rel of files) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    sections += `<details class="file"><summary>${esc(rel)} — NÃO ENCONTRADO</summary></details>\n`;
    continue;
  }
  const content = fs.readFileSync(full, "utf8");
  const lines = content.split("\n").length;
  sections += `<details class="file"><summary>${esc(rel)} (${lines} linhas)</summary><pre><code>${esc(content)}</code></pre></details>\n`;
}

const backend = readFile("functions/index.js").split("\n").slice(5013, 5547).join("\n");
sections += `<details class="file"><summary>functions/index.js — garimpo + APIs backup (linhas 5014–5547)</summary><pre><code>${esc(backend)}</code></pre></details>\n`;

const template = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Backup & Contingência — Pacote completo (AfiliadoTeste)</title>
  <style>
    :root { --bg:#0f172a; --card:#1e293b; --text:#e2e8f0; --muted:#94a3b8; --accent:#f97316; --code:#0b1220; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); line-height:1.55; }
    header { background:linear-gradient(135deg,#1e293b,#0f172a); border-bottom:1px solid #334155; padding:2rem 1.5rem; }
    header h1 { margin:0 0 .5rem; font-size:1.6rem; }
    header p { margin:0; color:var(--muted); max-width:900px; }
    nav { position:sticky; top:0; z-index:10; background:#111827ee; backdrop-filter:blur(8px); border-bottom:1px solid #334155; padding:.75rem 1.5rem; display:flex; flex-wrap:wrap; gap:.5rem; }
    nav a { color:#93c5fd; text-decoration:none; font-size:.85rem; padding:.25rem .5rem; border-radius:.35rem; }
    nav a:hover { background:#1e293b; }
    main { max-width:1100px; margin:0 auto; padding:1.5rem; }
    section { background:var(--card); border:1px solid #334155; border-radius:12px; padding:1.25rem 1.5rem; margin-bottom:1.25rem; }
    h2 { margin-top:0; color:#f8fafc; font-size:1.15rem; border-bottom:1px solid #334155; padding-bottom:.5rem; }
    h3 { color:#cbd5e1; font-size:1rem; margin:1.25rem 0 .5rem; }
    table { width:100%; border-collapse:collapse; font-size:.88rem; }
    th, td { border:1px solid #334155; padding:.5rem .65rem; text-align:left; vertical-align:top; }
    th { background:#0f172a; }
    code, pre { font-family: ui-monospace, Consolas, monospace; font-size:.8rem; }
    pre { background:var(--code); border:1px solid #334155; border-radius:8px; padding:1rem; overflow:auto; max-height:70vh; white-space:pre; }
    .warn { background:#422006; border:1px solid #92400e; color:#fde68a; padding:.75rem 1rem; border-radius:8px; font-size:.9rem; }
    .ok { background:#052e16; border:1px solid #166534; color:#bbf7d0; padding:.75rem 1rem; border-radius:8px; font-size:.9rem; }
    details.file { margin:.5rem 0; border:1px solid #334155; border-radius:8px; overflow:hidden; }
    details.file summary { cursor:pointer; padding:.65rem 1rem; background:#0f172a; font-weight:600; font-size:.85rem; }
    details.file pre { margin:0; border:none; border-radius:0; max-height:60vh; }
    ol, ul { padding-left:1.25rem; }
    li { margin:.35rem 0; }
    .tag { display:inline-block; background:#334155; color:#e2e8f0; font-size:.75rem; padding:.15rem .45rem; border-radius:4px; margin-right:.25rem; }
    footer { text-align:center; color:var(--muted); font-size:.8rem; padding:2rem 1rem; }
  </style>
</head>
<body>
<header>
  <h1>Backup &amp; Contingência Pro — Pacote para diagnóstico externo</h1>
  <p>Projeto <strong>AfiliadoTeste</strong> (React + Vite + Firebase). Este arquivo HTML contém documentação, variáveis de ambiente, APIs, schema Firestore, fluxos, problemas conhecidos e <strong>todo o código-fonte</strong> do menu Backup. Gerado em ${new Date().toISOString().slice(0, 10)}.</p>
</header>

<nav>
  <a href="#rodar">Como rodar</a>
  <a href="#arquitetura">Arquitetura</a>
  <a href="#abas">Abas do menu</a>
  <a href="#env">Variáveis .env</a>
  <a href="#apis">APIs Cloud Functions</a>
  <a href="#firestore">Firestore</a>
  <a href="#garimpo">Robô Garimpo</a>
  <a href="#problemas">Problemas conhecidos</a>
  <a href="#teste-api">Testar API</a>
  <a href="#codigo">Código-fonte</a>
</nav>

<main>

<section id="rodar">
  <h2>1. Como rodar o menu Backup localmente</h2>
  <ol>
    <li>Clone o repositório e instale dependências: <code>npm install</code></li>
    <li>Copie <code>.env.example</code> → <code>.env</code> e preencha as URLs e o secret (ver seção Variáveis)</li>
    <li>Configure Firebase Auth — o app exige login (projeto <code>projetoafiliado-9ff07</code>)</li>
    <li>Inicie: <code>npm run dev</code> → abra <code>http://localhost:5173</code></li>
    <li>No menu lateral, clique em <strong>Backup</strong> (rota interna <code>backup</code> em <code>src/app/routes.jsx</code>)</li>
    <li>Backend (Cloud Functions): pasta <code>functions/</code> — deploy com <code>firebase deploy --only functions:shopeeGarimpoKeyword,functions:shopeeProductLookup,functions:shopeeBackupRefreshNow</code></li>
  </ol>
  <div class="warn"><strong>Importante:</strong> O menu Backup <em>não</em> roda só com este HTML. Ele precisa do app React + Firebase + Cloud Functions com secrets Shopee (<code>SHOPEE_APP_ID</code>, <code>SHOPEE_SECRET</code>, <code>META_SYNC_SECRET</code>).</div>
</section>

<section id="arquitetura">
  <h2>2. Arquitetura</h2>
  <pre>
┌─────────────────────────────────────────────────────────────────┐
│  BackupPage.jsx (React)                                         │
│  Abas: Grupos | Cadastrar | Listagem | Garimpo | Recompra | ... │
└────────────┬───────────────────────────────┬────────────────────┘
             │ Firestore (leitura/escrita)    │ HTTPS Cloud Functions
             ▼                                ▼
   backup_produtos                    shopeeProductLookup (lookup)
   backup_grupos                      shopeeBackupRefreshNow (refresh)
   produtos (histórico vendas)        shopeeGarimpoKeyword (robô garimpo)
                                      shopeeBackupSimilaresShop
                                      shopeeBackupRefreshGroupNow
             │                                │
             └────────────┬───────────────────┘
                          ▼
                   API Shopee Affiliate (GraphQL productOfferV2)
  </pre>
  <p><span class="tag">Frontend</span> React 18 + Vite + Tailwind + lucide-react + Firebase SDK 11</p>
  <p><span class="tag">Backend</span> Firebase Cloud Functions Node 20, região southamerica-east1</p>
  <p><span class="tag">Entry</span> <code>src/platforms/shopee/pages/BackupPage.jsx</code></p>
</section>

<section id="abas">
  <h2>3. Abas do menu Backup</h2>
  <table>
    <tr><th>Aba</th><th>ID</th><th>Componente</th><th>Função</th></tr>
    <tr><td>Ninhos/Grupos</td><td>grupos</td><td>BackupPage (AbaGrupos)</td><td>Agrupa principal + backups; robô garimpo; troca de principal</td></tr>
    <tr><td>Cadastrar link</td><td>cadastrar</td><td>AbaCadastrar</td><td>Cola URL Shopee → lookup → salva em backup_produtos</td></tr>
    <tr><td>Meus Backups</td><td>listagem</td><td>BackupListagemTab</td><td>Lista, edita apelido, atualiza via API, remove</td></tr>
    <tr><td>Garimpo inteligente</td><td>garimpo</td><td>BackupGarimpoHistoricoTab</td><td>Histórico de ofertas garimpadas (Firestore)</td></tr>
    <tr><td>Radar de recompra</td><td>recompra</td><td>BackupRadarRecompraTab</td><td>Produtos com histórico de venda para recompra</td></tr>
    <tr><td>Rastrear similares</td><td>similar</td><td>AbaSimilar</td><td>Similares da mesma loja (API + histórico)</td></tr>
    <tr><td>Configurações</td><td>garimpo_config</td><td>BackupGarimpoConfigTab</td><td>Tolerância de preço % (localStorage)</td></tr>
  </table>
  <h3>Robô de Garimpo (dentro de cada grupo expandido)</h3>
  <p>Componente <code>SugestoesRoboGarimpo.jsx</code> — ao expandir um grupo, busca alternativas na mesma loja via <code>shopeeGarimpoKeyword</code>. Fluxo backend:</p>
  <ol>
    <li>Firestore: backups já cadastrados na mesma <code>shopId</code></li>
    <li>Shopee API: <code>productOfferV2(shopId: X)</code></li>
    <li>Shopee API: <code>productOfferV2(keyword: "...", shopId: X)</code></li>
    <li>Ranqueia por relevância, comissão e faixa de preço</li>
  </ol>
</section>

<section id="env">
  <h2>4. Variáveis de ambiente (.env)</h2>
  <table>
    <tr><th>Variável</th><th>Obrigatória</th><th>Descrição</th></tr>
    <tr><td>VITE_BACKFILL_SECRET</td><td>Sim</td><td>Igual ao secret <code>META_SYNC_SECRET</code> no Firebase. Header: <code>Authorization: Bearer ...</code></td></tr>
    <tr><td>VITE_LOOKUP_URL</td><td>Sim</td><td>shopeeProductLookup — buscar produto por URL</td></tr>
    <tr><td>VITE_REFRESH_URL</td><td>Sim</td><td>shopeeBackupRefreshNow — atualizar 1 backup</td></tr>
    <tr><td>VITE_GROUP_REFRESH_URL</td><td>Opcional</td><td>shopeeBackupRefreshGroupNow — atualizar grupo inteiro</td></tr>
    <tr><td>VITE_SIMILARES_URL</td><td>Opcional</td><td>shopeeBackupSimilaresShop</td></tr>
    <tr><td>VITE_GARIMPO_KEYWORD_URL</td><td>Sim (garimpo)</td><td>shopeeGarimpoKeyword</td></tr>
  </table>
  <h3>Exemplo .env</h3>
  <pre>VITE_BACKFILL_SECRET=seu-meta-sync-secret
VITE_LOOKUP_URL=https://shopeeproductlookup-ncjpjjcdya-rj.a.run.app
VITE_REFRESH_URL=https://shopeebackuprefreshnow-ncjpjjcdya-rj.a.run.app
VITE_GROUP_REFRESH_URL=https://shopeebackuprefreshgroupnow-ncjpjjcdya-rj.a.run.app
VITE_SIMILARES_URL=https://shopeebackupsimilaresshop-ncjpjjcdya-rj.a.run.app
VITE_GARIMPO_KEYWORD_URL=https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoKeyword</pre>
</section>

<section id="apis">
  <h2>5. APIs Cloud Functions</h2>
  <table>
    <tr><th>Function</th><th>Método</th><th>Auth</th><th>Uso no Backup</th></tr>
    <tr><td>shopeeProductLookup</td><td>POST ?url=</td><td>Bearer META_SYNC_SECRET</td><td>Cadastrar produto por link</td></tr>
    <tr><td>shopeeBackupRefreshNow</td><td>POST ?itemId=</td><td>Bearer</td><td>Atualizar preço/comissão de 1 backup</td></tr>
    <tr><td>shopeeBackupRefreshGroupNow</td><td>POST ?grupoId=</td><td>Bearer</td><td>Atualizar todos do grupo</td></tr>
    <tr><td>shopeeGarimpoKeyword</td><td>POST JSON body</td><td>Bearer</td><td>Robô de garimpo contextual</td></tr>
    <tr><td>shopeeBackupSimilaresShop</td><td>POST ?shopId=</td><td>Bearer</td><td>Aba similares</td></tr>
    <tr><td>shopeeBackupRefreshDaily</td><td>Scheduler 6h BRT</td><td>—</td><td>Verificação automática diária (funciona)</td></tr>
  </table>
  <h3>Payload shopeeGarimpoKeyword (POST JSON)</h3>
  <pre>{
  "nome": "wid leg calca",
  "nomeCompleto": "Calça Wide Leg Jeans...",
  "apelido": "wid leg calca",
  "shopId": "1505037811",
  "comissaoPct": 5,
  "precoPrincipal": 49.9,
  "precoToleranciaAcimaPct": 100,
  "precoToleranciaAbaixoPct": 0,
  "limit": 5,
  "excludeItemIds": ["123","456"]
}</pre>
  <h3>Resposta</h3>
  <pre>{
  "success": true,
  "keyword": "wid leg calca",
  "ofertas": [...],
  "shopeeApiOk": false,
  "fonte": "backup_cadastrado",
  "motivoVazio": null,
  "backupsNaLoja": 1,
  "backupsBloqueados": 0
}</pre>
</section>

<section id="firestore">
  <h2>6. Firestore — coleções</h2>
  <h3>backup_produtos / doc: item_{itemId}</h3>
  <pre>itemId, shopId, nome, apelido, preco, comissao_pct, imagem, loja,
linkProduto, linkAfiliado, rating, vendas_shopee, periodoFim,
grupoId (null se livre), marcadoPrincipal, status_api, alertas,
cadastrado_em, ultima_verificacao</pre>
  <h3>backup_grupos / doc auto-id</h3>
  <pre>nome, principalItemId, backupItemIds[], historico[{data, motivo, principalAntigo, principalNovo}],
criado_em, atualizado_em</pre>
  <h3>produtos / item_{itemId} (histórico de vendas do afiliado)</h3>
  <pre>vendas, comissao_total, gmv_total, nome, loja, preco, comissao_pct...</pre>
</section>

<section id="garimpo">
  <h2>7. Robô de Garimpo — detalhes técnicos</h2>
  <ul>
    <li><strong>Termos de busca:</strong> <code>garimpoKeywordUtils.js</code> extrai palavra-chave do apelido ou nome (remove stop-words, tamanhos, etc.)</li>
    <li><strong>Faixa de preço:</strong> <code>backupGarimpoSettings.js</code> — tolerância % acima/abaixo do preço principal (localStorage)</li>
    <li><strong>Frontend abort:</strong> timeout 120s no fetch; fila serial (<code>enfileirarGarimpo</code>) evita rate limit</li>
    <li><strong>Re-render Firestore:</strong> <code>ultimaChaveBusca</code> + <code>chaveBusca</code> evitam re-fetch duplicado</li>
    <li><strong>motivoVazio:</strong> <code>shopee_indisponivel</code> | <code>todos_ja_no_grupo</code> | <code>nenhum_na_faixa</code></li>
  </ul>
</section>

<section id="problemas">
  <h2>8. Problemas conhecidos (jun/2026)</h2>
  <div class="warn">
    <strong>Robô de Garimpo sem sugestões na UI</strong> — causas identificadas:
    <ul>
      <li>API Shopee retorna <code>fetch failed</code> / <code>shopeeApiOk: false</code> (rate limit ou indisponibilidade)</li>
      <li>Fallback Firestore funciona se existir backup na mesma loja não bloqueado por <code>excludeItemIds</code></li>
      <li>Se todos os backups da loja já estão no grupo → <code>motivoVazio: todos_ja_no_grupo</code></li>
      <li>Filtro de preço com <code>Number("99,90")</code> → NaN (corrigido com <code>parsePrecoGarimpo</code>)</li>
      <li>Abort no browser (<code>NS_BINDING_ABORTED</code>) por re-renders do Firestore (corrigido parcialmente)</li>
    </ul>
  </div>
  <div class="ok">
    <strong>O que funciona:</strong> shopeeBackupRefreshDaily (40/40 produtos às 6h), cadastro por link, grupos, troca de principal, varrer ofertas.
  </div>
</section>

<section id="teste-api">
  <h2>9. Testar API do garimpo (curl / Node)</h2>
  <pre>curl -X POST \\
  -H "Authorization: Bearer SEU_META_SYNC_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"nome":"wid leg calca","shopId":"1505037811","comissaoPct":5,"precoPrincipal":49.9,"precoToleranciaAcimaPct":100,"precoToleranciaAbaixoPct":0,"limit":5,"excludeItemIds":[]}' \\
  "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoKeyword"</pre>
  <p>Resposta esperada com API Shopee fora: <code>ofertas: 1</code>, <code>fonte: "backup_cadastrado"</code>, <code>shopeeApiOk: false</code>.</p>
</section>

<section id="codigo">
  <h2>10. Código-fonte completo do menu Backup</h2>
  <p>Clique em cada arquivo para expandir. Total de ${files.length + 1} arquivos.</p>
  ${sections}
</section>

</main>
<footer>Gerado automaticamente por scripts/build-backup-pacote-html.cjs — AfiliadoTeste / projetoafiliado-9ff07</footer>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, template, "utf8");
console.log("Gerado:", OUT, "(" + Math.round(fs.statSync(OUT).size / 1024) + " KB)");

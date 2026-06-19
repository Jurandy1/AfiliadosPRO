const fs = require('fs');

const code = `import { supabase } from "../../../services/supabase/client";

const LOOKUP_URL = import.meta.env.VITE_LOOKUP_URL;
const REFRESH_URL = import.meta.env.VITE_REFRESH_URL;
const GROUP_REFRESH_URL = import.meta.env.VITE_GROUP_REFRESH_URL;
const SIMILARES_URL = import.meta.env.VITE_SIMILARES_URL;
const SECRET = import.meta.env.VITE_BACKFILL_SECRET;

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = { backups: { data: null, ts: 0 }, grupos: { data: null, ts: 0 } };

function _cacheValido(entry) { return entry.data !== null && (Date.now() - entry.ts) < CACHE_TTL_MS; }
export function invalidarCacheBackups() { _cache.backups = { data: null, ts: 0 }; _cache.grupos = { data: null, ts: 0 }; }

export async function lookupProdutoShopee(url) {
  if (!LOOKUP_URL || !SECRET) throw new Error("Configuração ausente: VITE_LOOKUP_URL ou VITE_BACKFILL_SECRET");
  const ctrl = new AbortController(); const timeoutId = setTimeout(() => ctrl.abort(), 30000);
  try {
    const response = await fetch(\`\${LOOKUP_URL}?url=\${encodeURIComponent(url)}\`, {
      method: "POST", headers: { Authorization: \`Bearer \${SECRET}\`, "Content-Type": "application/json" },
      body: "", signal: ctrl.signal,
    });
    if (!response.ok) throw new Error(\`Erro \${response.status}: \${await response.text()}\`);
    return await response.json();
  } finally { clearTimeout(timeoutId); }
}

export async function salvarBackup(produto, opcoes = {}) {
  const { apelido = "", marcadoPrincipal = false } = opcoes;
  const itemId = String(produto.itemId);
  const docId = \`item_\${itemId}\`;
  const dados = {
    ...produto, apelido, marcadoPrincipal, status_api: "ok", alertas: [],
    cadastrado_em: new Date().toISOString(), ultima_verificacao: new Date().toISOString(),
  };
  await supabase.from("backup_produtos").upsert({
    id: docId, item_id: itemId, shop_id: String(produto.shopId || "0"),
    nome: apelido || produto.nome || "", data_blob: dados, criado_em: dados.cadastrado_em
  });
  invalidarCacheBackups();
  return dados;
}

export async function listarBackups(opcoes = {}) {
  const { force = false } = opcoes;
  if (!force && _cacheValido(_cache.backups)) return _cache.backups.data;
  
  const { data: snap } = await supabase.from("backup_produtos").select("id, data_blob, criado_em").order("criado_em", { ascending: false });
  const items = (snap || []).map(d => {
    const data = d.data_blob || {};
    return {
      docId: d.id, ...data,
      cadastrado_em: data.cadastrado_em ? new Date(data.cadastrado_em) : (d.criado_em ? new Date(d.criado_em) : null),
      ultima_verificacao: data.ultima_verificacao ? new Date(data.ultima_verificacao) : null,
    };
  });
  items.sort((a, b) => {
    if (a.marcadoPrincipal && !b.marcadoPrincipal) return -1;
    if (!a.marcadoPrincipal && b.marcadoPrincipal) return 1;
    return (b.cadastrado_em?.getTime() || 0) - (a.cadastrado_em?.getTime() || 0);
  });
  _cache.backups = { data: items, ts: Date.now() };
  return items;
}

export async function listarBackupsPaginado(pageSize = 30, cursor = null) {
  let query = supabase.from("backup_produtos").select("id, data_blob, criado_em").order("criado_em", { ascending: false }).limit(pageSize);
  if (cursor) query = query.lt("criado_em", cursor.criado_em.toISOString());
  
  const { data: snap } = await query;
  const items = (snap || []).map(d => ({
    docId: d.id, ...(d.data_blob || {}),
    cadastrado_em: d.criado_em ? new Date(d.criado_em) : null,
    ultima_verificacao: d.data_blob?.ultima_verificacao ? new Date(d.data_blob.ultima_verificacao) : null,
  }));
  return { items, lastDoc: items[items.length - 1] || null, hasMore: items.length === pageSize };
}

export async function buscarBackupsPorNome(termo) {
  const t = String(termo || "").trim().toLowerCase();
  if (!t) return [];
  const todos = await listarBackups();
  return todos.filter((b) => {
    const nome = String(b.nome || "").toLowerCase();
    const apelido = String(b.apelido || "").toLowerCase();
    return nome.includes(t) || apelido.includes(t);
  });
}

export async function atualizarBackup(itemId) {
  if (!REFRESH_URL || !SECRET) throw new Error("Configuração ausente: VITE_REFRESH_URL");
  const ctrl = new AbortController(); const timeoutId = setTimeout(() => ctrl.abort(), 30000);
  try {
    const response = await fetch(\`\${REFRESH_URL}?itemId=\${encodeURIComponent(itemId)}\`, {
      method: "POST", headers: { Authorization: \`Bearer \${SECRET}\`, "Content-Type": "application/json" },
      body: "", signal: ctrl.signal,
    });
    if (!response.ok) throw new Error(\`Erro \${response.status}: \${await response.text()}\`);
    return await response.json();
  } finally { clearTimeout(timeoutId); }
}

export async function removerBackup(itemId) {
  await supabase.from("backup_produtos").delete().eq("id", \`item_\${itemId}\`);
  invalidarCacheBackups();
}

export async function editarBackupMeta(itemId, updates) {
  const docId = \`item_\${itemId}\`;
  const { data: d } = await supabase.from("backup_produtos").select("data_blob").eq("id", docId).single();
  if (!d) return;
  const data = d.data_blob || {};
  if (typeof updates.apelido === "string") data.apelido = updates.apelido;
  if (typeof updates.marcadoPrincipal === "boolean") data.marcadoPrincipal = updates.marcadoPrincipal;
  await supabase.from("backup_produtos").update({ data_blob: data }).eq("id", docId);
  invalidarCacheBackups();
}

export async function getHistoricoProduto(itemId) {
  const { data: d } = await supabase.from("produtos").select("*").eq("id_item", String(itemId)).limit(1).single();
  if (!d) return { ja_vendeu: false };
  return {
    ja_vendeu: true,
    vendas_minhas: Number(d.vendas || 0),
    comissao_total_minha: Number(d.comissao_total || 0),
    gmv_total_meu: Number(d.gmv_total || 0),
    ultima_venda: d.updated_at ? new Date(d.updated_at) : null,
  };
}

export async function sugerirGrupoPorLoja(loja, shopId, itemIdExcluir = null) {
  const [grupos, backups] = await Promise.all([listarGrupos(), listarBackups()]);
  const backupByItem = Object.fromEntries(backups.map((b) => [String(b.itemId), b]));
  for (const g of grupos) {
    const principal = backupByItem[String(g.principalItemId)];
    if (!principal) continue;
    const mesmaLoja = (loja && principal.loja && principal.loja === loja) || (shopId && principal.shopId && String(principal.shopId) === String(shopId));
    if (!mesmaLoja) continue;
    const membros = [String(g.principalItemId), ...(g.backupItemIds || []).map(String)];
    if (itemIdExcluir && membros.includes(String(itemIdExcluir))) continue;
    return { grupoId: g.docId, nome: g.nome, principalNome: principal.apelido || principal.nome };
  }
  return null;
}

export async function salvarBackupComGrupo(produto, opcoes = {}) {
  const salvo = await salvarBackup(produto, opcoes);
  const sugestao = await sugerirGrupoPorLoja(produto.loja, produto.shopId, produto.itemId);
  return { salvo, sugestao };
}

export async function atualizarGrupoBackup(grupoId) {
  if (GROUP_REFRESH_URL && SECRET) {
    const ctrl = new AbortController(); const timeoutId = setTimeout(() => ctrl.abort(), 600000);
    try {
      const response = await fetch(\`\${GROUP_REFRESH_URL}?grupoId=\${encodeURIComponent(grupoId)}\`, {
        method: "POST", headers: { Authorization: \`Bearer \${SECRET}\`, "Content-Type": "application/json" }, body: "", signal: ctrl.signal,
      });
      if (!response.ok) throw new Error(\`Erro \${response.status}: \${await response.text()}\`);
      return await response.json();
    } finally { clearTimeout(timeoutId); }
  }
  return { status: "not_configured" };
}

export async function atualizarBackupsEmLote(itemIds, { delayMs = 1500, onItemDone } = {}) {
  const resultados = { ok: [], erros: [] };
  for (const id of itemIds) {
    try {
      const res = await atualizarBackup(id);
      if (res.updated) resultados.ok.push(id);
      else resultados.erros.push({ id, reason: "No update" });
    } catch (error) { resultados.erros.push({ id, reason: error.message }); }
    if (onItemDone) onItemDone(id);
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  invalidarCacheBackups();
  return resultados;
}

export async function buscarSimilaresShopApi(shopId, excluirItemId = null) {
  if (!SIMILARES_URL || !SECRET) return [];
  const ctrl = new AbortController(); const timeoutId = setTimeout(() => ctrl.abort(), 30000);
  try {
    const response = await fetch(\`\${SIMILARES_URL}?shopId=\${encodeURIComponent(shopId)}\`, {
      method: "POST", headers: { Authorization: \`Bearer \${SECRET}\`, "Content-Type": "application/json" }, body: "", signal: ctrl.signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    const items = data.items || [];
    const filtrados = items.filter(x => String(x.itemid) !== String(excluirItemId));
    return filtrados.slice(0, 10).map(x => ({ ...x, itemId: String(x.itemid), shopId: String(x.shopid) }));
  } catch { return []; } finally { clearTimeout(timeoutId); }
}

export async function buscarSimilaresDaLoja(loja, excluirItemId = null) {
  const { data: snap } = await supabase.from("produtos").select("*").eq("loja", loja).order("comissao_total", { ascending: false });
  const similares = [];
  (snap || []).forEach(data => {
    if (String(data.id_item) === String(excluirItemId)) return;
    similares.push({
      itemId: data.id_item, shopId: data.id_loja, nome: data.nome, preco: Number(data.preco || 0),
      comissao_pct: Number(data.comissao_pct || 0), comissao_total: Number(data.comissao_total || 0),
      vendas: Number(data.vendas || 0), gmv_total: Number(data.gmv_total || 0), link: data.link_shopee || "",
    });
  });
  return similares.slice(0, 10);
}

export async function criarGrupo(nome, principalItemId) {
  if (!nome || !nome.trim()) throw new Error("Nome do grupo é obrigatório");
  if (!principalItemId) throw new Error("Selecione um produto principal");
  const grupoData = {
    nome: nome.trim(), principalItemId: String(principalItemId), backupItemIds: [],
    historico: [], criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
  };
  const docId = "grupo_" + Date.now();
  await supabase.from("backup_grupos").insert({
    id: docId, nome: grupoData.nome, principal_item_id: grupoData.principalItemId,
    data_blob: grupoData, criado_em: grupoData.criado_em
  });
  
  const produtoId = \`item_\${principalItemId}\`;
  const { data: d } = await supabase.from("backup_produtos").select("data_blob").eq("id", produtoId).single();
  if (d) {
    d.data_blob.grupoId = docId;
    await supabase.from("backup_produtos").update({ data_blob: d.data_blob }).eq("id", produtoId);
  }
  invalidarCacheBackups();
  return { docId, ...grupoData };
}

export async function listarGrupos(opcoes = {}) {
  const { force = false } = opcoes;
  if (!force && _cacheValido(_cache.grupos)) return _cache.grupos.data;
  const { data: snap } = await supabase.from("backup_grupos").select("*");
  const grupos = (snap || []).map((d) => {
    const data = d.data_blob || {};
    return { docId: d.id, ...data, criado_em: data.criado_em ? new Date(data.criado_em) : null, atualizado_em: data.atualizado_em ? new Date(data.atualizado_em) : null };
  });
  grupos.sort((a, b) => (b.atualizado_em?.getTime() || 0) - (a.atualizado_em?.getTime() || 0));
  _cache.grupos = { data: grupos, ts: Date.now() };
  return grupos;
}

export async function adicionarBackupAoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");
  const produtoId = \`item_\${itemId}\`;
  const { data: pData } = await supabase.from("backup_produtos").select("data_blob").eq("id", produtoId).single();
  if (!pData) throw new Error("Produto não está cadastrado em backups. Cadastre primeiro.");
  const produtoData = pData.data_blob || {};
  if (produtoData.grupoId && produtoData.grupoId !== grupoId) throw new Error(\`Produto já está no grupo \${produtoData.grupoId}. Remova de lá primeiro.\`);

  const { data: gData } = await supabase.from("backup_grupos").select("data_blob").eq("id", grupoId).single();
  if (gData) {
    const grupo = gData.data_blob || {};
    grupo.backupItemIds = [...new Set([...(grupo.backupItemIds || []), String(itemId)])];
    grupo.atualizado_em = new Date().toISOString();
    await supabase.from("backup_grupos").update({ data_blob: grupo }).eq("id", grupoId);
  }
  
  produtoData.grupoId = grupoId;
  await supabase.from("backup_produtos").update({ data_blob: produtoData }).eq("id", produtoId);
  invalidarCacheBackups();
}

export async function salvarEVincularBackupAoGrupo(grupoId, produto) {
  if (!grupoId || !produto?.itemId) throw new Error("grupoId e produto.itemId são obrigatórios");
  await salvarBackup(produto, {});
  await adicionarBackupAoGrupo(grupoId, produto.itemId);
}

export async function removerBackupDoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");
  const { data: gData } = await supabase.from("backup_grupos").select("data_blob").eq("id", grupoId).single();
  if (gData) {
    const grupo = gData.data_blob || {};
    grupo.backupItemIds = (grupo.backupItemIds || []).filter(id => String(id) !== String(itemId));
    grupo.atualizado_em = new Date().toISOString();
    await supabase.from("backup_grupos").update({ data_blob: grupo }).eq("id", grupoId);
  }
  const produtoId = \`item_\${itemId}\`;
  const { data: pData } = await supabase.from("backup_produtos").select("data_blob").eq("id", produtoId).single();
  if (pData) {
    pData.data_blob.grupoId = null;
    await supabase.from("backup_produtos").update({ data_blob: pData.data_blob }).eq("id", produtoId);
  }
  invalidarCacheBackups();
}

export async function trocarPrincipal(grupoId, novoPrincipalItemId, motivo) {
  if (!grupoId || !novoPrincipalItemId) throw new Error("grupoId e novoPrincipalItemId obrigatórios");
  const { data: gData } = await supabase.from("backup_grupos").select("data_blob").eq("id", grupoId).single();
  if (!gData) throw new Error("Grupo não encontrado");
  const grupoData = gData.data_blob || {};
  const principalAntigo = String(grupoData.principalItemId);
  const novoPrincipal = String(novoPrincipalItemId);
  if (principalAntigo === novoPrincipal) throw new Error("Este produto já é o principal");
  const backupIds = (grupoData.backupItemIds || []).map(String);
  if (!backupIds.includes(novoPrincipal)) throw new Error("Produto selecionado não é backup deste grupo");
  
  const entrada = { data: new Date().toISOString(), motivo: String(motivo || "").trim() || "não especificado", principalAntigo, principalNovo: novoPrincipal };
  const novosBackups = backupIds.filter(id => id !== novoPrincipal);
  novosBackups.push(principalAntigo);
  grupoData.principalItemId = novoPrincipal;
  grupoData.backupItemIds = novosBackups;
  grupoData.historico = [...(grupoData.historico || []), entrada];
  grupoData.atualizado_em = new Date().toISOString();
  await supabase.from("backup_grupos").update({ principal_item_id: novoPrincipal, data_blob: grupoData }).eq("id", grupoId);
  invalidarCacheBackups();
}

export async function removerGrupo(grupoId) {
  if (!grupoId) throw new Error("grupoId obrigatório");
  const { data: gData } = await supabase.from("backup_grupos").select("data_blob").eq("id", grupoId).single();
  if (!gData) throw new Error("Grupo não encontrado");
  const grupoData = gData.data_blob || {};
  const todosIds = [grupoData.principalItemId, ...(grupoData.backupItemIds || [])];
  
  for (const itemId of todosIds) {
    if (itemId) {
      const { data: pData } = await supabase.from("backup_produtos").select("data_blob").eq("id", \`item_\${itemId}\`).single();
      if (pData) {
        pData.data_blob.grupoId = null;
        await supabase.from("backup_produtos").update({ data_blob: pData.data_blob }).eq("id", \`item_\${itemId}\`);
      }
    }
  }
  await supabase.from("backup_grupos").delete().eq("id", grupoId);
  invalidarCacheBackups();
}

async function fetchBackupProdutosMap(itemIds = []) {
  const docIds = [...new Set((itemIds || []).map(id => String(id || "").trim()).filter(Boolean).map(id => (id.startsWith("item_") ? id : \`item_\${id}\`)))];
  const map = {};
  if (!docIds.length) return map;
  for (let i = 0; i < docIds.length; i += 30) {
    const chunk = docIds.slice(i, i + 30);
    const { data: snap } = await supabase.from("backup_produtos").select("id, data_blob").in("id", chunk);
    (snap || []).forEach(d => {
      const itemId = d.id.replace(/^item_/, "");
      map[itemId] = d.data_blob || {};
    });
  }
  return map;
}

function montarGrupoComProdutos(grupoMeta, produtosMap) {
  const todosIds = [grupoMeta.principalItemId, ...(grupoMeta.backupItemIds || [])];
  const produtos = {};
  for (const itemId of todosIds) {
    if (!itemId) continue;
    const data = produtosMap[String(itemId)];
    if (data) produtos[itemId] = data;
  }
  return { ...grupoMeta, produtos };
}

export async function carregarGruposComProdutos(gruposLista = []) {
  const allItemIds = [];
  for (const g of gruposLista) {
    if (g.principalItemId) allItemIds.push(String(g.principalItemId));
    for (const id of g.backupItemIds || []) allItemIds.push(String(id));
  }
  const produtosMap = await fetchBackupProdutosMap(allItemIds);
  return gruposLista.map(g => montarGrupoComProdutos(g, produtosMap));
}

export async function carregarGrupoComProdutos(grupoId) {
  const { data: gData } = await supabase.from("backup_grupos").select("data_blob").eq("id", grupoId).single();
  if (!gData) throw new Error("Grupo não encontrado");
  const grupoData = gData.data_blob || {};
  const grupoMeta = {
    docId: grupoId, nome: grupoData.nome, principalItemId: grupoData.principalItemId,
    backupItemIds: grupoData.backupItemIds || [], historico: grupoData.historico || [],
    criado_em: grupoData.criado_em ? new Date(grupoData.criado_em) : null,
    atualizado_em: grupoData.atualizado_em ? new Date(grupoData.atualizado_em) : null,
  };
  const [grupo] = await carregarGruposComProdutos([grupoMeta]);
  return grupo;
}
\`;

fs.writeFileSync('C:\\\\Users\\\\PC\\\\Music\\\\Afiliadoteste-Superbase\\\\src\\\\platforms\\\\shopee\\\\repositories\\\\backupRepository.js', code);

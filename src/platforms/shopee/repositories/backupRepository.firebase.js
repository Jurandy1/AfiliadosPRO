import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";

const LOOKUP_URL = import.meta.env.VITE_LOOKUP_URL;
const REFRESH_URL = import.meta.env.VITE_REFRESH_URL;
const GROUP_REFRESH_URL = import.meta.env.VITE_GROUP_REFRESH_URL;
const SIMILARES_URL = import.meta.env.VITE_SIMILARES_URL;
const SECRET = import.meta.env.VITE_BACKFILL_SECRET;

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = {
  backups: { data: null, ts: 0 },
  grupos: { data: null, ts: 0 },
};

function _cacheValido(entry) {
  return entry.data !== null && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

export function invalidarCacheBackups() {
  _cache.backups = { data: null, ts: 0 };
  _cache.grupos = { data: null, ts: 0 };
}

export async function lookupProdutoShopee(url) {
  if (!LOOKUP_URL || !SECRET) {
    throw new Error("Configuração ausente: VITE_LOOKUP_URL ou VITE_BACKFILL_SECRET");
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(`${LOOKUP_URL}?url=${encodeURIComponent(url)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function salvarBackup(produto, opcoes = {}) {
  const { apelido = "", marcadoPrincipal = false } = opcoes;
  const itemId = String(produto.itemId);
  const ref = doc(db, "backup_produtos", `item_${itemId}`);

  const dados = {
    ...produto,
    apelido,
    marcadoPrincipal,
    status_api: "ok",
    alertas: [],
    cadastrado_em: new Date(),
    ultima_verificacao: new Date(),
  };

  await setDoc(ref, dados, { merge: true });
  invalidarCacheBackups();
  return dados;
}

export async function listarBackups(opcoes = {}) {
  const { force = false } = opcoes;

  if (!force && _cacheValido(_cache.backups)) {
    return _cache.backups.data;
  }

  const snap = await getDocs(collection(db, "backup_produtos"));
  const items = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      docId: d.id,
      ...data,
      cadastrado_em: data.cadastrado_em?.toDate?.() || null,
      ultima_verificacao: data.ultima_verificacao?.toDate?.() || null,
    });
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
  const ref = collection(db, "backup_produtos");
  const q = cursor
    ? query(ref, orderBy("cadastrado_em", "desc"), startAfter(cursor), limit(pageSize))
    : query(ref, orderBy("cadastrado_em", "desc"), limit(pageSize));

  const snap = await getDocs(q);
  const items = [];
  let lastDoc = null;
  snap.forEach((d) => {
    const data = d.data() || {};
    items.push({
      docId: d.id,
      ...data,
      cadastrado_em: data.cadastrado_em?.toDate?.() || null,
      ultima_verificacao: data.ultima_verificacao?.toDate?.() || null,
    });
    lastDoc = d;
  });

  return {
    items,
    lastDoc,
    hasMore: items.length === pageSize,
  };
}

export async function buscarBackupsPorNome(termo) {
  const t = String(termo || "").trim().toLowerCase();
  if (!t) return [];

  if (_cacheValido(_cache.backups)) {
    const filtrados = _cache.backups.data.filter((b) => {
      const nome = String(b.nome || "").toLowerCase();
      const apelido = String(b.apelido || "").toLowerCase();
      return nome.includes(t) || apelido.includes(t);
    });
    if (filtrados.length > 0) return filtrados;
  }

  const todos = await listarBackups();
  return todos.filter((b) => {
    const nome = String(b.nome || "").toLowerCase();
    const apelido = String(b.apelido || "").toLowerCase();
    return nome.includes(t) || apelido.includes(t);
  });
}

export async function atualizarBackup(itemId) {
  if (!REFRESH_URL || !SECRET) {
    throw new Error("Configuração ausente: VITE_REFRESH_URL");
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(`${REFRESH_URL}?itemId=${encodeURIComponent(itemId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function removerBackup(itemId) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  await deleteDoc(ref);
  invalidarCacheBackups();
}

export async function editarBackupMeta(itemId, updates) {
  const ref = doc(db, "backup_produtos", `item_${itemId}`);
  const permitidos = {};
  if (typeof updates.apelido === "string") permitidos.apelido = updates.apelido;
  if (typeof updates.marcadoPrincipal === "boolean") permitidos.marcadoPrincipal = updates.marcadoPrincipal;
  await setDoc(ref, permitidos, { merge: true });
  invalidarCacheBackups();
}

export async function getHistoricoProduto(itemId) {
  const ref = doc(db, "produtos", `item_${itemId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { ja_vendeu: false };
  }
  const h = snap.data() || {};
  return {
    ja_vendeu: true,
    vendas_minhas: Number(h.vendas || 0),
    comissao_total_minha: Number(h.comissao_total || 0),
    gmv_total_meu: Number(h.gmv_total || 0),
    ultima_venda: h.updatedAt?.toDate?.() || null,
  };
}

export async function sugerirGrupoPorLoja(loja, shopId, itemIdExcluir = null) {
  const [grupos, backups] = await Promise.all([listarGrupos(), listarBackups()]);
  const backupByItem = Object.fromEntries(backups.map((b) => [String(b.itemId), b]));

  for (const g of grupos) {
    const principal = backupByItem[String(g.principalItemId)];
    if (!principal) continue;
    const mesmaLoja =
      (loja && principal.loja && principal.loja === loja)
      || (shopId && principal.shopId && String(principal.shopId) === String(shopId));
    if (!mesmaLoja) continue;

    const membros = [String(g.principalItemId), ...(g.backupItemIds || []).map(String)];
    if (itemIdExcluir && membros.includes(String(itemIdExcluir))) continue;

    return {
      grupoId: g.docId,
      nome: g.nome,
      principalNome: principal.apelido || principal.nome,
    };
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
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 600000);
    try {
      const response = await fetch(`${GROUP_REFRESH_URL}?grupoId=${encodeURIComponent(grupoId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
        },
        body: "",
        signal: ctrl.signal,
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Erro ${response.status}: ${errorBody}`);
      }
      invalidarCacheBackups();
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const grupo = await carregarGrupoComProdutos(grupoId);
  const ids = [grupo.principalItemId, ...(grupo.backupItemIds || [])].filter(Boolean);
  const results = [];
  for (const itemId of ids) {
    try {
      const r = await atualizarBackup(itemId);
      results.push({ itemId, ok: true, ...r });
    } catch (err) {
      results.push({ itemId, ok: false, error: err?.message || String(err) });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  invalidarCacheBackups();
  return { success: true, results };
}

/** Atualiza vários backups via API Shopee (sequencial, respeita rate limit). */
export async function atualizarBackupsEmLote(itemIds, { delayMs = 1500, onItemDone } = {}) {
  const ids = [...new Set((itemIds || []).map(String).filter(Boolean))];
  const results = [];
  for (const itemId of ids) {
    try {
      await atualizarBackup(itemId);
      results.push({ itemId, ok: true });
    } catch (err) {
      results.push({ itemId, ok: false, error: err?.message || String(err) });
    }
    onItemDone?.(itemId, results);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  invalidarCacheBackups();
  return results;
}

export async function buscarSimilaresShopApi(shopId, excluirItemId = null) {
  if (!SIMILARES_URL || !SECRET) {
    return buscarSimilaresDaLojaFallback(shopId, excluirItemId);
  }
  const params = new URLSearchParams({ shopId: String(shopId) });
  if (excluirItemId) params.set("excludeItemId", String(excluirItemId));
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 120000);
  try {
    const response = await fetch(`${SIMILARES_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "",
      signal: ctrl.signal,
    });
    if (!response.ok) {
      throw new Error(`Erro ${response.status}`);
    }
    const data = await response.json();
    return data.similares || [];
  } catch {
    return buscarSimilaresDaLojaFallback(null, excluirItemId, shopId);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function buscarSimilaresDaLojaFallback(loja, excluirItemId, shopId = null) {
  if (loja) {
    return buscarSimilaresDaLoja(loja, excluirItemId);
  }
  if (!shopId) return [];

  const snap = await getDocs(query(
    collection(db, COLLECTIONS.PRODUTOS),
    where("id_loja", "==", String(shopId)),
    limit(30),
  )).catch(() => ({ docs: [] }));

  const similares = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (String(data.id_item) === String(excluirItemId)) continue;
    similares.push({
      itemId: data.id_item,
      nome: data.nome,
      preco: Number(data.preco || 0),
      comissao_pct: Number(data.comissao_pct || 0),
      comissao_total: Number(data.comissao_total || 0),
      vendas: Number(data.vendas || 0),
      link: data.link_shopee || "",
    });
  }
  similares.sort((a, b) => b.comissao_total - a.comissao_total);
  return similares.slice(0, 10);
}

export async function buscarSimilaresDaLoja(loja, excluirItemId = null) {
  if (!loja) return [];

  const snap = await getDocs(query(
    collection(db, COLLECTIONS.PRODUTOS),
    where("loja", "==", loja),
    limit(30),
  )).catch(() => ({ docs: [] }));

  const similares = [];
  for (const docSnap of snap.docs) {
    const data = { id: docSnap.id, ...docSnap.data() };
    if (String(data.id_item) === String(excluirItemId)) continue;
    similares.push({
      docId: data.id,
      itemId: data.id_item,
      shopId: data.id_loja,
      nome: data.nome,
      preco: Number(data.preco || 0),
      comissao_pct: Number(data.comissao_pct || 0),
      comissao_total: Number(data.comissao_total || 0),
      vendas: Number(data.vendas || 0),
      gmv_total: Number(data.gmv_total || 0),
      link: data.link_shopee || "",
    });
  }

  similares.sort((a, b) => b.comissao_total - a.comissao_total);
  return similares.slice(0, 10);
}

export async function criarGrupo(nome, principalItemId) {
  if (!nome || !nome.trim()) throw new Error("Nome do grupo é obrigatório");
  if (!principalItemId) throw new Error("Selecione um produto principal");

  const grupoData = {
    nome: nome.trim(),
    principalItemId: String(principalItemId),
    backupItemIds: [],
    historico: [],
    criado_em: new Date(),
    atualizado_em: new Date(),
  };

  const ref = await addDoc(collection(db, "backup_grupos"), grupoData);

  const produtoRef = doc(db, "backup_produtos", `item_${principalItemId}`);
  await setDoc(produtoRef, { grupoId: ref.id }, { merge: true });

  invalidarCacheBackups();
  return { docId: ref.id, ...grupoData };
}

export async function listarGrupos(opcoes = {}) {
  const { force = false } = opcoes;

  if (!force && _cacheValido(_cache.grupos)) {
    return _cache.grupos.data;
  }

  const snap = await getDocs(collection(db, "backup_grupos"));
  const grupos = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    grupos.push({
      docId: d.id,
      ...data,
      criado_em: data.criado_em?.toDate?.() || null,
      atualizado_em: data.atualizado_em?.toDate?.() || null,
    });
  });

  grupos.sort((a, b) => (b.atualizado_em?.getTime() || 0) - (a.atualizado_em?.getTime() || 0));
  _cache.grupos = { data: grupos, ts: Date.now() };
  return grupos;
}

export async function adicionarBackupAoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");

  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  const produtoSnap = await getDoc(produtoRef);
  if (!produtoSnap.exists()) {
    throw new Error("Produto não está cadastrado em backups. Cadastre primeiro.");
  }

  const produtoData = produtoSnap.data();
  if (produtoData.grupoId && produtoData.grupoId !== grupoId) {
    throw new Error(`Produto já está no grupo ${produtoData.grupoId}. Remova de lá primeiro.`);
  }

  const grupoRef = doc(db, "backup_grupos", grupoId);
  await updateDoc(grupoRef, {
    backupItemIds: arrayUnion(String(itemId)),
    atualizado_em: new Date(),
  });

  await setDoc(produtoRef, { grupoId }, { merge: true });
  invalidarCacheBackups();
}

/** Cadastra produto no backup e vincula como reserva do grupo. */
export async function salvarEVincularBackupAoGrupo(grupoId, produto) {
  if (!grupoId || !produto?.itemId) {
    throw new Error("grupoId e produto.itemId são obrigatórios");
  }
  await salvarBackup(produto, {});
  await adicionarBackupAoGrupo(grupoId, produto.itemId);
}

export async function removerBackupDoGrupo(grupoId, itemId) {
  if (!grupoId || !itemId) throw new Error("grupoId e itemId obrigatórios");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  await updateDoc(grupoRef, {
    backupItemIds: arrayRemove(String(itemId)),
    atualizado_em: new Date(),
  });

  const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
  await setDoc(produtoRef, { grupoId: null }, { merge: true });
  invalidarCacheBackups();
}

export async function trocarPrincipal(grupoId, novoPrincipalItemId, motivo) {
  if (!grupoId || !novoPrincipalItemId) throw new Error("grupoId e novoPrincipalItemId obrigatórios");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const principalAntigo = grupoData.principalItemId;
  const novoPrincipal = String(novoPrincipalItemId);

  if (principalAntigo === novoPrincipal) {
    throw new Error("Este produto já é o principal");
  }

  const backupIds = grupoData.backupItemIds || [];
  if (!backupIds.includes(novoPrincipal)) {
    throw new Error("Produto selecionado não é backup deste grupo");
  }

  const entrada = {
    data: new Date(),
    motivo: String(motivo || "").trim() || "não especificado",
    principalAntigo: String(principalAntigo),
    principalNovo: novoPrincipal,
  };

  const novosBackups = backupIds.filter((id) => id !== novoPrincipal);
  novosBackups.push(String(principalAntigo));

  await updateDoc(grupoRef, {
    principalItemId: novoPrincipal,
    backupItemIds: novosBackups,
    historico: arrayUnion(entrada),
    atualizado_em: new Date(),
  });
  invalidarCacheBackups();
}

export async function removerGrupo(grupoId) {
  if (!grupoId) throw new Error("grupoId obrigatório");

  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const todosIds = [grupoData.principalItemId, ...(grupoData.backupItemIds || [])];

  for (const itemId of todosIds) {
    if (itemId) {
      const produtoRef = doc(db, "backup_produtos", `item_${itemId}`);
      try {
        await setDoc(produtoRef, { grupoId: null }, { merge: true });
      } catch {
      }
    }
  }

  await deleteDoc(grupoRef);
  invalidarCacheBackups();
}

async function fetchBackupProdutosMap(itemIds = []) {
  const docIds = [...new Set(
    (itemIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .map((id) => (id.startsWith("item_") ? id : `item_${id}`)),
  )];
  const map = {};
  if (!docIds.length) return map;

  for (let i = 0; i < docIds.length; i += 30) {
    const chunk = docIds.slice(i, i + 30);
    const snap = await getDocs(query(
      collection(db, "backup_produtos"),
      where(documentId(), "in", chunk),
    )).catch(() => ({ docs: [] }));
    snap.docs.forEach((d) => {
      const itemId = d.id.replace(/^item_/, "");
      map[itemId] = d.data();
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
  return {
    docId: grupoMeta.docId,
    nome: grupoMeta.nome,
    principalItemId: grupoMeta.principalItemId,
    backupItemIds: grupoMeta.backupItemIds || [],
    historico: grupoMeta.historico || [],
    criado_em: grupoMeta.criado_em,
    atualizado_em: grupoMeta.atualizado_em,
    produtos,
  };
}

/** Carrega produtos de vários grupos em batch (documentId in) — evita N×getDoc sequencial. */
export async function carregarGruposComProdutos(gruposLista = []) {
  const allItemIds = [];
  for (const g of gruposLista) {
    if (g.principalItemId) allItemIds.push(String(g.principalItemId));
    for (const id of g.backupItemIds || []) allItemIds.push(String(id));
  }
  const produtosMap = await fetchBackupProdutosMap(allItemIds);
  return gruposLista.map((g) => montarGrupoComProdutos(g, produtosMap));
}

export async function carregarGrupoComProdutos(grupoId) {
  const grupoRef = doc(db, "backup_grupos", grupoId);
  const grupoSnap = await getDoc(grupoRef);
  if (!grupoSnap.exists()) throw new Error("Grupo não encontrado");

  const grupoData = grupoSnap.data();
  const grupoMeta = {
    docId: grupoSnap.id,
    nome: grupoData.nome,
    principalItemId: grupoData.principalItemId,
    backupItemIds: grupoData.backupItemIds || [],
    historico: grupoData.historico || [],
    criado_em: grupoData.criado_em?.toDate?.() || null,
    atualizado_em: grupoData.atualizado_em?.toDate?.() || null,
  };
  const [grupo] = await carregarGruposComProdutos([grupoMeta]);
  return grupo;
}

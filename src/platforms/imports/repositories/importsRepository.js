import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, writeBatch, where } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import { COLLECTIONS } from "../../../services/firebase/firestore";
import { parseCSVBuffer } from "../../../shared/parsers/csvParser";
import { parseMetaAdsRows, readMetaAdsWorkbook } from "../../meta/parsers/metaAdsParser";
import { getImportacoes, touchImportacoesLatest } from "./importacoesLogRepository";
import { parsePinterestRows } from "../../pinterest/parsers/pinterestParser";
import { parseShopeeClicksRows } from "../../shopee/parsers/shopeeClicksParser";
import { parseShopeeSalesRows } from "../../shopee/parsers/shopeeSalesParser";
import { dedupeAdIds } from "../../../utils/adLinkIds";
import { normalizeSubId } from "../../../utils/normalizeSubId";
import { requireNonEmpty } from "../../../utils/validators";
import { invalidateProdutosCache } from "../../shopee/repositories/productsRepository";
import { invalidateAllPeriodCaches } from "../../dashboard/services/periodDataCache";

function invalidateDashboardCaches() {
  invalidateProdutosCache();
  invalidateAllPeriodCaches();
}

function isPermissionDenied(e) {
  return e?.code === "permission-denied" || String(e?.message || "").includes("insufficient permissions");
}

function throwImportPermissionError(e, alvo) {
  const code = e?.code ? ` (${e.code})` : "";
  const msg = e?.message ? ` ${e.message}` : "";
  const base = `Permissão insuficiente no Firebase para gravar em ${alvo}.${code}${msg}`;
  const extra =
    "Verifique: (1) regras publicadas no Firestore do mesmo projectId, (2) App Check (se estiver enforced), (3) login anônimo habilitado em Authentication.";
  throw new Error(`${base} ${extra}`);
}

export { getImportacoes } from "./importacoesLogRepository";

async function deleteCollectionDocs(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  if (snap.empty) return 0;

  let deleted = 0;
  let batch = writeBatch(db);
  let count = 0;

  for (const d of snap.docs) {
    batch.delete(d.ref);
    deleted++;
    count++;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
  return deleted;
}

async function cleanupImportedDataByTipo(tipo) {
  if (tipo === "shopee_venda") {
    const [produtosRemovidos, subIdsRemovidos] = await Promise.all([
      deleteCollectionDocs(COLLECTIONS.PRODUTOS),
      deleteCollectionDocs(COLLECTIONS.SUBID_VENDAS),
    ]);
    invalidateDashboardCaches();
    return { produtosRemovidos, subIdsRemovidos };
  }

  if (tipo === "shopee_clique") {
    const [cliquesRemovidos, cliqueDailyRemovidos] = await Promise.all([
      deleteCollectionDocs(COLLECTIONS.CLIQUES),
      deleteCollectionDocs(COLLECTIONS.CLIQUE_DAILY),
    ]);
    const prodSnap = await getDocs(query(collection(db, COLLECTIONS.PRODUTOS), where("cliques", ">", 0)));
    if (!prodSnap.empty) {
      let batch = writeBatch(db);
      let count = 0;
      for (const p of prodSnap.docs) {
        batch.set(p.ref, { cliques: 0 }, { merge: true });
        count++;
        if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
      }
      if (count > 0) await batch.commit();
    }
    invalidateDashboardCaches();
    return { cliquesRemovidos, cliqueDailyRemovidos };
  }

  if (tipo === "meta_ads") {
    const metaRemovidos = await deleteCollectionDocs(COLLECTIONS.META_ADS);
    const [prodSnap, pinSnap] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.PRODUTOS), where("investimento", ">", 0))),
      getDocs(collection(db, COLLECTIONS.PINTEREST)),
    ]);
    const pinIndex = {};
    pinSnap.docs.forEach((d) => { pinIndex[d.id] = d.data(); });
    if (!prodSnap.empty) {
      let batch = writeBatch(db);
      let count = 0;
      for (const p of prodSnap.docs) {
        const data = p.data();
        const pinIds = data.pinterestAdIds || [];
        const investimentoPin = pinIds.reduce((sum, id) => sum + (pinIndex[id]?.spend || 0), 0);
        batch.set(p.ref, { metaAdIds: [], investimento: Math.round(investimentoPin * 100) / 100 }, { merge: true });
        count++;
        if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
      }
      if (count > 0) await batch.commit();
    }
    invalidateDashboardCaches();
    return { metaRemovidos };
  }

  if (tipo === "pinterest") {
    const pinterestRemovidos = await deleteCollectionDocs(COLLECTIONS.PINTEREST);
    const [prodSnap, metaSnap] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.PRODUTOS), where("investimento", ">", 0))),
      getDocs(collection(db, COLLECTIONS.META_ADS)),
    ]);
    const metaIndex = {};
    metaSnap.docs.forEach((d) => { metaIndex[d.id] = d.data(); });
    if (!prodSnap.empty) {
      let batch = writeBatch(db);
      let count = 0;
      for (const p of prodSnap.docs) {
        const data = p.data();
        const metaIds = data.metaAdIds || [];
        const investimentoMeta = metaIds.reduce((sum, id) => sum + (metaIndex[id]?.valorUsado || 0), 0);
        batch.set(p.ref, { pinterestAdIds: [], investimento: Math.round(investimentoMeta * 100) / 100 }, { merge: true });
        count++;
        if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
      }
      if (count > 0) await batch.commit();
    }
    invalidateDashboardCaches();
    return { pinterestRemovidos };
  }

  return {};
}

async function sha256Hex(arrayBuffer) {
  const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer?.buffer;
  if (!buf) return "";
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildFilesKey(buffers) {
  const hashes = [];
  for (const b of buffers) hashes.push(await sha256Hex(b));
  return hashes.filter(Boolean).sort().join("|");
}

/** Ignora registros do cron (`daily_only`) — só servem para agregados diários, não para produtos/cliques. */
function pickLatestImport(importacoes, tipo) {
  return [...importacoes]
    .filter((item) => item.tipo === tipo && item.modo !== "daily_only")
    .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0] || null;
}

async function assertNotAlreadyImported(tipo, filesKey) {
  if (!filesKey) return;
  const imports = await getImportacoes().catch(() => []);
  const dup = imports.find((i) => i.tipo === tipo && i.filesKey === filesKey && i.status === "sucesso");
  if (dup) throw new Error("Esse arquivo já foi importado anteriormente.");
}

export async function removerImportacao(importacaoId, tipo, modo = null) {
  if (!importacaoId) throw new Error("ID da importação inválido");
  if (tipo && modo !== "append") await cleanupImportedDataByTipo(tipo);
  await deleteDoc(doc(db, COLLECTIONS.IMPORTACOES, importacaoId));
}

export async function removerHistoricoShopeeVendas() {
  const snap = await getDocs(query(collection(db, COLLECTIONS.IMPORTACOES), where("tipo", "==", "shopee_venda")));
  if (snap.empty) return 0;

  let deleted = 0;
  let batch = writeBatch(db);
  let count = 0;

  for (const d of snap.docs) {
    batch.delete(d.ref);
    deleted++;
    count++;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
  return deleted;
}

export async function importShopeeVenda(arrayBufferOrBuffers, options = {}) {
  const buffers = Array.isArray(arrayBufferOrBuffers) ? arrayBufferOrBuffers : [arrayBufferOrBuffers];
  const rows = [];
  buffers.forEach((b) => {
    rows.push(...parseCSVBuffer(b));
  });
  requireNonEmpty(rows, "CSV vazio ou sem colunas reconhecidas");
  const { prodMap, subIdMap, processed, colunas } = parseShopeeSalesRows(rows);
  if (!processed || !Object.keys(prodMap || {}).length) {
    throw new Error(
      "Nenhuma venda válida encontrada no CSV. Verifique se o arquivo é o relatório de Comissões da Shopee e se há pedidos pagos/concluídos dentro do período.",
    );
  }
  const mode = options?.mode === "append" ? "append" : "replace";
  const filesKey = await buildFilesKey(buffers);
  await assertNotAlreadyImported("shopee_venda", filesKey);

  const importRef = doc(collection(db, COLLECTIONS.IMPORTACOES));
  const subIdKeys   = Object.keys(subIdMap || {});
  const subIdResumo = subIdKeys.map((id) => ({ id, ...subIdMap[id] }));

  const importacoes = await getImportacoes().catch(() => []);
  const latestCliqueImport = pickLatestImport(importacoes, "shopee_clique");

  const cliquesSnap = latestCliqueImport?.modo === "append"
    ? await getDocs(collection(db, COLLECTIONS.CLIQUES))
    : latestCliqueImport?.id
      ? await getDocs(query(collection(db, COLLECTIONS.CLIQUES), where("importacaoId", "==", latestCliqueImport.id)))
      : await getDocs(collection(db, COLLECTIONS.CLIQUES));
  const cliquesIndex = {};
  cliquesSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.sub_id_norm || normalizeSubId(data.sub_id || "");
    if (norm) cliquesIndex[norm] = (cliquesIndex[norm] || 0) + (data.cliques || 0);
  });

  let batch = writeBatch(db);
  let count = 0;

  const flushIfNeeded = async () => {
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  };

  if (mode === "append") {
    const prodSnapAll = await getDocs(collection(db, COLLECTIONS.PRODUTOS));
    const existingByKey = {};
    prodSnapAll.docs.forEach((d) => {
      const data = d.data() || {};
      const key = String(data.nome || data.id_item || "").trim().toLowerCase();
      if (key) existingByKey[key] = { ref: d.ref, data };
    });

    const canaisMerge = (a, b) => {
      const out = { ...(a || {}) };
      Object.entries(b || {}).forEach(([k, v]) => { out[k] = (out[k] || 0) + (v || 0); });
      return out;
    };

    for (const prod of Object.values(prodMap)) {
      const sub_ids = [...prod.sub_ids];
      const cliquesTotal = sub_ids.reduce((sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0), 0);
      const key = String(prod.nome || "").trim().toLowerCase();
      const existing = existingByKey[key]?.data || null;
      const targetRef = existingByKey[key]?.ref || doc(collection(db, COLLECTIONS.PRODUTOS));

      const base = existing || {};
      const nextSubIds = Array.from(new Set([...(base.sub_ids || []), ...sub_ids]));
      const nextCanais = canaisMerge(base.canais, prod.canais);

      const next = {
        nome: base.nome || prod.nome,
        plataforma: base.plataforma || prod.plataforma,
        categoria: base.categoria || prod.categoria,
        loja: base.loja || prod.loja,
        preco: base.preco || prod.preco,
        comissao_pct: base.comissao_pct || prod.comissao_pct,
        vendas: (base.vendas || 0) + (prod.vendas || 0),
        gmv: (base.gmv || 0) + (prod.gmv_total || 0),
        comissao_total: (base.comissao_total || 0) + (prod.comissao_total || 0),
        comissao_concluida: (base.comissao_concluida || 0) + (prod.comissao_concluida || 0),
        comissao_pendente: (base.comissao_pendente || 0) + (prod.comissao_pendente || 0),
        comissao_cancelada: (base.comissao_cancelada || 0) + (prod.comissao_cancelada || 0),
        vendas_diretas: (base.vendas_diretas || 0) + (prod.vendas_diretas || 0),
        vendas_indiretas: (base.vendas_indiretas || 0) + (prod.vendas_indiretas || 0),
        pedidos_pendentes: (base.pedidos_pendentes || 0) + (prod.pedidos_pendentes || 0),
        pedidos_concluidos: (base.pedidos_concluidos || 0) + (prod.pedidos_concluidos || 0),
        pedidos_cancelados: (base.pedidos_cancelados || 0) + (prod.pedidos_cancelados || 0),
        canais: nextCanais,
        sub_ids: nextSubIds,
        cliques: Math.max(base.cliques || 0, cliquesTotal),
        fonte: "shopee_venda_append",
        updatedAt: serverTimestamp(),
        importadoEm: serverTimestamp(),
      };

      batch.set(targetRef, next, { merge: true });
      count++;
      await flushIfNeeded();
    }

    const subSnapAll = await getDocs(collection(db, COLLECTIONS.SUBID_VENDAS));
    const subExisting = {};
    subSnapAll.docs.forEach((d) => { subExisting[d.id] = d.data() || {}; });

    for (const [id, row] of Object.entries(subIdMap || {})) {
      const base = subExisting[id] || {};
      batch.set(doc(collection(db, COLLECTIONS.SUBID_VENDAS), id), {
        subid: row.subid || "",
        comissoes: (base.comissoes || 0) + (row.comissoes || 0),
        faturamento: (base.faturamento || 0) + (row.faturamento || 0),
        vendas_diretas: (base.vendas_diretas || 0) + (row.vendas_diretas || 0),
        vendas_indiretas: (base.vendas_indiretas || 0) + (row.vendas_indiretas || 0),
        qtd_itens: (base.qtd_itens || 0) + (row.qtd_itens || 0),
        updatedAt: serverTimestamp(),
        importadoEm: serverTimestamp(),
      }, { merge: true });
      count++;
      await flushIfNeeded();
    }
  } else {
    await cleanupImportedDataByTipo("shopee_venda");
    for (const prod of Object.values(prodMap)) {
      const sub_ids     = [...prod.sub_ids];
      const cliquesTotal = sub_ids.reduce((sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0), 0);
      batch.set(doc(collection(db, COLLECTIONS.PRODUTOS)), {
        ...prod,
        sub_ids,
        cliques: cliquesTotal,
        gmv: prod.gmv_total || 0,
        fonte: "shopee_venda",
        updatedAt: serverTimestamp(),
        importadoEm: serverTimestamp(),
        importacaoId: importRef.id,
      });
      count++;
      await flushIfNeeded();
    }
  }

  const pedidosCsv = Object.values(prodMap || {}).reduce(
    (s, p) => s + (p.pedidos_pendentes || 0) + (p.pedidos_concluidos || 0),
    0,
  );

  batch.set(importRef, {
    tipo: "shopee_venda",
    fonte: "csv_manual",
    linhasProcessadas: processed,
    pedidos: pedidosCsv,
    produtosUnicos: Object.keys(prodMap).length,
    subIdsUnicos: subIdKeys.length,
    subIdResumo,
    status: "sucesso",
    modo: mode,
    filesKey,
    importadoEm: serverTimestamp(),
  });
  count++;
  try {
    await batch.commit();
  } catch (e) {
    if (isPermissionDenied(e)) throwImportPermissionError(e, "produtos/importacoes");
    throw e;
  }

  await touchImportacoesLatest("shopee_venda", importRef.id);

  invalidateDashboardCaches();
  autoLinkAds()
    .then(() => invalidateDashboardCaches())
    .catch((e) => console.warn("Auto-link ads:", e.message));
  return {
    linhas: processed,
    produtos: Object.keys(prodMap).length,
    subIds: subIdKeys.length,
    colunas,
  };
}

export async function importShopeeClique(arrayBufferOrBuffers, options = {}) {
  const buffers = Array.isArray(arrayBufferOrBuffers) ? arrayBufferOrBuffers : [arrayBufferOrBuffers];
  const rows = [];
  buffers.forEach((b) => {
    rows.push(...parseCSVBuffer(b));
  });
  requireNonEmpty(rows, "CSV vazio ou sem colunas reconhecidas");
  const { subIdMap, byReferrer, byDate, byDateSub, processed, colunas } = parseShopeeClicksRows(rows);
  if (!processed) {
    throw new Error(
      "Nenhum clique válido encontrado no CSV. Verifique se o arquivo é o relatório de Cliques da Shopee e se o período possui dados.",
    );
  }
  const mode = options?.mode === "append" ? "append" : "replace";
  const filesKey = await buildFilesKey(buffers);
  await assertNotAlreadyImported("shopee_clique", filesKey);

  const importRef = doc(collection(db, COLLECTIONS.IMPORTACOES));

  if (mode === "replace") {
    await deleteCollectionDocs(COLLECTIONS.CLIQUE_DAILY);
  }

  let existingDaily = {};
  if (mode === "append") {
    const dailySnap = await getDocs(collection(db, COLLECTIONS.CLIQUE_DAILY));
    dailySnap.docs.forEach((d) => { existingDaily[d.id] = Number(d.data()?.cliques || 0); });
  }

  let batch = writeBatch(db);
  let batchCount = 0;
  const commitBatchIfNeeded = async (force = false) => {
    if (batchCount >= 400 || (force && batchCount > 0)) {
      await batch.commit();
      batch = writeBatch(db);
      batchCount = 0;
    }
  };

  for (const [dayKey, cliques] of Object.entries(byDateSub || {})) {
    const sep = dayKey.indexOf("__");
    if (sep < 0) continue;
    const data = dayKey.slice(0, sep);
    const sub_id_norm = dayKey.slice(sep + 2);
    if (!data || !sub_id_norm) continue;
    const ref = doc(collection(db, COLLECTIONS.CLIQUE_DAILY), dayKey);
    batch.set(ref, {
      data,
      subid: sub_id_norm,
      sub_id_norm,
      cliques: (existingDaily[dayKey] || 0) + cliques,
      fonte: mode === "append" ? "shopee_clique_append" : "shopee_clique_csv",
      updatedAt: serverTimestamp(),
      importacaoId: importRef.id,
    }, mode === "append" ? { merge: true } : undefined);
    batchCount++;
    await commitBatchIfNeeded();
  }

  if (mode === "append") {
    const snap = await getDocs(collection(db, COLLECTIONS.CLIQUES));
    const existing = {};
    snap.docs.forEach((d) => { existing[d.data()?.sub_id_norm || d.id] = { id: d.id, ...d.data() }; });

    const mergeReferrers = (a, b) => {
      const out = { ...(a || {}) };
      Object.entries(b || {}).forEach(([k, v]) => { out[k] = (out[k] || 0) + (v || 0); });
      return out;
    };

    for (const data of Object.values(subIdMap)) {
      const id = data.sub_id_norm || normalizeSubId(data.sub_id || "");
      if (!id) continue;
      const base = existing[id] || {};
      batch.set(doc(collection(db, COLLECTIONS.CLIQUES), id), {
        sub_id: base.sub_id || data.sub_id,
        sub_id_norm: id,
        cliques: (base.cliques || 0) + (data.cliques || 0),
        referrers: mergeReferrers(base.referrers, data.referrers),
        plataforma: "Shopee",
        fonte: "shopee_clique_append",
        updatedAt: serverTimestamp(),
        importadoEm: serverTimestamp(),
      }, { merge: true });
      batchCount++;
      await commitBatchIfNeeded();
    }
  } else {
    for (const data of Object.values(subIdMap)) {
      batch.set(doc(collection(db, COLLECTIONS.CLIQUES)), {
        ...data,
        plataforma: "Shopee",
        fonte: "shopee_clique",
        updatedAt: serverTimestamp(),
        importadoEm: serverTimestamp(),
        importacaoId: importRef.id,
      });
      batchCount++;
      await commitBatchIfNeeded();
    }
  }
  batch.set(importRef, {
    tipo: "shopee_clique",
    linhasProcessadas: processed,
    subIdsUnicos: Object.keys(subIdMap).length,
    totalCliques: processed,
    porReferenciador: byReferrer,
    porData: byDate,
    status: "sucesso",
    modo: mode,
    filesKey,
    importadoEm: serverTimestamp(),
  });
  batchCount++;
  try {
    await commitBatchIfNeeded(true);
  } catch (e) {
    if (isPermissionDenied(e)) throwImportPermissionError(e, "cliques_shopee/importacoes");
    throw e;
  }

  await touchImportacoesLatest("shopee_clique", importRef.id);

  let produtosAtualizados = 0;
  try {
    const importacoes = await getImportacoes().catch(() => []);
    const latestVendaImport = [...importacoes]
      .filter((item) => item.tipo === "shopee_venda")
      .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0];

    const vendasAppend = latestVendaImport?.modo === "append";
    const prodSnap = vendasAppend
      ? await getDocs(collection(db, COLLECTIONS.PRODUTOS))
      : latestVendaImport?.id
        ? await getDocs(query(collection(db, COLLECTIONS.PRODUTOS), where("importacaoId", "==", latestVendaImport.id)))
        : await getDocs(collection(db, COLLECTIONS.PRODUTOS));

    let cliquesIndex = {};
    if (mode === "append") {
      const allCliques = await getDocs(collection(db, COLLECTIONS.CLIQUES));
      allCliques.docs.forEach((d) => {
        const data = d.data() || {};
        const key = data.sub_id_norm || normalizeSubId(data.sub_id || "");
        if (key) cliquesIndex[key] = (data.cliques || 0);
      });
    } else {
      Object.values(subIdMap || {}).forEach((v) => {
        const key = v.sub_id_norm || normalizeSubId(v.sub_id || "");
        if (key) cliquesIndex[key] = (v.cliques || 0);
      });
    }

    const updateBatch = writeBatch(db);
    prodSnap.docs.forEach((docSnap) => {
      const prod    = docSnap.data();
      const sub_ids = prod.sub_ids || (prod.sub_id ? [prod.sub_id] : []);
      if (!sub_ids.length) return;
      const cliquesTotal = sub_ids.reduce((sum, sid) => sum + (cliquesIndex[normalizeSubId(sid)] || 0), 0);
      updateBatch.set(docSnap.ref, { cliques: cliquesTotal }, { merge: true });
      produtosAtualizados++;
    });
    if (produtosAtualizados > 0) await updateBatch.commit();
  } catch (e) {
    console.warn("Reconciliação cliques→produtos falhou:", e.message);
  }

  invalidateDashboardCaches();
  return { linhas: processed, subIds: Object.keys(subIdMap).length, porReferenciador: byReferrer, produtosAtualizados, colunas };
}

export async function importMetaAds(arrayBufferOrBuffers) {
  const buffers = Array.isArray(arrayBufferOrBuffers) ? arrayBufferOrBuffers : [arrayBufferOrBuffers];
  const rows = [];
  for (const b of buffers) {
    rows.push(...(await readMetaAdsWorkbook(b)));
  }
  requireNonEmpty(rows, "Planilha vazia");
  const parsed = parseMetaAdsRows(rows);
  if (!parsed.length) {
    throw new Error("Nenhuma linha válida encontrada na planilha do Meta Ads.");
  }
  const importRef = doc(collection(db, COLLECTIONS.IMPORTACOES));

  const batch = writeBatch(db);
  let processed = 0;
  for (const item of parsed) {
    batch.set(doc(collection(db, COLLECTIONS.META_ADS)), {
      ...item,
      updatedAt: serverTimestamp(),
      importadoEm: serverTimestamp(),
      importacaoId: importRef.id,
    });
    processed++;
  }
  batch.set(importRef, {
    tipo: "meta_ads", linhasProcessadas: processed, status: "sucesso", importadoEm: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    if (isPermissionDenied(e)) throwImportPermissionError(e, "meta_ads/importacoes");
    throw e;
  }

  await touchImportacoesLatest("meta_ads", importRef.id);

  let vinculados = 0;
  try {
    const result = await autoLinkAds();
    vinculados = result.produtosVinculados;
  } catch (e) {
    console.warn("Auto-link Meta→Produtos falhou:", e.message);
  }
  return { linhas: processed, produtosVinculados: vinculados, colunas: Object.keys(rows[0] || {}) };
}

export async function importPinterest(arrayBufferOrBuffers) {
  const buffers = Array.isArray(arrayBufferOrBuffers) ? arrayBufferOrBuffers : [arrayBufferOrBuffers];
  const rows = [];
  buffers.forEach((b) => {
    rows.push(...parseCSVBuffer(b));
  });
  requireNonEmpty(rows, "CSV vazio ou sem colunas reconhecidas");
  const parsed = parsePinterestRows(rows);
  if (!parsed.length) {
    throw new Error("Nenhuma linha válida encontrada no CSV do Pinterest.");
  }
  const importRef = doc(collection(db, COLLECTIONS.IMPORTACOES));

  const batch = writeBatch(db);
  let processed = 0;
  for (const item of parsed) {
    batch.set(doc(collection(db, COLLECTIONS.PINTEREST)), {
      ...item,
      updatedAt: serverTimestamp(),
      importadoEm: serverTimestamp(),
      importacaoId: importRef.id,
    });
    processed++;
  }
  batch.set(importRef, {
    tipo: "pinterest", linhasProcessadas: processed, status: "sucesso", importadoEm: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    if (isPermissionDenied(e)) throwImportPermissionError(e, "pinterest_ads/importacoes");
    throw e;
  }

  await touchImportacoesLatest("pinterest", importRef.id);

  let vinculados = 0;
  try {
    const result = await autoLinkAds();
    vinculados = result.produtosVinculados;
  } catch (e) {
    console.warn("Auto-link Pinterest→Produtos falhou:", e.message);
  }
  return { linhas: processed, produtosVinculados: vinculados, colunas: Object.keys(rows[0] || {}) };
}

async function autoLinkAds() {
  const importacoes = await getImportacoes().catch(() => []);
  const latestVendaImport = pickLatestImport(importacoes, "shopee_venda");
  const latestMetaImport = pickLatestImport(importacoes, "meta_ads");
  const latestPinterestImport = pickLatestImport(importacoes, "pinterest");

  if (!latestVendaImport?.id) return { produtosVinculados: 0 };

  const [metaSnap, pinSnap, prodSnap] = await Promise.all([
    latestMetaImport?.id
      ? getDocs(query(collection(db, COLLECTIONS.META_ADS), where("importacaoId", "==", latestMetaImport.id)))
      : getDocs(collection(db, COLLECTIONS.META_ADS)),
    latestPinterestImport?.id
      ? getDocs(query(collection(db, COLLECTIONS.PINTEREST), where("importacaoId", "==", latestPinterestImport.id)))
      : getDocs(collection(db, COLLECTIONS.PINTEREST)),
    latestVendaImport?.modo === "append"
      ? getDocs(collection(db, COLLECTIONS.PRODUTOS))
      : getDocs(query(collection(db, COLLECTIONS.PRODUTOS), where("importacaoId", "==", latestVendaImport.id))),
  ]);

  const metaIndex = {};
  metaSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.subid || normalizeSubId(data.nomeAnuncio);
    if (!metaIndex[norm]) metaIndex[norm] = { ids: [], valorUsado: 0 };
    metaIndex[norm].valorUsado += data.valorUsado || 0;
    metaIndex[norm].ids.push(d.id);
  });

  const pinIndex = {};
  pinSnap.docs.forEach((d) => {
    const data = d.data();
    const norm = data.subid || normalizeSubId(data.adName);
    if (!pinIndex[norm]) pinIndex[norm] = { ids: [], spend: 0 };
    pinIndex[norm].spend += data.spend || 0;
    pinIndex[norm].ids.push(d.id);
  });

  if (!Object.keys(metaIndex).length && !Object.keys(pinIndex).length) return { produtosVinculados: 0 };

  let updateBatch = writeBatch(db);
  let produtosVinculados = 0;
  let batchCount = 0;

  for (const docSnap of prodSnap.docs) {
    const prod   = docSnap.data();
    const subIds = prod.sub_ids || (prod.sub_id ? [prod.sub_id] : []);
    if (!subIds.length) continue;

    const matchedMeta = [];
    const matchedPin  = [];
    let totalInvest   = 0;

    subIds.forEach((sid) => {
      const norm = normalizeSubId(sid);
      if (metaIndex[norm]) { matchedMeta.push(...metaIndex[norm].ids); totalInvest += metaIndex[norm].valorUsado; }
      if (pinIndex[norm])  { matchedPin.push(...pinIndex[norm].ids);   totalInvest += pinIndex[norm].spend; }
    });

    if (!matchedMeta.length && !matchedPin.length) continue;

    const metaUnique = dedupeAdIds(matchedMeta);
    const pinUnique = dedupeAdIds(matchedPin);

    updateBatch.set(docSnap.ref, {
      metaAdIds: metaUnique,
      pinterestAdIds: pinUnique,
      investimento: Math.round(totalInvest * 100) / 100,
    }, { merge: true });
    produtosVinculados++;
    batchCount++;

    if (batchCount >= 400) {
      await updateBatch.commit();
      updateBatch = writeBatch(db);
      batchCount  = 0;
    }
  }

  if (batchCount > 0) await updateBatch.commit();
  if (produtosVinculados > 0) invalidateDashboardCaches();
  return { produtosVinculados };
}

export { autoLinkAds };

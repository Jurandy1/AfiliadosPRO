import { supabase } from "../../../services/supabase/client";

const IMPORTACOES_LIMIT = 120;
const LATEST_IMPORTS_DOC = "importacoes_latest";
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

const TIPO_TO_FIELD = {
  meta_ads: "metaAds",
  pinterest: "pinterest",
  shopee_venda: "shopeeVenda",
  shopee_clique: "shopeeClique",
};

let sessionCache = null;
let sessionCacheTs = 0;

export function pickLatestImport(importacoes, tipo) {
  return [...(importacoes || [])]
    .filter((item) => item.tipo === tipo)
    .sort((a, b) => {
      const tsA = new Date(a.importadoEm || 0).getTime();
      const tsB = new Date(b.importadoEm || 0).getTime();
      return tsB - tsA;
    })[0] || null;
}

/** Atualiza ponteiro de última importação por tipo (1 write). */
export async function touchImportacoesLatest(tipo, importId) {
  const field = TIPO_TO_FIELD[tipo];
  if (!field || !importId) return;
  try {
    const { data: snap } = await supabase.from("sync_state").select("data_blob").eq("key", LATEST_IMPORTS_DOC).single();
    const data = snap?.data_blob || {};
    data[field] = importId;
    data.updatedAt = new Date().toISOString();
    
    await supabase.from("sync_state").upsert({
      key: LATEST_IMPORTS_DOC,
      data_blob: data,
    });
    sessionCache = null;
  } catch (err) {
    console.warn("[touchImportacoesLatest]", err?.message || err);
  }
}

/** IDs das últimas importações - 1 read em sync_state/importacoes_latest. */
export async function getLatestImportIds() {
  const now = Date.now();
  if (sessionCache && now - sessionCacheTs < SESSION_CACHE_TTL_MS) {
    return sessionCache;
  }

  try {
    const { data: snap } = await supabase.from("sync_state").select("data_blob").eq("key", LATEST_IMPORTS_DOC).single();
    if (snap) {
      const d = snap.data_blob || {};
      sessionCache = {
        metaAds: d.metaAds || null,
        pinterest: d.pinterest || null,
        shopeeVenda: d.shopeeVenda || null,
        shopeeClique: d.shopeeClique || null,
      };
      sessionCacheTs = now;
      return sessionCache;
    }
  } catch {
    /* fallback abaixo */
  }

  const importacoes = await getImportacoes(50);
  sessionCache = {
    metaAds: pickLatestImport(importacoes, "meta_ads")?.id || null,
    pinterest: pickLatestImport(importacoes, "pinterest")?.id || null,
    shopeeVenda: pickLatestImport(importacoes, "shopee_venda")?.id || null,
    shopeeClique: pickLatestImport(importacoes, "shopee_clique")?.id || null,
  };
  sessionCacheTs = now;
  return sessionCache;
}

/** Leitura leve do log de importações - sem dependência de xlsx/parsers. */
export async function getImportacoes(maxDocs = IMPORTACOES_LIMIT) {
  const cap = Math.max(1, Number(maxDocs) || IMPORTACOES_LIMIT);
  try {
    const { data: snap, error } = await supabase
      .from("importacoes")
      .select("id, data_blob")
      .order("data_blob->>importadoEm", { ascending: false })
      .limit(cap);

    if (error) throw error;

    return (snap || []).map((d) => ({ id: d.id, ...(d.data_blob || {}) }));
  } catch (err) {
    console.warn("Erro ao buscar importações:", err);
    return [];
  }
}

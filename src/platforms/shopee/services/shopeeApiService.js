/**
 * Cliente do garimpo contextual — chama Cloud Function (secrets ficam no backend).
 */

import { parsePrecoGarimpo } from "../utils/backupGarimpoSettings";
import { extrairTermosBuscaGarimpo } from "../utils/garimpoKeywordUtils";

const GARIMPO_KEYWORD_URL = import.meta.env.VITE_GARIMPO_KEYWORD_URL;
const SECRET = import.meta.env.VITE_BACKFILL_SECRET;

/** Uma busca por vez — evita rate limit da Shopee com vários grupos abertos. */
let garimpoChain = Promise.resolve();

function enfileirarGarimpo(fn) {
  const next = garimpoChain.then(fn, fn);
  garimpoChain = next.catch(() => {});
  return next;
}

/**
 * Garimpo contextual calibrado: múltiplos termos, mesma loja, ranking por relevância.
 * @param {object} produtoPrincipal
 * @param {string[]} excludeItemIds
 * @param {number} limit
 * @returns {Promise<{ ofertas: Array, termoUsado: string, termosTentados: string[] }>}
 */
export async function buscarGarimpoContextual(produtoPrincipal, excludeItemIds = [], limit = 5, garimpoSettings = null) {
  if (!GARIMPO_KEYWORD_URL || !SECRET) {
    console.warn("[garimpo] VITE_GARIMPO_KEYWORD_URL ou VITE_BACKFILL_SECRET ausente");
    return { ofertas: [], termoUsado: "", termosTentados: [] };
  }

  return enfileirarGarimpo(() => buscarGarimpoContextualRequest(
    produtoPrincipal,
    excludeItemIds,
    limit,
    garimpoSettings,
  ));
}

async function buscarGarimpoContextualRequest(produtoPrincipal, excludeItemIds, limit, garimpoSettings) {

  const settings = garimpoSettings || {
    precoToleranciaAcimaPct: 15,
    precoToleranciaAbaixoPct: 25,
  };

  const { primario } = extrairTermosBuscaGarimpo(
    produtoPrincipal?.nome,
    produtoPrincipal?.apelido,
  );
  const nomeBusca = primario
    || String(produtoPrincipal?.apelido || "").trim()
    || String(produtoPrincipal?.nome || "").trim().slice(0, 80);

  const excludeItemIdsUnicos = [...new Set(
    [produtoPrincipal?.itemId, ...excludeItemIds].filter(Boolean).map(String),
  )];

  const payload = {
    nome: nomeBusca,
    nomeCompleto: String(produtoPrincipal?.nome || "").trim(),
    apelido: String(produtoPrincipal?.apelido || "").trim(),
    shopId: String(produtoPrincipal?.shopId || ""),
    comissaoPct: Number(produtoPrincipal?.comissao_pct || 0),
    precoPrincipal: parsePrecoGarimpo(produtoPrincipal?.preco),
    precoToleranciaAcimaPct: Number(settings.precoToleranciaAcimaPct ?? 15),
    precoToleranciaAbaixoPct: Number(settings.precoToleranciaAbaixoPct ?? 25),
    limit: Number(limit),
    excludeItemIds: excludeItemIdsUnicos,
  };

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 120000);

  try {
    const response = await fetch(GARIMPO_KEYWORD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Erro ${response.status}${text ? `: ${text}` : ""}`);
    }

    const data = await response.json();
    return {
      ofertas: data.ofertas || [],
      termoUsado: data.keyword || data.termoUsado || "",
      termosTentados: data.termosTentados || [],
      shopeeApiOk: data.shopeeApiOk !== false,
      fonte: data.fonte || "shopee",
      motivoVazio: data.motivoVazio || null,
      globalFallback: data.globalFallback === true,
      ofertasOutrasLojas: Number(data.ofertasOutrasLojas || 0),
    };
  } catch (err) {
    console.error("[garimpo] Falha ao consultar ofertas:", err);
    if (err?.name === "AbortError") {
      throw new Error("A busca demorou demais. Tente de novo com o botão ↻.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** @deprecated use buscarGarimpoContextual */
export async function buscarMelhoresOfertasGarimpo(keyword, limit = 5, excludeItemId = null) {
  const fake = {
    nome: keyword,
    itemId: excludeItemId,
    comissao_pct: 0,
  };
  const { ofertas } = await buscarGarimpoContextual(fake, excludeItemId ? [] : [], limit);
  return ofertas;
}

export { extrairTermosBuscaGarimpo } from "../utils/garimpoKeywordUtils";

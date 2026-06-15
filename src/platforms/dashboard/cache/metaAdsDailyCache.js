/**
 * metaAdsDailyCache.js
 *
 * Cache de meta_ads_daily com duas camadas:
 *   L1 — Memória (Map): dura enquanto a página não for recarregada.
 *   L2 — IndexedDB via dailyGranularCache: persiste entre recarregamentos,
 *        validado contra o manifesto sync_state/daily_versions.
 *
 * Ativação do IDB (L2):
 *   - Requer VITE_SMART_CACHE_META=1 no .env.
 *   - Se a variável estiver ausente ou for "0", apenas L1 (comportamento original).
 *
 * Garantia de dados frescos:
 *   - O backend chama bumpDailyVersionsManifest(dates, "meta") ao fim de cada
 *     sincronização com a API do Meta (metaBackfillDaily).
 *   - Isso atualiza sync_state/daily_versions com um novo timestamp por dia.
 *   - Na próxima leitura após o TTL de 30s do manifesto em memória, o frontend
 *     detecta a divergência de versão e re-busca os dias afetados do Firestore.
 *   - invalidateMetaAdsDailyCache() força o descarte do L1 e do manifesto em
 *     memória, garantindo dados frescos imediatos no próximo acesso.
 */
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../services/firebase/client";
import {
  fetchSmartDailyCollection,
  invalidateDailyVersionsManifestCache,
} from "./dailyGranularCache";

const SMART_CACHE_ATIVO = String(import.meta.env.VITE_SMART_CACHE_META ?? "0") === "1";

const EMPTY_SNAP = { empty: true, forEach: () => {}, docs: [] };

// L1: cache em memória por chave de período
let _l1Cache = null;
let _l1CacheKey = null;
let _invalidateTimer = null;

/**
 * Converte um array plano de objetos num "snapshot-like" compatível
 * com o código existente que usa .forEach((doc) => doc.data()).
 */
function arrayToSnapLike(dataArray) {
  if (!dataArray || dataArray.length === 0) return EMPTY_SNAP;
  const docs = dataArray.map((d) => ({ data: () => d }));
  return {
    empty: false,
    docs,
    forEach: (cb) => docs.forEach(cb),
  };
}

/**
 * Invalida o cache L1 em memória e, se o smart cache estiver ativo,
 * também invalida o cache do manifesto em memória, forçando nova leitura
 * do Firestore na próxima chamada.
 */
export function invalidateMetaAdsDailyCache(delayMs = 0) {
  if (_invalidateTimer) clearTimeout(_invalidateTimer);

  const doInvalidate = () => {
    _l1Cache = null;
    _l1CacheKey = null;
    if (SMART_CACHE_ATIVO) {
      // Força o manifesto a ser relido do Firestore na próxima requisição.
      // Isso garante que se um sync aconteceu, as versões novas sejam detectadas.
      invalidateDailyVersionsManifestCache();
    }
  };

  if (delayMs > 0) {
    _invalidateTimer = setTimeout(doInvalidate, delayMs);
  } else {
    doInvalidate();
  }
}

/**
 * Busca meta_ads_daily para o período.
 *
 * Com VITE_SMART_CACHE_META=1:
 *   - Lê manifesto (1 leitura leve, cacheada 30s)
 *   - Dias já no IDB com versão correta → zero leituras Firestore
 *   - Dias stale ou ausentes → range query apenas no intervalo necessário
 *
 * Sem a flag: comportamento original (getDocs direto + L1 memória).
 */
export async function fetchMetaAdsDailySnapshot(startDate, endDate) {
  if (!startDate || !endDate) return EMPTY_SNAP;

  const l1Key = `${startDate}|${endDate}`;

  // L1: resposta instantânea se o período já está na memória desta sessão
  if (_l1CacheKey === l1Key && _l1Cache) return _l1Cache;

  let result;

  if (SMART_CACHE_ATIVO) {
    // L2: cache IDB diferencial — só vai ao Firestore nos dias stale/ausentes
    const dataArray = await fetchSmartDailyCollection("meta_ads_daily", startDate, endDate);
    result = arrayToSnapLike(dataArray);
  } else {
    // Comportamento original: getDocs direto
    const q = query(
      collection(db, "meta_ads_daily"),
      where("data", ">=", startDate),
      where("data", "<=", endDate),
    );
    const snap = await getDocs(q).catch(() => EMPTY_SNAP);
    result = (!snap || snap.empty) ? EMPTY_SNAP : snap;
  }

  // Salva no L1 para reuso imediato nesta sessão
  _l1Cache = result;
  _l1CacheKey = l1Key;
  return result;
}

import { supabase } from "../../../services/supabase/client";

const VERSIONS_TTL_MS = 10_000;

let cachedVersions = null;
let cachedVersionsTs = 0;
let _inFlightPromise = null;  // PATCH M: dedup de chamadas paralelas

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "string") return new Date(value).getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Versão composta Shopee + Meta para invalidar cache de período.
 * TTL curto em memória evita 2 reads a cada navegação dentro do mesmo minuto.
 *
 * PATCH M: in-flight dedup — se 3 componentes chamam ao mesmo tempo,
 * só 1 fetch ao Firestore (os outros 2 esperam a mesma Promise).
 */
export async function fetchDataVersions({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedVersions && now - cachedVersionsTs < VERSIONS_TTL_MS) {
    return cachedVersions;
  }

  // Se há um fetch em andamento, devolve a mesma Promise
  if (!force && _inFlightPromise) {
    return _inFlightPromise;
  }

  _inFlightPromise = (async () => {
    try {
      const [shopeeSnap, metaSnap] = await Promise.all([
        supabase.from("sync_state").select("data_blob").eq("key", "shopee_health").single().then(r => r.error ? { error: r.error } : r),
        supabase.from("sync_state").select("data_blob").eq("key", "meta_health").single().then(r => r.error ? { error: r.error } : r),
      ]);

      const shopeeData = shopeeSnap?.data?.data_blob || {};
      const shopeeVer = Number(shopeeData.dataVersion || 0);
      
      const meta = metaSnap?.data?.data_blob || {};
      const metaVer = Math.max(
        timestampToMs(meta.lastDailySyncAt),
        timestampToMs(meta.lastAdsSyncAt),
        Number(meta.dataVersion || 0),
      );

      cachedVersions = {
        shopeeVer,
        metaVer,
        timeBucket: Math.floor(Date.now() / 30_000),
        versionKey: `${shopeeVer}:${metaVer}`,
      };
      cachedVersionsTs = Date.now();
      return cachedVersions;
    } finally {
      _inFlightPromise = null;
    }
  })();

  return _inFlightPromise;
}

export function invalidateDataVersionsCache() {
  cachedVersions = null;
  cachedVersionsTs = 0;
  _inFlightPromise = null;
}

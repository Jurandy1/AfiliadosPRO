import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../services/firebase/client";

const VERSIONS_TTL_MS = 30_000;

let cachedVersions = null;
let cachedVersionsTs = 0;

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Versão composta Shopee + Meta para invalidar cache de período.
 * TTL curto em memória evita 2 reads a cada navegação dentro do mesmo minuto.
 */
export async function fetchDataVersions({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedVersions && now - cachedVersionsTs < VERSIONS_TTL_MS) {
    return cachedVersions;
  }

  const [shopeeSnap, metaSnap] = await Promise.all([
    getDoc(doc(db, "sync_state", "shopee_health")).catch(() => null),
    getDoc(doc(db, "sync_state", "meta_health")).catch(() => null),
  ]);

  const shopeeVer = Number(shopeeSnap?.exists?.() ? shopeeSnap.data()?.dataVersion : 0) || 0;
  const meta = metaSnap?.exists?.() ? (metaSnap.data() || {}) : {};
  const metaVer = Math.max(
    timestampToMs(meta.lastDailySyncAt),
    timestampToMs(meta.lastAdsSyncAt),
    Number(meta.dataVersion || 0),
  );

  cachedVersions = {
    shopeeVer,
    metaVer,
    versionKey: `${shopeeVer}:${metaVer}`,
  };
  cachedVersionsTs = now;
  return cachedVersions;
}

export function invalidateDataVersionsCache() {
  cachedVersions = null;
  cachedVersionsTs = 0;
}

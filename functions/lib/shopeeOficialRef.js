"use strict";

/** Fallback se Firestore config/shopee_oficial não existir */
const DEFAULT_SHOPEE_OFICIAL_PERIOD_REF = {
  "2026-05": {
    pedidos: 11900,
    comissao: 35800,
    gmv: 701900,
    itens: 13600,
  },
};

let cachedRef = null;
let loadPromise = null;

async function loadShopeeOficialPeriodRef(db) {
  if (cachedRef) return cachedRef;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (db) {
        const snap = await db.collection("config").doc("shopee_oficial").get();
        if (snap.exists) {
          const periods = snap.data()?.periods;
          if (periods && typeof periods === "object" && Object.keys(periods).length) {
            cachedRef = periods;
            return cachedRef;
          }
        }
      }
    } catch (e) {
      console.warn("[shopeeOficialRef] Firestore config:", e?.message || e);
    }
    cachedRef = { ...DEFAULT_SHOPEE_OFICIAL_PERIOD_REF };
    return cachedRef;
  })();

  return loadPromise;
}

function getShopeeOficialPeriodRefSync() {
  return cachedRef || DEFAULT_SHOPEE_OFICIAL_PERIOD_REF;
}

function monthHasShopeePanelTarget(monthKey) {
  const ref = getShopeeOficialPeriodRefSync();
  return Boolean(ref[monthKey]);
}

module.exports = {
  DEFAULT_SHOPEE_OFICIAL_PERIOD_REF,
  loadShopeeOficialPeriodRef,
  getShopeeOficialPeriodRefSync,
  monthHasShopeePanelTarget,
};

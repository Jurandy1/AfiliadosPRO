import { useCallback, useEffect, useRef, useState } from "react";
import { getMetaAds } from "../repositories/metaRepository";
import { getPinterest } from "../../pinterest/repositories/pinterestRepository";
import { getImportacoes, getLatestImportIds } from "../../imports/repositories/importacoesLogRepository";

export function useTrafficData() {
  const [meta, setMeta] = useState([]);
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metaError, setMetaError] = useState(null);
  const [pinsError, setPinsError] = useState(null);
  const [metaSync, setMetaSync] = useState(null);
  const [nonce, setNonce] = useState(0);
  const isFirstLoad = useRef(true);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    if (isFirstLoad.current) setLoading(true);
    else setRefreshing(true);
    setMetaError(null);
    setPinsError(null);

    (async () => {
      try {
        const [importIds, importacoesRes] = await Promise.all([
          getLatestImportIds().catch(() => ({})),
          getImportacoes().catch(() => []),
        ]);
        if (!alive) return;

        const [metaRes, pinRes] = await Promise.allSettled([
          getMetaAds(importIds.metaAds || null),
          getPinterest(importIds.pinterest || null),
        ]);
        if (!alive) return;

        if (metaRes.status === "fulfilled") setMeta(metaRes.value || []);
        else { setMeta([]); setMetaError(metaRes.reason); }

        if (pinRes.status === "fulfilled") setPins(pinRes.value || []);
        else { setPins([]); setPinsError(pinRes.reason); }

        const importacoes = importacoesRes || [];
        const latest = [...importacoes]
          .filter((i) => i?.tipo === "meta_ads" && i?.fonte === "api_backend")
          .sort((a, b) => (b?.importadoEm?.seconds || 0) - (a?.importadoEm?.seconds || 0))[0] || null;
        setMetaSync(latest);
      } finally {
        if (alive) {
          setLoading(false);
          setRefreshing(false);
          isFirstLoad.current = false;
        }
      }
    })();

    return () => { alive = false; };
  }, [nonce]);

  return { meta, pins, loading, refreshing, metaError, pinsError, metaSync, reload };
}


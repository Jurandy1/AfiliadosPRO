/** Politica compartilhada de sync Shopee/Meta (Dashboard + ShopeePage). */

export function painelKpisTemDados(kpis) {
  if (!kpis) return false;
  return (
    (kpis.pedidos || 0) > 0
    || (kpis.vendas || 0) > 0
    || (kpis.comissaoEstimada || kpis.comissao || 0) > 0
    || (kpis.fatBruto || 0) > 0
  );
}

export function deveSincronizarShopee({
  precisaSync,
  forceSync,
  periodoFiltro,
  cacheCompleto,
}) {
  return Boolean(
    precisaSync && (
      forceSync
      || periodoFiltro === "ontem"
      || !cacheCompleto
    ),
  );
}

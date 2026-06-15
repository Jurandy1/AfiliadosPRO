/** Mapeamento rota interna ↔ path na barra de endereço (favoritos, compartilhar, voltar). */
export const ROUTE_PATHS = {
  dashboard: "/",
  super_comissoes: "/SuperComissoes",
  performance_produto: "/Performance",
  central_risco: "/CentralRisco",
  backup: "/Backup",
  shopee: "/Produto",
  traffic_overview: "/Trafego",
  traffic_meta: "/Trafego/Meta",
  traffic_campaigns: "/Trafego/Campanhas",
  traffic_insights: "/Trafego/Analise",
  traffic_demographics: "/Trafego/Demografia",
  traffic_pinterest: "/Trafego/Pinterest",
  imports: "/Importar",
  audit: "/Auditoria",
  settings: "/Configuracoes",
};

const PATH_TO_ROUTE = new Map(
  Object.entries(ROUTE_PATHS).map(([routeKey, path]) => [path.toLowerCase(), routeKey]),
);

export function normalizePathname(pathname) {
  let path = String(pathname || "/").split("?")[0].split("#")[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* mantém original */
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

export function routeFromPath(pathname) {
  const normalized = normalizePathname(pathname);
  return PATH_TO_ROUTE.get(normalized.toLowerCase()) || null;
}

export function pathFromRoute(routeKey) {
  return ROUTE_PATHS[routeKey] || ROUTE_PATHS.dashboard;
}

export function isKnownRoute(routeKey) {
  return Boolean(ROUTE_PATHS[routeKey]);
}

export function readRouteFromLocation() {
  return routeFromPath(window.location.pathname) || "dashboard";
}

/** Garante URL canônica ao carregar ou ao digitar path desconhecido. */
export function syncCanonicalUrl(routeKey) {
  const canonical = pathFromRoute(routeKey);
  if (window.location.pathname !== canonical) {
    window.history.replaceState({ route: routeKey }, "", canonical);
  }
}

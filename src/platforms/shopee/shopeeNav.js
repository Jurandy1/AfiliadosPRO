import {
  Archive,
  BarChart3,
  Package,
  Search,
  ShieldAlert,
} from "lucide-react";

/** Rotas do menu lateral — seção Shoppe (ordem de exibição). */
export const SHOPPE_GROUP_ROUTES = [
  "super_comissoes",
  "performance_produto",
  "central_risco",
  "backup",
  "shopee",
];

export const SHOPPE_NAV_ITEMS = [
  { routeKey: "super_comissoes", label: "Super-Comissões", icon: Search },
  { routeKey: "performance_produto", label: "Performance", icon: BarChart3 },
  { routeKey: "central_risco", label: "Central de Risco", icon: ShieldAlert },
  { routeKey: "backup", label: "Backup", icon: Archive },
  { routeKey: "shopee", label: "Produto", icon: Package },
];

export function isShoppeRoute(routeKey) {
  return SHOPPE_GROUP_ROUTES.includes(routeKey);
}

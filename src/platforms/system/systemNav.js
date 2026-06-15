import { Bell, Settings, Upload } from "lucide-react";

/** Rotas do menu lateral — seção Sistema (ordem de exibição). */
export const SYSTEM_GROUP_ROUTES = ["audit", "imports", "settings"];

export const SYSTEM_NAV_ITEMS = [
  { routeKey: "audit", label: "Auditoria", icon: Bell },
  { routeKey: "imports", label: "Importar", icon: Upload },
  { routeKey: "settings", label: "Configurações", icon: Settings },
];

export function isSystemRoute(routeKey) {
  return SYSTEM_GROUP_ROUTES.includes(routeKey);
}

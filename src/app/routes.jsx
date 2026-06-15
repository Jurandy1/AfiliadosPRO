import {
  LayoutDashboard,
  Package,
  Upload,
  Bell,
  Target,
  Settings,
  Archive,
  Zap,
  Users,
  TrendingUp,
  BarChart3,
  Layers,
  ShieldAlert,
  Search,
} from "lucide-react";
import { lazy } from "react";

export {
  isShoppeRoute,
  SHOPPE_GROUP_ROUTES,
} from "@platforms/shopee/shopeeNav.js";

export {
  isSystemRoute,
  SYSTEM_GROUP_ROUTES,
} from "@platforms/system/systemNav.js";

import { SHOPPE_GROUP_ROUTES } from "@platforms/shopee/shopeeNav.js";
import { SYSTEM_GROUP_ROUTES } from "@platforms/system/systemNav.js";

const DashboardPage = lazy(() => import("@platforms/dashboard/pages/DashboardPage"));
const ShopeePage = lazy(() => import("@platforms/shopee/pages/ShopeePage"));
const TrafficPage = lazy(() => import("@platforms/meta/pages/TrafficPage"));
const BackupPage = lazy(() => import("@platforms/shopee/pages/BackupPage"));
const CentralRiscoPage = lazy(() => import("@platforms/shopee/pages/CentralRiscoPage"));
const PerformanceProdutoPage = lazy(() => import("@platforms/shopee/pages/PerformanceProdutoPage"));
const SuperComissoesPage = lazy(() => import("@platforms/shopee/pages/SuperComissoesPage"));
const ImportsPage = lazy(() => import("@platforms/imports/pages/ImportsPage"));
const AuditPage = lazy(() => import("../pages/AuditPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));

export const ROUTES = {
  dashboard: {
    id: "dashboard",
    title: "Dashboard",
    heroTitle: "Painel Decisivo",
    sub: "KPIs decisivos · alertas · ranking e ações",
    icon: LayoutDashboard,
    Page: DashboardPage,
  },
  shopee: {
    id: "shopee",
    title: "Produto",
    sub: "Catálogo, links de afiliado e vínculo com anúncios",
    icon: Package,
    Page: ShopeePage,
  },
  central_risco: {
    id: "central_risco",
    title: "Central de Risco",
    sub: "Cancelamentos, pendências e backups em alerta",
    icon: ShieldAlert,
    Page: CentralRiscoPage,
    needsNavigate: true,
  },
  performance_produto: {
    id: "performance_produto",
    title: "Performance",
    sub: "Top produtos e SubID no período",
    icon: BarChart3,
    Page: PerformanceProdutoPage,
  },
  traffic_overview: {
    id: "traffic_overview",
    title: "Visão geral",
    sub: "KPIs consolidados · Meta + Pinterest",
    icon: BarChart3,
    Page: TrafficPage,
    section: "overview",
  },
  traffic_meta: {
    id: "traffic_meta",
    title: "Meta Ads",
    sub: "Anúncios, filtros, AIDA e ROAS real",
    icon: Target,
    Page: TrafficPage,
    section: "meta",
  },
  traffic_campaigns: {
    id: "traffic_campaigns",
    title: "Campanhas",
    sub: "Visão agrupada por campanha Meta",
    icon: Layers,
    Page: TrafficPage,
    section: "campaigns",
  },
  traffic_insights: {
    id: "traffic_insights",
    title: "Análise IA",
    sub: "Alertas automáticos · scores · próximos passos",
    icon: Zap,
    Page: TrafficPage,
    section: "insights",
  },
  traffic_demographics: {
    id: "traffic_demographics",
    title: "Demografia",
    sub: "Idade, sexo e região — Meta Ads",
    icon: Users,
    Page: TrafficPage,
    section: "demographics",
  },
  traffic_pinterest: {
    id: "traffic_pinterest",
    title: "Pinterest",
    sub: "Pins, gasto, cliques e CPC",
    icon: TrendingUp,
    Page: TrafficPage,
    section: "pinterest",
  },
  backup: {
    id: "backup",
    title: "Backup",
    sub: "Contingência, garimpo inteligente e rotas de reserva",
    icon: Archive,
    Page: BackupPage,
  },
  super_comissoes: {
    id: "super_comissoes",
    title: "Super-Comissões",
    sub: "Busca productOfferV2 · filtros AMS e Mall · links com SubIDs",
    icon: Search,
    Page: SuperComissoesPage,
  },
  imports: {
    id: "imports",
    title: "Importar",
    sub: "Subir CSVs e XLSX",
    icon: Upload,
    Page: ImportsPage,
  },
  audit: {
    id: "audit",
    title: "Auditoria",
    sub: "Alertas pendentes",
    icon: Bell,
    Page: AuditPage,
    showBadge: true,
  },
  settings: {
    id: "settings",
    title: "Configurações",
    sub: "Preferências do sistema",
    icon: Settings,
    Page: SettingsPage,
  },
};

/** @deprecated use traffic_overview */
ROUTES.traffic = ROUTES.traffic_overview;

export const TRAFFIC_GROUP_ROUTES = [
  "traffic_overview",
  "traffic_meta",
  "traffic_campaigns",
  "traffic_insights",
  "traffic_demographics",
  "traffic_pinterest",
];

export const NAV_ITEMS = [
  { type: "label", text: "Operação" },
  { type: "route", key: "dashboard" },
  { type: "label", text: "Shoppe" },
  ...SHOPPE_GROUP_ROUTES.map((key) => ({ type: "route", key, nested: true })),
  { type: "label", text: "Tráfego" },
  ...TRAFFIC_GROUP_ROUTES.map((key) => ({ type: "route", key, nested: true })),
  { type: "label", text: "Sistema" },
  ...SYSTEM_GROUP_ROUTES.map((key) => ({ type: "route", key })),
];

/** Rotas planas para compatibilidade */
export const ROUTE_ORDER = NAV_ITEMS.flatMap((item) => {
  if (item.type === "route") return [item.key];
  return [];
});

import {
  LayoutDashboard,
  Target,
  Zap,
  Users,
  TrendingUp,
  Layers,
} from "lucide-react";

/** Abas internas + rotas do módulo Tráfego */
export const TRAFFIC_TABS = [
  {
    routeKey: "traffic_overview",
    label: "Visão geral",
    shortLabel: "Geral",
    description: "KPIs, rankings e status das fontes",
    icon: LayoutDashboard,
  },
  {
    routeKey: "traffic_meta",
    label: "Meta Ads",
    shortLabel: "Meta",
    description: "Anúncios, filtros e ROAS real",
    icon: Target,
  },
  {
    routeKey: "traffic_campaigns",
    label: "Campanhas",
    shortLabel: "Campanhas",
    description: "Visão agrupada por campanha Meta",
    icon: Layers,
  },
  {
    routeKey: "traffic_insights",
    label: "Análise IA",
    shortLabel: "IA",
    description: "Alertas, scores e recomendações",
    icon: Zap,
  },
  {
    routeKey: "traffic_demographics",
    label: "Demografia",
    shortLabel: "Demo",
    description: "Idade, sexo e região (Meta)",
    icon: Users,
  },
  {
    routeKey: "traffic_pinterest",
    label: "Pinterest",
    shortLabel: "Pinterest",
    description: "Pins, gasto e CPC",
    icon: TrendingUp,
  },
];

export function isTrafficRoute(routeKey) {
  return String(routeKey || "").startsWith("traffic_") || routeKey === "traffic";
}

export function trafficSectionFromRoute(routeKey) {
  const map = {
    traffic: "overview",
    traffic_overview: "overview",
    traffic_meta: "meta",
    traffic_campaigns: "campaigns",
    traffic_insights: "insights",
    traffic_demographics: "demographics",
    traffic_pinterest: "pinterest",
  };
  return map[routeKey] || "overview";
}

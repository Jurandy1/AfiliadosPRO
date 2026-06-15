/** Rótulo de origem: API Shopee (backend) vs CSV manual */
export function getImportOrigem(item) {
  if (item?.fonte === "api_backend") {
    return {
      label: "API",
      variant: "Escalando",
      title: "Sincronização automática via API Shopee (Cloud Functions)",
    };
  }
  if (item?.fonte === "csv_manual" || item?.filesKey) {
    return {
      label: "CSV",
      variant: "Shopee",
      title: "Arquivo CSV/XLSX enviado manualmente nesta tela",
    };
  }
  if (item?.tipo === "shopee_venda" && (item?.periodo || item?.rangeStart != null)) {
    return {
      label: "API",
      variant: "Escalando",
      title: "Sync API (registro antigo sem campo fonte)",
    };
  }
  if (item?.tipo === "shopee_venda") {
    return {
      label: "CSV",
      variant: "Shopee",
      title: "Importação manual (registro antigo)",
    };
  }
  return { label: "—", variant: "Pausado", title: "Outro tipo de importação" };
}

export function formatImportPeriodo(item) {
  if (Array.isArray(item?.diasAtualizados) && item.diasAtualizados.length) {
    if (item.diasAtualizados.length <= 3) return item.diasAtualizados.join(", ");
    return `${item.diasAtualizados[0]} … ${item.diasAtualizados[item.diasAtualizados.length - 1]} (${item.diasAtualizados.length} dias)`;
  }
  const p = String(item?.periodo || "");
  if (p.startsWith("refresh_day_")) return p.replace("refresh_day_", "");
  if (p.startsWith("refresh_range_")) return p.replace("refresh_range_", "").replace(/_/g, " → ");
  if (p === "recent_2d") return "Ontem + hoje";
  if (p === "backfill_today_only") return "Hoje";
  if (p === "incremental_cursor") return "Incremental (produtos)";
  if (p.startsWith("backfill_")) return p.replace("backfill_", "").replace("_", " ");
  return p || "—";
}

export function formatRegistrosApi(item) {
  const n = item?.registros_api ?? (getImportOrigem(item).label === "API" ? item?.linhasProcessadas : null);
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("pt-BR");
}

export function formatPedidosSync(item) {
  if (item?.pedidos != null && item.pedidos !== "") {
    return Number(item.pedidos).toLocaleString("pt-BR");
  }
  const porDia = item?.pedidosPorDia;
  if (porDia && typeof porDia === "object") {
    const total = Object.values(porDia).reduce((s, v) => s + (Number(v) || 0), 0);
    if (total > 0) return total.toLocaleString("pt-BR");
  }
  return "—";
}

export function formatLinhasImport(item) {
  const n = item?.linhasProcessadas;
  if (n == null) return "0";
  return Number(n).toLocaleString("pt-BR");
}

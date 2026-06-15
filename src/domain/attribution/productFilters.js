export const ROI_FILTERS = [
  { id: "all", label: "Todos ROI" },
  { id: "positive", label: "ROI ≥ 100%" },
  { id: "negative", label: "ROI < 100%" },
  { id: "none", label: "Sem invest." },
];

export function filterProdutos(list, { statusFilter, roiFilter, origemFilter }) {
  return list.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (origemFilter !== "all" && p.origem !== origemFilter) return false;
    if (roiFilter === "positive" && !(p.investimento > 0 && p.roi >= 1)) return false;
    if (roiFilter === "negative" && !(p.investimento > 0 && p.roi < 1)) return false;
    if (roiFilter === "none" && (p.investimento || 0) > 0) return false;
    return true;
  });
}

export function sortProdutos(list, sortField, sortDir) {
  const mul = sortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = a[sortField] ?? 0;
    const vb = b[sortField] ?? 0;
    if (typeof va === "string") return mul * String(va).localeCompare(String(vb));
    return mul * (va - vb);
  });
}

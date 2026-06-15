import { fmt, fmtNum } from "../../../utils/formatters";
import { SUBID_COL_KEYS, SUBID_COL_LABELS } from "./subIdColumns";

function formatCell(key, row, roiMinimo) {
  if (key === "comissoes") return { value: fmt(row.comissoes), tone: "text-emerald-700 font-semibold" };
  if (key === "gasto") return { value: fmt(row.gasto), tone: "text-slate-700" };
  if (key === "lucro") {
    const ok = (row.lucro || 0) >= 0;
    return { value: fmt(row.lucro), tone: ok ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold" };
  }
  if (key === "roi") {
    const ok = row.roi >= roiMinimo;
    const mid = row.roi >= 0;
    const tone = row.gasto > 0 ? (ok ? "text-emerald-600 font-bold" : mid ? "text-amber-600 font-bold" : "text-rose-600 font-bold") : "text-slate-400";
    return { value: row.gasto > 0 ? `${((row.roi || 0) * 100).toFixed(1)}%` : "—", tone };
  }
  if (key === "faturamento") return { value: fmt(row.faturamento), tone: "text-slate-800" };
  if (key === "ticket") return { value: row.ticket_medio > 0 ? fmt(row.ticket_medio) : "—", tone: "text-slate-700" };
  if (key === "total_vendas") return { value: fmtNum(row.total_vendas), tone: "text-slate-800" };
  if (key === "vendas_diretas") return { value: fmtNum(row.vendas_diretas), tone: "text-slate-700" };
  if (key === "vendas_indiretas") return { value: fmtNum(row.vendas_indiretas), tone: "text-slate-700" };
  if (key === "qtd_itens") return { value: fmtNum(row.qtd_itens), tone: "text-slate-700" };
  if (key === "cliques_anuncio") return { value: fmtNum(row.cliques_anuncio), tone: "text-slate-700" };
  if (key === "cliques_shopee") return { value: fmtNum(row.cliques_shopee), tone: "text-slate-700" };
  if (key === "batimento") {
    return {
      value: row.cliques_anuncio > 0 ? `${((row.batimento || 0) * 100).toFixed(1)}%` : "—",
      tone: "text-slate-700",
    };
  }
  return { value: "—", tone: "text-slate-400" };
}

export default function SubIdMobileCards({ rows, subCols, roiMinimo, totals, emptyMessage }) {
  const visibleKeys = SUBID_COL_KEYS.filter((k) => subCols?.[k]);

  if (!rows.length) {
    return <div className="px-4 py-10 text-center text-slate-400 text-sm">{emptyMessage}</div>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const sid = row.subid || "—";
        const roi = formatCell("roi", row, roiMinimo);
        return (
          <div key={row.id || sid} className="p-4 bg-white">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">SubID</div>
                <div className="text-sm font-bold text-slate-900 break-all leading-snug">{sid}</div>
              </div>
              {subCols.roi && (
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">ROI</div>
                  <div className={`text-lg font-extrabold ${roi.tone}`}>{roi.value}</div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {visibleKeys.filter((k) => k !== "roi").map((key) => {
                const cell = formatCell(key, row, roiMinimo);
                return (
                  <div key={key} className="rounded-lg bg-slate-50 px-2.5 py-2 border border-slate-100">
                    <div className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold truncate">
                      {SUBID_COL_LABELS[key]}
                    </div>
                    <div className={`text-sm mt-0.5 ${cell.tone}`}>{cell.value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {totals && (
        <div className="p-4 bg-slate-900 text-white">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Total filtrado</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {subCols.comissoes && (
              <div><span className="text-slate-400 text-xs">Comissão </span><span className="text-emerald-400 font-bold">{fmt(totals.comissoes)}</span></div>
            )}
            {subCols.gasto && (
              <div><span className="text-slate-400 text-xs">Gasto </span><span className="font-bold">{fmt(totals.gasto)}</span></div>
            )}
            {subCols.lucro && (
              <div><span className="text-slate-400 text-xs">Lucro </span><span className={`font-bold ${totals.lucro >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(totals.lucro)}</span></div>
            )}
            {subCols.total_vendas && (
              <div><span className="text-slate-400 text-xs">Vendas </span><span className="font-bold">{fmtNum(totals.total_vendas)}</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

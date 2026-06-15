import SubIdColumnPicker from "./SubIdColumnPicker";
import SubIdMobileCards from "./SubIdMobileCards";

/** Detalhamento SubID otimizado para mobile (cards + bottom sheets). */
export default function SubIdMobilePanel({
  loadingSubIds,
  rowCount,
  rowCountLabel,
  subSearch,
  setSubSearch,
  subCols,
  setSubCols,
  subColsOpen,
  setSubColsOpen,
  subSortField,
  setSubSortField,
  subSortDir,
  setSubSortDir,
  onlyLoss,
  setOnlyLoss,
  onlyProfit,
  setOnlyProfit,
  rows,
  roiMinimo,
  totals,
}) {
  return (
    <>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold">
            Detalhamento por SubID
            {loadingSubIds && <span className="ml-2 text-xs font-normal text-gray-400">carregando…</span>}
          </h3>
          <span className="text-xs text-gray-400">{rowCountLabel || `${rowCount} SubIDs no período`}</span>
        </div>

        <div className="space-y-3 text-xs">
          <input
            value={subSearch}
            onChange={(e) => setSubSearch(e.target.value)}
            placeholder="Pesquisar SubID..."
            className="border border-slate-200 rounded-xl px-3 py-3 bg-white w-full text-base min-h-[48px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="relative col-span-1">
              <SubIdColumnPicker
                isMobile
                subCols={subCols}
                setSubCols={setSubCols}
                open={subColsOpen}
                onOpenChange={setSubColsOpen}
                className="w-full"
              />
            </div>
            <button
              type="button"
              className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-sm"
              onClick={() => setSubSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {subSortDir === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
          </div>
          <select
            className="w-full min-h-[48px] border border-slate-200 rounded-xl px-3 py-2 bg-white text-sm font-medium"
            value={subSortField}
            onChange={(e) => setSubSortField(e.target.value)}
            aria-label="Ordenar por"
          >
            <option value="roi">Ordenar: ROI</option>
            <option value="lucro">Ordenar: Lucro</option>
            <option value="faturamento">Ordenar: Faturamento</option>
            <option value="comissoes">Ordenar: Comissão</option>
            <option value="gasto">Ordenar: Gasto</option>
            <option value="total_vendas">Ordenar: Vendas</option>
            <option value="batimento">Ordenar: Batimento</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setOnlyLoss((v) => !v); if (!onlyLoss) setOnlyProfit(false); }}
              className={`min-h-[40px] px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                onlyLoss ? "bg-rose-600 text-white border-rose-600" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              Só prejuízo
            </button>
            <button
              type="button"
              onClick={() => { setOnlyProfit((v) => !v); if (!onlyProfit) setOnlyLoss(false); }}
              className={`min-h-[40px] px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                onlyProfit ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"
              }`}
            >
              Só lucro
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100">
        <SubIdMobileCards
          rows={rows}
          subCols={subCols}
          roiMinimo={roiMinimo}
          totals={totals}
          emptyMessage="Nenhuma campanha com esses filtros"
        />
      </div>
    </>
  );
}

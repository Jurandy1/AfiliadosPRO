import {
  SUBID_COL_KEYS,
  SUBID_COL_LABELS,
  applySubIdPreset,
  subIdVisibleColCount,
} from "./subIdColumns";

/** Toolbar compacta original do desktop. */
export default function SubIdDesktopToolbar({
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
}) {
  const count = subIdVisibleColCount(subCols);

  return (
    <div className="text-xs mb-1">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={subSearch}
          onChange={(e) => setSubSearch(e.target.value)}
          placeholder="Pesquisar SubID..."
          className="border border-gray-200 rounded px-2 py-1 bg-white min-w-[160px] flex-1 max-w-xs"
        />
        <button
          type="button"
          onClick={() => setSubColsOpen((v) => !v)}
          className="border border-gray-200 rounded px-2 py-1 bg-white hover:bg-gray-50 shrink-0"
        >
          Colunas · {count}/14
        </button>
        <select
          className="border border-gray-200 rounded px-2 py-1 bg-white"
          value={subSortField}
          onChange={(e) => setSubSortField(e.target.value)}
          aria-label="Ordenar por"
        >
          <option value="roi">ROI</option>
          <option value="lucro">Lucro</option>
          <option value="faturamento">Faturamento</option>
          <option value="comissoes">Comissão</option>
          <option value="gasto">Gasto</option>
          <option value="total_vendas">Vendas</option>
          <option value="batimento">Batimento</option>
        </select>
        <button
          type="button"
          className="border border-gray-200 rounded px-2 py-1 bg-white hover:bg-gray-50"
          onClick={() => setSubSortDir((d) => (d === "asc" ? "desc" : "asc"))}
        >
          {subSortDir === "asc" ? "Asc" : "Desc"}
        </button>
        <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyLoss}
            onChange={(e) => {
              setOnlyLoss(e.target.checked);
              if (e.target.checked) setOnlyProfit(false);
            }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Só prejuízo
        </label>
        <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={onlyProfit}
            onChange={(e) => {
              setOnlyProfit(e.target.checked);
              if (e.target.checked) setOnlyLoss(false);
            }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Só lucro
        </label>
      </div>

      {subColsOpen && (
        <div className="mt-2 p-3 border border-gray-200 rounded-md bg-gray-50">
          <div className="flex flex-wrap gap-2 mb-2">
            {[
              ["essencial", "Essencial"],
              ["financeiro", "Financeiro"],
              ["performance", "Performance"],
              ["todos", "Mostrar tudo"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSubCols(applySubIdPreset(id))}
                className="text-xs px-2 py-1 border border-gray-200 rounded bg-white hover:bg-gray-100"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
            <label className="flex items-center gap-2 px-2 py-1 opacity-70">
              <input type="checkbox" checked readOnly className="rounded border-gray-300" />
              <span className="text-gray-700">SubID</span>
            </label>
            {SUBID_COL_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer hover:bg-white px-2 py-1 rounded">
                <input
                  type="checkbox"
                  checked={!!subCols[key]}
                  onChange={() => setSubCols((p) => ({ ...p, [key]: !p[key] }))}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-gray-700">{SUBID_COL_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

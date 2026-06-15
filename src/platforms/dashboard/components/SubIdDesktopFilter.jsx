/** Filtro inline original do desktop — painel fixo com grid de checkboxes. */
export default function SubIdDesktopFilter({
  subIdsSelecionados,
  setSubIdsSelecionados,
  todosSubIdsDisponiveis,
  subIdFiltroBusca,
  setSubIdFiltroBusca,
  subIdsParaCheckbox,
}) {
  return (
    <div className="mb-4 surface-inset p-0 overflow-hidden">
      <div className="p-4 border-b border-gray-100">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 min-w-0">
            <span>Filtrar SubIDs</span>
            {subIdsSelecionados.length > 0 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                {subIdsSelecionados.length} selecionado(s)
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSubIdsSelecionados(todosSubIdsDisponiveis)}
              className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
            >
              Marcar todos
            </button>
            <button
              type="button"
              onClick={() => setSubIdsSelecionados([])}
              className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
            >
              Limpar
            </button>
          </div>
        </div>

        <input
          type="text"
          placeholder="Buscar SubID..."
          value={subIdFiltroBusca}
          onChange={(e) => setSubIdFiltroBusca(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="p-4 max-h-48 overflow-y-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
          {subIdsParaCheckbox.map((sid) => (
            <label
              key={sid}
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
            >
              <input
                type="checkbox"
                checked={subIdsSelecionados.includes(sid)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSubIdsSelecionados([...subIdsSelecionados, sid]);
                  } else {
                    setSubIdsSelecionados(subIdsSelecionados.filter((s) => s !== sid));
                  }
                }}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="truncate text-gray-700" title={sid}>{sid}</span>
            </label>
          ))}
        </div>
        {subIdsParaCheckbox.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">Nenhum SubID encontrado</p>
        )}
      </div>
    </div>
  );
}

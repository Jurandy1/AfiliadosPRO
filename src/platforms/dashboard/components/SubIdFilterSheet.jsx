import { Filter, X } from "lucide-react";

/** Painel desktop inline + sheet mobile para seleção de SubIDs. */
export default function SubIdFilterSheet({
  isMobile,
  open,
  onOpenChange,
  subIdsSelecionados,
  setSubIdsSelecionados,
  todosSubIdsDisponiveis,
  subIdFiltroBusca,
  setSubIdFiltroBusca,
  subIdsParaCheckbox,
}) {
  const toggle = (sid, checked) => {
    if (checked) setSubIdsSelecionados([...subIdsSelecionados, sid]);
    else setSubIdsSelecionados(subIdsSelecionados.filter((s) => s !== sid));
  };

  const checklist = (
    <div className="space-y-1">
      {subIdsParaCheckbox.map((sid) => (
        <label
          key={sid}
          className={`flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 active:bg-slate-100 cursor-pointer border border-transparent hover:border-slate-100 ${
            isMobile ? "min-h-[48px]" : "min-h-[40px]"
          }`}
        >
          <input
            type="checkbox"
            checked={subIdsSelecionados.includes(sid)}
            onChange={(e) => toggle(sid, e.target.checked)}
            className={`rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0 ${
              isMobile ? "w-5 h-5" : "w-4 h-4"
            }`}
          />
          <span className={`text-slate-800 font-medium break-all ${isMobile ? "text-sm" : "text-xs"}`}>{sid}</span>
        </label>
      ))}
      {subIdsParaCheckbox.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-6">Nenhum SubID encontrado</p>
      )}
    </div>
  );

  const headerActions = (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setSubIdsSelecionados(todosSubIdsDisponiveis)}
        className="flex-1 min-h-[44px] text-sm font-semibold px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100"
      >
        Marcar todos
      </button>
      <button
        type="button"
        onClick={() => setSubIdsSelecionados([])}
        className="flex-1 min-h-[44px] text-sm font-semibold px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100"
      >
        Limpar
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div className="mb-3">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-800 text-sm font-bold"
          >
            <Filter size={18} />
            Filtrar SubIDs
            {subIdsSelecionados.length > 0 ? (
              <span className="bg-indigo-600 text-white text-xs px-2 py-0.5 rounded-full">{subIdsSelecionados.length}</span>
            ) : (
              <span className="text-xs text-indigo-600 font-medium">todos</span>
            )}
          </button>
        </div>

        {open && (
          <div className="fixed inset-0 z-[100] flex flex-col justify-end">
            <button type="button" className="absolute inset-0 bg-slate-900/50" aria-label="Fechar" onClick={() => onOpenChange(false)} />
            <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div>
                  <div className="text-base font-bold text-slate-900">Filtrar SubIDs</div>
                  <div className="text-xs text-slate-500">
                    {subIdsSelecionados.length > 0
                      ? `${subIdsSelecionados.length} selecionado(s)`
                      : "Nenhum filtro — mostrando todos"}
                  </div>
                </div>
                <button type="button" onClick={() => onOpenChange(false)} className="p-2 rounded-full bg-slate-100">
                  <X size={20} />
                </button>
              </div>
              <div className="px-4 py-3 border-b border-slate-100 space-y-3 shrink-0">
                {headerActions}
                <input
                  type="search"
                  placeholder="Buscar SubID..."
                  value={subIdFiltroBusca}
                  onChange={(e) => setSubIdFiltroBusca(e.target.value)}
                  className="w-full px-3 py-3 text-base border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div className="overflow-y-auto px-2 py-2 flex-1">{checklist}</div>
              <div className="p-4 border-t border-slate-100 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white font-bold"
                >
                  Aplicar filtro
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mb-4 surface-inset overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            Filtrar SubIDs
            {subIdsSelecionados.length > 0 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                {subIdsSelecionados.length} selecionado(s)
              </span>
            )}
          </h3>
        </div>
        {headerActions}
        <input
          type="search"
          placeholder="Buscar SubID..."
          value={subIdFiltroBusca}
          onChange={(e) => setSubIdFiltroBusca(e.target.value)}
          className="w-full mt-3 px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div className="p-3 max-h-48 overflow-y-auto">{checklist}</div>
    </div>
  );
}

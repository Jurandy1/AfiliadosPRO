import { Columns3, X } from "lucide-react";
import {
  SUBID_COL_KEYS,
  SUBID_COL_LABELS,
  applySubIdPreset,
  subIdVisibleColCount,
} from "./subIdColumns";

function ColumnChecklist({ subCols, setSubCols, className = "" }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-1 ${className}`}>
      <label className="flex items-center gap-3 py-2.5 px-2 rounded-lg opacity-70 min-h-[44px]">
        <input type="checkbox" checked readOnly className="w-4 h-4 rounded border-slate-300" />
        <span className="text-sm text-slate-700 font-medium">SubID</span>
      </label>
      {SUBID_COL_KEYS.map((key) => (
        <label
          key={key}
          className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-slate-50 cursor-pointer min-h-[44px] active:bg-slate-100"
        >
          <input
            type="checkbox"
            checked={!!subCols[key]}
            onChange={() => setSubCols((p) => ({ ...p, [key]: !p[key] }))}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-slate-700">{SUBID_COL_LABELS[key]}</span>
        </label>
      ))}
    </div>
  );
}

function PresetButtons({ onPreset }) {
  const presets = [
    ["essencial", "Essencial"],
    ["financeiro", "Financeiro"],
    ["performance", "Performance"],
    ["todos", "Mostrar tudo"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 mb-4">
      {presets.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onPreset(id)}
          className="min-h-[44px] text-sm font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Desktop: dropdown. Mobile: bottom sheet full-width. */
export default function SubIdColumnPicker({ isMobile, subCols, setSubCols, open, onOpenChange, className = "" }) {
  const count = subIdVisibleColCount(subCols);

  const applyPreset = (preset) => {
    setSubCols(applySubIdPreset(preset));
  };

  const triggerClass = isMobile
    ? `inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 w-full ${className}`
    : `inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 shrink-0 ${className}`;

  return (
    <>
      <button type="button" onClick={() => onOpenChange(true)} className={triggerClass}>
        <Columns3 size={16} />
        <span>Colunas</span>
        <span className="text-xs text-slate-400 font-medium">{count}/14</span>
      </button>

      {open && !isMobile && (
        <div className="absolute z-30 right-0 mt-2 w-[320px] rounded-xl border border-slate-200 bg-white shadow-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-sm font-semibold text-slate-800">Colunas visíveis</div>
            <button type="button" onClick={() => onOpenChange(false)} className="text-sm text-slate-500 hover:text-slate-800">
              Fechar
            </button>
          </div>
          <PresetButtons onPreset={applyPreset} />
          <ColumnChecklist subCols={subCols} setSubCols={setSubCols} className="grid-cols-2 gap-2 text-[11px]" />
        </div>
      )}

      {open && isMobile && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            aria-label="Fechar"
            onClick={() => onOpenChange(false)}
          />
          <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <div>
                <div className="text-base font-bold text-slate-900">Colunas da tabela</div>
                <div className="text-xs text-slate-500">{count} colunas visíveis</div>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="p-2 rounded-full bg-slate-100 text-slate-600"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 flex-1">
              <PresetButtons onPreset={applyPreset} />
              <ColumnChecklist subCols={subCols} setSubCols={setSubCols} />
            </div>
            <div className="p-4 border-t border-slate-100 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

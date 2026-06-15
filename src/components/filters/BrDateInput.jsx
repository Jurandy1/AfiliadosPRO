import { useEffect, useId, useState } from "react";
import { Calendar } from "lucide-react";
import {
  brtMaxDataSelecionavel,
  formatDateDisplayPT,
  isoToBR,
  parseBRDateInput,
} from "../../utils/dates";

/**
 * Campo de data BR: digitação dd/mm/aaaa + calendário nativo (lang pt-BR).
 * value/onChange em ISO yyyy-mm-dd.
 */
export default function BrDateInput({
  label,
  value = "",
  onChange,
  max = brtMaxDataSelecionavel(),
  disabled = false,
  min,
  compact = false,
}) {
  const id = useId();
  const pickerId = `${id}-picker`;
  const [text, setText] = useState(() => isoToBR(value));

  useEffect(() => {
    setText(isoToBR(value));
  }, [value]);

  const commitText = (raw) => {
    const iso = parseBRDateInput(raw);
    if (!iso) {
      setText(isoToBR(value));
      return;
    }
    if (min && iso < min) {
      setText(isoToBR(value));
      return;
    }
    if (max && iso > max) {
      onChange(max);
      setText(isoToBR(max));
      return;
    }
    onChange(iso);
    setText(isoToBR(iso));
  };

  return (
    <label className={`block text-slate-600 w-full sm:w-auto sm:min-w-[148px] ${compact ? "text-[11px]" : "text-xs"}`}>
      <span className="font-semibold text-slate-500">{label}</span>
      <div className={`flex items-center gap-1 ${compact ? "mt-1" : "mt-1"}`}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/aaaa"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText(text);
            }
          }}
          className="flex-1 min-w-0 px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-100"
          aria-describedby={pickerId}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => document.getElementById(pickerId)?.showPicker?.() ?? document.getElementById(pickerId)?.click()}
          className="shrink-0 p-2 border border-slate-200 rounded-lg bg-white hover:bg-indigo-50 hover:border-indigo-200 disabled:opacity-50 transition-colors"
          title="Abrir calendário"
        >
          <Calendar size={15} className="text-indigo-600" />
        </button>
        <input
          id={pickerId}
          type="date"
          lang="pt-BR"
          disabled={disabled}
          value={value || ""}
          min={min || undefined}
          max={max || undefined}
          onChange={(e) => {
            const iso = e.target.value;
            if (!iso) return;
            onChange(iso);
            setText(isoToBR(iso));
          }}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
      </div>
      {max && !compact && (
        <span className="text-[10px] text-gray-400 mt-0.5 block">
          até {formatDateDisplayPT(max)}
        </span>
      )}
    </label>
  );
}

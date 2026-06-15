import { useState } from "react";
import { ChevronDown, ChevronUp, Settings } from "lucide-react";
import { DEFAULT_THRESHOLDS } from "../traffic/trafficConstants";

export default function TrafficThresholdPanel({ thresholds, onChange }) {
  const [open, setOpen] = useState(false);
  const fields = [
    { key: "cpcBom", label: "CPC Meta barato (R$)", step: 0.1, hint: "Abaixo disso = ótimo" },
    { key: "cpcAlto", label: "CPC Meta caro (R$)", step: 0.1, hint: "Acima disso = alerta" },
    { key: "ctrBom", label: "CTR ótimo (%)", step: 0.1, hint: "Anúncio chamando atenção" },
    { key: "ctrOk", label: "CTR aceitável (%)", step: 0.1, hint: "Mínimo saudável" },
    { key: "ctrFadiga", label: "CTR fadiga (%)", step: 0.1, hint: "Público cansado" },
    { key: "gastoSemClique", label: "Gasto sem clique (R$)", step: 1, hint: "Pause se passar disso" },
    { key: "frequenciaFadiga", label: "Frequência máx.", step: 0.5, hint: "Vezes que a mesma pessoa viu" },
    { key: "desvioAnomalias", label: "Sensibilidade anomalia", step: 0.1, hint: "Quanto menor, mais alertas" },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-left">
          <Settings size={14} className="text-gray-500 shrink-0" />
          <div>
            <span className="text-sm font-semibold block">Ajustar limites da análise</span>
            <span className="text-[10px] text-gray-400">Personalize quando o consultor avisa sobre CPC, CTR e fadiga</span>
          </div>
        </div>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
            {fields.map((f) => (
              <label key={f.key} className="text-xs text-gray-600">
                {f.label}
                <input
                  type="number"
                  step={f.step}
                  min={0}
                  value={thresholds[f.key]}
                  onChange={(e) => onChange({ ...thresholds, [f.key]: parseFloat(e.target.value) || 0 })}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="text-[10px] text-gray-400">{f.hint}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_THRESHOLDS)}
            className="mt-3 text-[11px] text-indigo-600 hover:underline"
          >
            Restaurar padrões
          </button>
        </div>
      )}
    </div>
  );
}

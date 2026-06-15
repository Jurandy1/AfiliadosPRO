import { AlertTriangle, Check, Zap } from "lucide-react";

export default function OperationalAlerts({ alerts, className = "mb-4" }) {
  if (!alerts?.length) {
    return (
      <div className={`bg-emerald-50/90 border border-emerald-100 rounded-2xl px-4 py-3 text-xs text-emerald-700 flex items-center gap-2 ${className}`}>
        <Check size={14} /> Nenhum alerta operacional no momento — métricas dentro do esperado.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {alerts.map((a) => {
        const critica = a.severidade === "critica";
        return (
          <div
            key={a.id}
            className={`rounded-2xl p-4 flex gap-3 relative shadow-sm border ${
              critica ? "bg-red-50/90 border-red-200/90" : "bg-amber-50/90 border-amber-200/90"
            }`}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              critica ? "bg-red-500/10 text-red-700" : "bg-amber-500/10 text-amber-700"
            }`}>
              <AlertTriangle size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <span className={`block text-xs font-bold uppercase tracking-wider ${
                critica ? "text-red-800" : "text-amber-800"
              }`}>
                {critica ? "Alerta crítico" : "Métricas sob alerta"}
              </span>
              <p className={`text-xs font-semibold mt-0.5 ${critica ? "text-red-950" : "text-amber-950"}`}>
                {a.titulo}
              </p>
              {a.mensagem && (
                <p className="text-[11px] text-slate-600 mt-0.5">{a.mensagem}</p>
              )}
            </div>
            <Zap size={14} className={`shrink-0 mt-1 ${critica ? "text-red-400" : "text-amber-400"}`} />
          </div>
        );
      })}
    </div>
  );
}

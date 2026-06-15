import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getAlertas, marcarAlertaLido } from "../services/repositories/alertsRepository";
import LoadingSpinner from "../components/layout/LoadingSpinner";

export default function AuditPage() {
  const [alertas, setAlertas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAlertas().then(setAlertas).finally(() => setLoading(false));
  }, []);

  const dismiss = async (id) => {
    await marcarAlertaLido(id);
    setAlertas((prev) => prev.filter((a) => a.id !== id));
  };

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold mb-3">Alertas ativos ({alertas.length})</h3>
      {alertas.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">Nenhum alerta pendente</div>
      ) : (
        <div className="space-y-2">
          {alertas.map((a) => {
            const borderColor =
              a.severidade === "critica" ? "border-l-red-500" :
              a.severidade === "media" ? "border-l-amber-500" : "border-l-blue-500";
            return (
              <div key={a.id} className={`border border-gray-200 border-l-[3px] ${borderColor} rounded-md p-3 flex gap-3 items-start`}>
                <AlertTriangle size={16} className={a.severidade === "critica" ? "text-red-500 mt-0.5" : "text-amber-500 mt-0.5"} />
                <div className="flex-1">
                  <div className="text-xs font-semibold">{a.titulo}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{a.mensagem}</div>
                </div>
                <button type="button" onClick={() => dismiss(a.id)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">
                  Dispensar
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

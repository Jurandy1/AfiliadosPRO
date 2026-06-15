import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { linkCliquesToProdutos } from "../../../domain/reconciliation/linkCliquesToProdutos";

export default function ReconcileButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleReconcile = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await linkCliquesToProdutos();
      setResult({ success: true, ...res });
    } catch (e) {
      setResult({ success: false, error: e.message });
    }
    setLoading(false);
  };

  return (
    <div className="border border-indigo-100 bg-indigo-50/50 rounded-lg p-3 mt-3 flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold text-indigo-700">Reconciliar cliques com produtos</div>
        <div className="text-[10px] text-indigo-500 mt-0.5">
          Use após importar os dois CSVs para garantir que os cliques apareçam nos produtos corretamente.
        </div>
        {result && (
          <div className={"text-[10px] mt-1 " + (result.success ? "text-emerald-600" : "text-red-500")}>
            {result.success
              ? `${result.produtosAtualizados} produtos atualizados (${result.subIdsIndexados} sub_ids indexados)`
              : result.error}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleReconcile}
        disabled={loading}
        className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {loading ? "Processando..." : "Reconciliar"}
      </button>
    </div>
  );
}

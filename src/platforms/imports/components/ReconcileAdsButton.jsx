import { useState } from "react";
import { Loader2, Link2 } from "lucide-react";
import { autoLinkAds } from "../repositories/importsRepository";

export default function ReconcileAdsButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const handleReconcile = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await autoLinkAds();
      setResult({ success: true, ...res });
    } catch (e) {
      setResult({ success: false, error: e.message });
    }
    setLoading(false);
  };

  return (
    <div className="border border-blue-100 bg-blue-50/50 rounded-lg p-3 mt-3 flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold text-blue-700">
          Vincular Meta/Pinterest → Produtos
        </div>
        <div className="text-[10px] text-blue-500 mt-0.5">
          Vincula automaticamente anúncios a produtos via Sub_id1.
          Executado automaticamente após cada importação — use aqui se precisar forçar.
        </div>
        {result && (
          <div className={"text-[10px] mt-1 " + (result.success ? "text-emerald-600" : "text-red-500")}>
            {result.success
              ? `${result.produtosVinculados} produto(s) vinculado(s) automaticamente`
              : result.error}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleReconcile}
        disabled={loading}
        className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
        {loading ? "Vinculando..." : "Vincular"}
      </button>
    </div>
  );
}

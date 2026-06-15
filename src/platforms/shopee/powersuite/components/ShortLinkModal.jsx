import { Copy, Loader2, X } from "lucide-react";
import { pctFromRate } from "../powersuiteApi";

export default function ShortLinkModal({
  open,
  product,
  subIds,
  onSubIdsChange,
  onClose,
  onGenerate,
  generating,
  generatedLink,
  onCopy,
}) {
  if (!open || !product) return null;

  const comissao = Number(product.commission || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg p-5 relative">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-700">
          <X size={18} />
        </button>

        <h4 className="font-bold text-slate-900">Gerador de link (SubIDs)</h4>
        <p className="text-xs text-slate-500 mt-0.5">Até 5 tags para rastrear vendas no painel Shopee</p>

        <div className="flex gap-3 p-3 mt-4 bg-slate-50 rounded-xl border border-slate-100">
          {product.imageUrl && (
            <img src={product.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover border" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-800 truncate">{product.productName}</p>
            <p className="text-[10px] text-orange-600 font-bold mt-0.5">
              {pctFromRate(product.commissionRate)}% · R$ {comissao.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          {subIds.map((val, idx) => (
            <div key={idx}>
              <span className="text-[9px] text-slate-500 font-bold">SubID {idx + 1}</span>
              <input
                type="text"
                value={val}
                placeholder={idx === 0 ? "vitrine" : "tag"}
                onChange={(e) => {
                  const next = [...subIds];
                  next[idx] = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
                  onSubIdsChange(next);
                }}
                className="w-full mt-0.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="mt-4 w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2"
        >
          {generating ? <Loader2 size={16} className="animate-spin" /> : "Encurtar com assinatura oficial"}
        </button>

        {generatedLink && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2">
            <p className="text-xs font-mono text-slate-700 truncate flex-1">{generatedLink}</p>
            <button type="button" onClick={() => onCopy(generatedLink)} className="shrink-0 p-2 text-emerald-700 hover:bg-emerald-100 rounded-lg">
              <Copy size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

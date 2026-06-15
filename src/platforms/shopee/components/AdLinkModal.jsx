import { useEffect, useState } from "react";
import { Check, Loader2, Target, TrendingUp, X } from "lucide-react";
import { getLatestImportIds } from "../../imports/repositories/importacoesLogRepository";
import { getMetaAds } from "../../meta/repositories/metaRepository";
import { getPinterest } from "../../pinterest/repositories/pinterestRepository";
import { saveAdLink } from "../repositories/productsRepository";
import { matchAdIdsToCatalog, stripAdDateSuffix } from "../../../utils/adLinkIds";

export default function AdLinkModal({ produto, onClose, onSaved }) {
  const [meta, setMeta] = useState([]);
  const [pins, setPins] = useState([]);
  const [selMeta, setSelMeta] = useState(new Set(produto.metaAdIds || []));
  const [selPin, setSelPin] = useState(new Set(produto.pinterestAdIds || []));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLatestImportIds()
      .then(({ metaAds, pinterest }) => Promise.all([
        metaAds ? getMetaAds(metaAds) : Promise.resolve([]),
        pinterest ? getPinterest(pinterest) : Promise.resolve([]),
      ]))
      .then(([m, p]) => {
        const initMeta = new Set((produto.metaAdIds || []).map(stripAdDateSuffix));
        const initPin = new Set((produto.pinterestAdIds || []).map(stripAdDateSuffix));

        const matchedMeta = matchAdIdsToCatalog(m.map((x) => x.id), produto.metaAdIds);
        const matchedPin = matchAdIdsToCatalog(p.map((x) => x.id), produto.pinterestAdIds);
        setSelMeta(matchedMeta);
        setSelPin(matchedPin);

        const byLinkedThenSpend = (linkedSet, spendKey) => (a, b) => {
          const aLinked = linkedSet.has(stripAdDateSuffix(a.id)) ? 1 : 0;
          const bLinked = linkedSet.has(stripAdDateSuffix(b.id)) ? 1 : 0;
          if (aLinked !== bLinked) return bLinked - aLinked;
          return (b[spendKey] || 0) - (a[spendKey] || 0);
        };
        setMeta([...m].sort(byLinkedThenSpend(initMeta, "valorUsado")));
        setPins([...p].sort(byLinkedThenSpend(initPin, "spend")));
      })
      .finally(() => setLoading(false));
  }, [produto.metaAdIds, produto.pinterestAdIds]);

  const toggleMeta = (id) =>
    setSelMeta((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const togglePin = (id) =>
    setSelPin((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const investPreview = [
    ...meta.filter((m) => selMeta.has(m.id)).map((m) => m.valorUsado || 0),
    ...pins.filter((p) => selPin.has(p.id)).map((p) => p.spend || 0),
  ].reduce((a, b) => a + b, 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveAdLink(produto.id, { metaAdIds: [...selMeta], pinterestAdIds: [...selPin] });
      onSaved();
      onClose();
    } catch (e) {
      alert("Erro ao salvar: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Vincular anúncios ao produto</h2>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={produto.nome}>
              {produto.nome}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-xs flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Carregando anúncios...
            </div>
          ) : (
            <>
              <AdSection title="Meta Ads" icon={<Target size={11} className="text-blue-500" />} accent="blue" items={meta} selected={selMeta} onToggle={toggleMeta} nameKey="nomeAnuncio" subKey="conjuntoAnuncios" spendKey="valorUsado" clicksKey="resultados" />
              <AdSection title="Pinterest Ads" icon={<TrendingUp size={11} className="text-red-500" />} accent="red" items={pins} selected={selPin} onToggle={togglePin} nameKey="adName" subKey="date" spendKey="spend" clicksKey="pinClicks" />
            </>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50 rounded-b-xl">
          <div className="text-xs text-gray-500 text-center sm:text-left">
            Investimento selecionado:{" "}
            <span className="font-semibold text-gray-800">
              {investPreview.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
          <div className="flex gap-2 justify-center sm:justify-end w-full sm:w-auto">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-100">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {saving ? "Salvando..." : "Salvar vínculo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdSection({ title, icon, accent, items, selected, onToggle, nameKey, subKey, spendKey, clicksKey }) {
  const border = accent === "blue" ? "border-blue-300 bg-blue-50/60" : "border-red-300 bg-red-50/60";
  const hover = accent === "blue" ? "accent-blue-600" : "accent-red-500";

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2 flex items-center gap-1.5">
        {icon} {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum anúncio importado.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <label
              key={item.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                selected.has(item.id) ? border : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} className={hover} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-800 truncate">{item[nameKey]}</div>
                {item[subKey] && <div className="text-[10px] text-gray-400 truncate">{item[subKey]}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-semibold text-gray-700">
                  {(item[spendKey] || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </div>
                <div className="text-[10px] text-gray-400">{(item[clicksKey] || 0).toLocaleString("pt-BR")} cliques</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link2, Search } from "lucide-react";
import { fmt } from "../../../utils/formatters";
import GeneratedLinksPanel from "../powersuite/components/GeneratedLinksPanel";
import ShortLinkModal from "../powersuite/components/ShortLinkModal";
import SuperComissoesTabs from "../powersuite/components/SuperComissoesTabs";
import { usePowersuiteStore } from "../powersuite/usePowersuiteStore";
import { saveGeneratedLink, listGeneratedLinks } from "../repositories/powersuiteLinksRepository";
import {
  generateTrackedShortLink,
  pctFromRate,
  searchSuperComissoes,
  shopTypeLabel,
} from "../powersuite/powersuiteApi";

export default function SuperComissoesPage() {
  const { apiConfig, searchParams, update } = usePowersuiteStore();
  const [activeTab, setActiveTab] = useState("ofertas");
  const [linksCount, setLinksCount] = useState(0);
  const [linksRefreshKey, setLinksRefreshKey] = useState(0);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [toast, setToast] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState(null);
  const [subIds, setSubIds] = useState(["vitrine", "achadinho", "", "", ""]);
  const [generatedLink, setGeneratedLink] = useState("");
  const [generatingLink, setGeneratingLink] = useState(false);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const refreshLinksCount = useCallback(async () => {
    try {
      const rows = await listGeneratedLinks();
      setLinksCount(rows.length);
    } catch {
      setLinksCount(0);
    }
  }, []);

  useEffect(() => {
    refreshLinksCount();
  }, [refreshLinksCount, linksRefreshKey]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setErro("");
    try {
      const list = await searchSuperComissoes({ searchParams, apiConfig });
      setProducts(list);
      notify(`${list.length} produto(s) encontrado(s).`);
    } catch (err) {
      setErro(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const openLinkModal = (product) => {
    setActiveProduct(product);
    setGeneratedLink("");
    setModalOpen(true);
  };

  const handleGenerateLink = async () => {
    if (!activeProduct) return;
    setGeneratingLink(true);
    try {
      const link = await generateTrackedShortLink({
        originUrl: activeProduct.productLink || activeProduct.offerLink,
        subIds,
        apiConfig,
      });
      setGeneratedLink(link);
      const cleanSubIds = subIds.map((s) => String(s).trim()).filter(Boolean);
      try {
        await saveGeneratedLink({
          itemId: activeProduct.itemId,
          productName: activeProduct.productName,
          imageUrl: activeProduct.imageUrl,
          originUrl: activeProduct.productLink || activeProduct.offerLink,
          shortLink: link,
          subIds: cleanSubIds,
          commission: activeProduct.commission,
          commissionRate: activeProduct.commissionRate,
          shopName: activeProduct.shopName,
        });
        setLinksRefreshKey((k) => k + 1);
        notify("Link gerado e salvo em Meus links!");
      } catch {
        notify("Link gerado! (não foi possível salvar no histórico)");
      }
    } catch (err) {
      notify(err?.message || "Falha ao gerar link");
    } finally {
      setGeneratingLink(false);
    }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed bottom-4 right-4 z-40 bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <SuperComissoesTabs
        activeTab={activeTab}
        onChange={setActiveTab}
        linksCount={linksCount}
      />

      {activeTab === "links" && (
        <GeneratedLinksPanel refreshKey={linksRefreshKey} onNotify={notify} />
      )}

      {activeTab === "ofertas" && (
      <>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={searchParams.keyword}
                onChange={(e) => update({ searchParams: { ...searchParams, keyword: e.target.value } })}
                placeholder="Nicho: celular, fone, panela, legging…"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl text-sm"
            >
              {loading ? "Buscando…" : "Filtrar comissões"}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-slate-100">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Ordenação</label>
              <select
                value={searchParams.sortType}
                onChange={(e) => update({ searchParams: { ...searchParams, sortType: e.target.value } })}
                className="w-full mt-1 rounded-lg border border-slate-200 py-2 px-2 text-xs"
              >
                <option value="5">Maior comissão</option>
                <option value="2">Mais vendidos</option>
                <option value="1">Relevância</option>
                <option value="4">Menor preço</option>
                <option value="3">Maior preço</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">
                Comissão mín. {searchParams.minCommission}%
              </label>
              <input
                type="range"
                min="1"
                max="30"
                value={searchParams.minCommission}
                onChange={(e) => update({ searchParams: { ...searchParams, minCommission: Number(e.target.value) } })}
                className="w-full mt-2 accent-orange-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Tipo de loja</label>
              <div className="flex flex-wrap gap-1 mt-2">
                {[
                  { key: "mall", label: "Mall" },
                  { key: "starPlus", label: "Star+" },
                  { key: "star", label: "Star" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update({
                      searchParams: {
                        ...searchParams,
                        shopType: { ...searchParams.shopType, [key]: !searchParams.shopType[key] },
                      },
                    })}
                    className={`text-[10px] font-bold px-2 py-1 rounded border ${
                      searchParams.shopType[key]
                        ? "bg-orange-50 border-orange-200 text-orange-700"
                        : "bg-slate-50 border-slate-200 text-slate-400"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={searchParams.isAMSOffer}
                  onChange={(e) => update({ searchParams: { ...searchParams, isAMSOffer: e.target.checked } })}
                  className="rounded text-orange-500"
                />
                Comissão extra AMS
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={searchParams.isKeySeller}
                  onChange={(e) => update({ searchParams: { ...searchParams, isKeySeller: e.target.checked } })}
                  className="rounded text-orange-500"
                />
                Apenas Key Sellers
              </label>
            </div>
          </div>
        </form>
      </div>

      {erro && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">{erro}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
          <div>
            <h3 className="font-bold text-sm text-slate-900">Resultados</h3>
            <p className="text-xs text-slate-500">Gere links rastreados com SubIDs para divulgação</p>
          </div>
          <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full">
            {products.length} itens
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-100">
              <tr>
                <th className="p-3">Produto</th>
                <th className="p-3 text-center">Loja</th>
                <th className="p-3 text-right">Preço</th>
                <th className="p-3 text-center">Comissão</th>
                <th className="p-3 text-right">Est. R$</th>
                <th className="p-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-slate-400 text-sm">
                    Execute uma busca para listar ofertas com alta comissão.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                    <tr key={product.itemId} className="hover:bg-slate-50/80">
                      <td className="p-3 min-w-[240px]">
                        <div className="flex gap-2 items-center">
                          {product.imageUrl && (
                            <img src={product.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border" referrerPolicy="no-referrer" />
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 line-clamp-1">{product.productName}</p>
                            <p className="text-[10px] text-slate-400">★ {product.ratingStar} · {product.sales}+ vendas</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className="text-[9px] font-bold bg-slate-100 px-1.5 py-0.5 rounded">{shopTypeLabel(product.shopType)}</span>
                        <p className="text-[9px] text-slate-500 mt-0.5 truncate max-w-[100px]">{product.shopName}</p>
                      </td>
                      <td className="p-3 text-right font-semibold">{fmt(product.priceMin)}</td>
                      <td className="p-3 text-center font-bold text-orange-600">{pctFromRate(product.commissionRate)}%</td>
                      <td className="p-3 text-right font-bold text-emerald-600">{fmt(product.commission)}</td>
                      <td className="p-3">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => openLinkModal(product)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 text-[11px] font-bold"
                            title="Gerar link curto"
                          >
                            <Link2 size={14} />
                            Link
                          </button>
                        </div>
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      <ShortLinkModal
        open={modalOpen}
        product={activeProduct}
        subIds={subIds}
        onSubIdsChange={setSubIds}
        onClose={() => setModalOpen(false)}
        onGenerate={handleGenerateLink}
        generating={generatingLink}
        generatedLink={generatedLink}
        onCopy={(text) => {
          navigator.clipboard.writeText(text);
          notify("Link copiado!");
        }}
      />
    </div>
  );
}

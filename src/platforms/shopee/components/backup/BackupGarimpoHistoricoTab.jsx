import { useEffect, useMemo, useState } from "react";
import { Gem, Search, TrendingUp } from "lucide-react";
import { getGarimpoInteligenteHistorico } from "../../repositories/garimpoRepository";
import { adicionarBackupAoGrupo, salvarBackupComGrupo } from "../../repositories/backupRepository";
import GarimpoProdutoCard from "./GarimpoProdutoCard";

export default function BackupGarimpoHistoricoTab({ showToast }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [dataSnapshot, setDataSnapshot] = useState(null);
  const [jaVendo, setJaVendo] = useState([]);
  const [descoberta, setDescoberta] = useState([]);
  const [aba, setAba] = useState("portfolio");
  const [busca, setBusca] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);
  const [copiadoId, setCopiadoId] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getGarimpoInteligenteHistorico(300);
        if (cancel) return;
        setDataSnapshot(res.data);
        setJaVendo(res.jaVendo);
        setDescoberta(res.descoberta);
        setErro(null);
      } catch (e) {
        if (!cancel) setErro(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const lista = aba === "portfolio" ? jaVendo : descoberta;

  const filtrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.filter((p) => {
      const nome = String(p.nome || "").toLowerCase();
      const loja = String(p.shop_name || "").toLowerCase();
      return nome.includes(t) || loja.includes(t);
    });
  }, [lista, busca]);

  async function salvarNoBackup(p) {
    setSalvandoId(p.itemId);
    try {
      const produto = {
        itemId: p.itemId,
        shopId: p.shopId,
        nome: p.nome,
        preco: p.preco_min || p.preco || 0,
        comissao_pct: p.comissao_pct,
        vendas_shopee: p.vendas_shopee,
        imagem: p.imagem,
        rating: p.rating,
        loja: p.shop_name,
        linkProduto: p.link_produto,
        linkAfiliado: p.link_afiliado,
        periodoFim: p.periodo_fim,
      };
      const { sugestao } = await salvarBackupComGrupo(produto, {});
      if (sugestao && window.confirm(`Salvo! Adicionar ao grupo "${sugestao.nome}"?`)) {
        await adicionarBackupAoGrupo(sugestao.grupoId, p.itemId);
      }
      showToast?.("Produto salvo no Backup.", "sucesso");
    } catch (e) {
      showToast?.(e?.message || String(e), "erro");
    } finally {
      setSalvandoId(null);
    }
  }

  async function copiarLink(link, id) {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiadoId(id);
    setTimeout(() => setCopiadoId(null), 1500);
  }

  if (loading) {
    return <div className="text-center py-12 text-slate-500 text-sm">Carregando garimpo inteligente…</div>;
  }

  if (erro) {
    return <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">{erro}</div>;
  }

  if (!dataSnapshot) {
    return (
      <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
        Nenhum snapshot de garimpo ainda. O robô roda diariamente às 5h (BRT).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-xs text-violet-900">
        <strong>Garimpo inteligente</strong> cruza ofertas ao vivo da Shopee com seu histórico real de vendas
        (conversionReport). Prioriza o que você já provou que vende.
        {dataSnapshot && <span className="text-violet-600 ml-1">Snapshot: {dataSnapshot}</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-[10px] text-slate-400 font-bold uppercase">Seu portfólio</div>
          <div className="text-xl font-extrabold text-orange-600">{jaVendo.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-[10px] text-slate-400 font-bold uppercase">Descobrir</div>
          <div className="text-xl font-extrabold text-blue-600">{descoberta.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 col-span-2 sm:col-span-1">
          <div className="text-[10px] text-slate-400 font-bold uppercase">Filtrados</div>
          <div className="text-xl font-extrabold text-slate-800">{filtrada.length}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto ou loja..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold"
          />
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setAba("portfolio")}
            className={`flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 ${
              aba === "portfolio" ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            <TrendingUp size={13} />
            Portfólio
          </button>
          <button
            type="button"
            onClick={() => setAba("descoberta")}
            className={`flex-1 sm:flex-none px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 ${
              aba === "descoberta" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            <Gem size={13} />
            Descobrir
          </button>
        </div>
      </div>

      {filtrada.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">Nenhum produto neste filtro.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtrada.map((p) => (
            <GarimpoProdutoCard
              key={p.id || p.itemId}
              produto={p}
              salvandoId={salvandoId}
              copiadoId={copiadoId}
              onSalvarBackup={salvarNoBackup}
              onCopiarLink={copiarLink}
            />
          ))}
        </div>
      )}
    </div>
  );
}

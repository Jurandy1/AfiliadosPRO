import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { getRadarRecompraEnriquecido } from "../../repositories/garimpoRepository";
import { adicionarBackupAoGrupo, salvarBackupComGrupo } from "../../repositories/backupRepository";
import GarimpoProdutoCard from "./GarimpoProdutoCard";

export default function BackupRadarRecompraTab({ showToast }) {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [dataSnapshot, setDataSnapshot] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);
  const [copiadoId, setCopiadoId] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getRadarRecompraEnriquecido(40);
        if (cancel) return;
        setDataSnapshot(res.data);
        setProdutos(res.produtos);
        setErro(null);
      } catch (e) {
        if (!cancel) setErro(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return produtos;
    return produtos.filter((p) => {
      const nome = String(p.nome || "").toLowerCase();
      const loja = String(p.shop_name || p.loja || "").toLowerCase();
      return nome.includes(t) || loja.includes(t);
    });
  }, [produtos, busca]);

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
        loja: p.shop_name || p.loja,
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
    return <div className="text-center py-12 text-slate-500 text-sm">Carregando radar de recompra…</div>;
  }

  if (erro) {
    return <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">{erro}</div>;
  }

  if (!dataSnapshot || produtos.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500 space-y-2">
        <RefreshCw size={28} className="mx-auto text-slate-300" />
        <p>Radar de recompra ainda vazio.</p>
        <p className="text-xs text-slate-400">Atualizado semanalmente (segunda 4h) com seus top produtos históricos + comissão atual.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-900">
        <strong>Radar de recompra</strong> — produtos que você já vendeu bem e que ainda têm oferta ativa na Shopee.
        Ideal para reativar tráfego ou adicionar como rota de backup.
        <span className="text-emerald-700 ml-1">Atualizado: {dataSnapshot}</span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar no radar..."
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtrados.map((p) => (
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
    </div>
  );
}

import { Archive, Check, Copy, ExternalLink, TrendingUp } from "lucide-react";
import { fmt, fmtNum } from "../../../../utils/formatters";
import { diasRestantesPeriodo } from "../../repositories/garimpoRepository";

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export default function GarimpoProdutoCard({
  produto,
  salvandoId,
  copiadoId,
  onSalvarBackup,
  onCopiarLink,
  showHistorico = true,
  badgeExtra,
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm hover:border-slate-300 transition-colors">
      <div className="flex gap-3">
        {produto.imagem && (
          <img src={produto.imagem} alt="" className="w-14 h-14 rounded-xl object-cover border border-slate-100 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {produto.ja_vendi && (
              <span className="bg-orange-100 text-orange-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded">
                JÁ VENDEU
              </span>
            )}
            {badgeExtra}
            {produto.score_historico != null && (
              <span className="bg-violet-100 text-violet-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded">
                Score {produto.score_historico}
              </span>
            )}
            {produto.comissao_subiu && (
              <span className="bg-emerald-100 text-emerald-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded">
                COMISSÃO SUBIU
              </span>
            )}
          </div>
          <div className="font-bold text-slate-900 text-sm mt-1 line-clamp-2">{produto.nome}</div>
          <div className="text-[11px] text-slate-500 font-semibold mt-0.5">{produto.shop_name || produto.loja}</div>
          <div className="flex flex-wrap gap-2 mt-2 text-[11px] font-bold">
            <span className="text-emerald-700">{Number(produto.comissao_pct || 0).toFixed(1)}%</span>
            <span className="text-slate-400">·</span>
            <span>{fmtMoney(produto.comissao_valor || produto.comissao_total)}</span>
            <span className="text-slate-400">·</span>
            <span>{fmt(produto.preco_min || produto.preco || 0)}</span>
          </div>
          {showHistorico && (produto.minhas_vendas > 0 || produto.minha_comissao_historica > 0) && (
            <div className="text-[10px] text-blue-700 font-semibold mt-1 flex items-center gap-1">
              <TrendingUp size={11} />
              Suas vendas: {fmtNum(produto.minhas_vendas)} · Hist: {fmtMoney(produto.minha_comissao_historica)}
            </div>
          )}
          {produto.taxa_cancelamento >= 0.2 && (
            <div className="text-[10px] text-rose-600 font-bold mt-1">
              Taxa cancelamento {(produto.taxa_cancelamento * 100).toFixed(0)}%
            </div>
          )}
          {(() => {
            const dias = diasRestantesPeriodo(produto.periodo_fim);
            if (dias == null) return null;
            const critico = dias < 7;
            const texto = dias < 0 ? "Período encerrado" : `Termina em ${dias}d`;
            return (
              <div className={`text-[10px] mt-1 font-semibold ${critico ? "text-rose-600" : "text-slate-400"}`}>
                {texto}
              </div>
            );
          })()}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-slate-100">
        <button
          type="button"
          disabled={salvandoId === produto.itemId}
          onClick={() => onSalvarBackup(produto)}
          className="px-2.5 py-1.5 text-[10px] font-bold bg-violet-100 text-violet-800 rounded-lg flex items-center gap-1"
        >
          <Archive size={11} />
          {salvandoId === produto.itemId ? "…" : "Backup"}
        </button>
        <button
          type="button"
          onClick={() => onCopiarLink(produto.link_afiliado || produto.linkAfiliado, produto.itemId)}
          className={`px-2.5 py-1.5 text-[10px] font-bold rounded-lg flex items-center gap-1 ${
            copiadoId === produto.itemId ? "bg-emerald-600 text-white" : "bg-orange-500 text-white"
          }`}
        >
          {copiadoId === produto.itemId ? <Check size={11} /> : <Copy size={11} />}
          Copiar
        </button>
        {(produto.link_afiliado || produto.linkAfiliado) && (
          <a
            href={produto.link_afiliado || produto.linkAfiliado}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-lg flex items-center gap-1"
          >
            <ExternalLink size={11} />
            Abrir
          </a>
        )}
      </div>
    </div>
  );
}

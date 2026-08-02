import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FolderOpen, Trash2, X } from "lucide-react";
import { fmt, fmtPrecoRange, temFaixaPreco } from "../../../../utils/formatters";

function DeltaBadge({ mudou, label }) {
  if (!mudou) {
    return <span className="text-[10px] font-semibold text-slate-400">{label}</span>;
  }
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
      {label}
    </span>
  );
}

export default function BackupRefreshReportDialog({
  open,
  rows = [],
  onClose,
  onRemoverItem,
  onIrAoGrupo,
}) {
  const [busyId, setBusyId] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(() => new Set());

  useEffect(() => {
    if (open) setHiddenIds(new Set());
  }, [open, rows]);

  if (!open) return null;

  const lista = (Array.isArray(rows) ? rows : []).filter((r) => !hiddenIds.has(String(r.itemId)));
  const mudaram = lista.filter((r) => r.mudou);
  const okSemMudanca = lista.filter((r) => r.ok && !r.mudou);
  const erros = lista.filter((r) => !r.ok);

  const handleRemover = async (r) => {
    if (!onRemoverItem || !r?.itemId) return;
    setBusyId(String(r.itemId));
    try {
      const removed = await onRemoverItem(r);
      if (removed !== false) {
        setHiddenIds((prev) => new Set([...prev, String(r.itemId)]));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">Relatório da atualização</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {mudaram.length} mudaram · {okSemMudanca.length} iguais · {erros.length} erro(s)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-2">
          {mudaram.length === 0 && erros.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs space-y-2">
              <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
              <p className="font-semibold text-slate-700">Nenhum preço ou comissão mudou nesta rodada.</p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                Isso é normal: a Shopee devolveu os mesmos valores que já estavam salvos
                (cron 3×/dia + varreduras recentes). Só aparece mudança quando a API muda de fato.
              </p>
            </div>
          ) : null}

          {mudaram.map((r) => (
            <div key={`m-${r.itemId}`} className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold text-slate-900 line-clamp-2">{r.nome}</p>
                <div className="flex gap-1 shrink-0">
                  {r.precoMudou ? <DeltaBadge mudou label="Preço" /> : null}
                  {r.comissaoMudou ? <DeltaBadge mudou label="Comissão" /> : null}
                </div>
              </div>
              <div className="mt-2 space-y-1 text-[11px]">
                {r.precoMudou ? (
                  <div className="flex items-center gap-1.5 text-slate-700 flex-wrap">
                    <span className="text-slate-500 w-16 shrink-0">Preço</span>
                    <span className="line-through text-slate-400">
                      {fmtPrecoRange(r.precoAntes, r.precoMinAntes, r.precoMaxAntes)}
                    </span>
                    <ArrowRight size={11} className="text-slate-400" />
                    <span className="font-bold text-orange-700">
                      {fmtPrecoRange(r.precoDepois, r.precoMinDepois, r.precoMaxDepois)}
                    </span>
                    {temFaixaPreco(r.precoMinDepois, r.precoMaxDepois) ? (
                      <span className="text-[9px] text-slate-400 font-semibold">(variantes)</span>
                    ) : null}
                  </div>
                ) : null}
                {r.comissaoMudou ? (
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <span className="text-slate-500 w-16 shrink-0">Comissão</span>
                    <span className="line-through text-slate-400">{Number(r.comissaoAntes).toFixed(1)}%</span>
                    <ArrowRight size={11} className="text-slate-400" />
                    <span className="font-bold text-orange-700">{Number(r.comissaoDepois).toFixed(1)}%</span>
                  </div>
                ) : null}
                {(r.alertas || []).slice(0, 2).map((a, i) => (
                  <p key={i} className="text-amber-800 flex items-start gap-1 mt-1">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    {a.mensagem || a.tipo}
                  </p>
                ))}
              </div>
            </div>
          ))}

          {erros.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-rose-700">
                Fora da API / precisam de atenção ({erros.length})
              </p>
              <p className="text-[10px] text-rose-600/80 -mt-1">
                Em geral saíram do afiliado ou o shopId mudou — remova ou abra o grupo para trocar o link.
              </p>
              {erros.map((r) => (
                <div key={`e-${r.itemId}`} className="border border-rose-200 bg-rose-50/50 rounded-xl p-3">
                  <p className="text-xs font-bold text-rose-800 line-clamp-2">{r.nome || r.itemId}</p>
                  <p className="text-[11px] text-rose-600 mt-1">{r.error || "Falha na atualização"}</p>
                  {r.grupoNome ? (
                    <p className="text-[10px] text-slate-500 mt-1">Grupo: {r.grupoNome}</p>
                  ) : null}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {r.grupoId && onIrAoGrupo ? (
                      <button
                        type="button"
                        onClick={() => onIrAoGrupo(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <FolderOpen size={12} />
                        Ir ao grupo
                      </button>
                    ) : null}
                    {onRemoverItem ? (
                      <button
                        type="button"
                        disabled={busyId === String(r.itemId)}
                        onClick={() => handleRemover(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                        {busyId === String(r.itemId) ? "Removendo…" : "Remover"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {okSemMudanca.length > 0 ? (
            <details className="mt-2">
              <summary className="text-[11px] text-slate-500 cursor-pointer font-semibold">
                Ver {okSemMudanca.length} sem mudança
              </summary>
              <ul className="mt-2 space-y-1">
                {okSemMudanca.map((r) => (
                  <li key={`ok-${r.itemId}`} className="text-[11px] text-slate-500 truncate">
                    {r.nome} — {fmtPrecoRange(
                      r.precoDepois || r.precoAntes,
                      r.precoMinDepois ?? r.precoMinAntes,
                      r.precoMaxDepois ?? r.precoMaxAntes,
                    )} · {Number(r.comissaoDepois || r.comissaoAntes || 0).toFixed(1)}%
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
          >
            Fechar relatório
          </button>
        </div>
      </div>
    </div>
  );
}

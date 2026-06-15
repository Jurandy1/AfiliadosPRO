import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, Search, Trash2 } from "lucide-react";
import { fmt, formatarTempoAtras } from "../../../../utils/formatters";
import {
  deleteGeneratedLink,
  listGeneratedLinks,
} from "../../repositories/powersuiteLinksRepository";
import { pctFromRate } from "../powersuiteApi";

export default function GeneratedLinksPanel({ refreshKey = 0, onNotify }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const rows = await listGeneratedLinks();
      setLinks(rows);
    } catch (err) {
      setErro(err?.message || "Não foi possível carregar os links.");
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLinks();
  }, [loadLinks, refreshKey]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return links;
    return links.filter((row) => {
      const hay = [
        row.productName,
        row.shopName,
        row.shortLink,
        ...(row.subIds || []),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [links, busca]);

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.("Link copiado!");
    } catch {
      onNotify?.("Não foi possível copiar.");
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Remover o link de "${row.productName}"?`)) return;
    setDeletingId(row.id);
    try {
      await deleteGeneratedLink(row.id);
      setLinks((prev) => prev.filter((l) => l.id !== row.id));
      onNotify?.("Link removido.");
    } catch (err) {
      onNotify?.(err?.message || "Falha ao remover.");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por produto, SubID ou link…"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">{erro}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
          <div>
            <h3 className="font-bold text-sm text-slate-900">Links gerados</h3>
            <p className="text-xs text-slate-500">Histórico dos shope.ee criados nesta conta</p>
          </div>
          <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full">
            {filtered.length} {filtered.length === 1 ? "link" : "links"}
          </span>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center text-slate-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            {links.length === 0
              ? "Nenhum link salvo ainda. Gere um na aba Buscar ofertas."
              : "Nenhum link corresponde à busca."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="p-3">Produto</th>
                  <th className="p-3">SubIDs</th>
                  <th className="p-3 text-center">Comissão</th>
                  <th className="p-3">Link</th>
                  <th className="p-3 text-center">Quando</th>
                  <th className="p-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="p-3 min-w-[200px]">
                      <div className="flex gap-2 items-center">
                        {row.imageUrl && (
                          <img
                            src={row.imageUrl}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover border"
                            referrerPolicy="no-referrer"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 line-clamp-2">{row.productName}</p>
                          {row.shopName && (
                            <p className="text-[10px] text-slate-400 truncate">{row.shopName}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {(row.subIds || []).length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          row.subIds.map((sid) => (
                            <span
                              key={sid}
                              className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                            >
                              {sid}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className="font-bold text-orange-600">{pctFromRate(row.commissionRate)}%</span>
                      <p className="text-[10px] text-emerald-600 font-semibold">{fmt(row.commission)}</p>
                    </td>
                    <td className="p-3 max-w-[180px]">
                      <p className="font-mono text-[10px] text-slate-600 truncate" title={row.shortLink}>
                        {row.shortLink}
                      </p>
                    </td>
                    <td className="p-3 text-center text-[10px] text-slate-500 whitespace-nowrap">
                      {formatarTempoAtras(row.createdAt)}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleCopy(row.shortLink)}
                          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                          title="Copiar link"
                        >
                          <Copy size={14} />
                        </button>
                        <a
                          href={row.shortLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                          title="Abrir link"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          disabled={deletingId === row.id}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                          title="Remover"
                        >
                          {deletingId === row.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

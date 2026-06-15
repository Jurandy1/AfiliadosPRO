import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ExternalLink,
  ShieldAlert,
  ShieldX,
  XCircle,
  Clock,
  TrendingDown,
  Search,
  RefreshCw,
  Filter,
} from "lucide-react";
import { getCentralRisco } from "../repositories/riscoRepository";
import {
  obterNotasApiTraduzidas,
  obterTextoOriginalApi,
  traduzirDisplayItemStatus,
  traduzirDisplayItemStatusResumo,
  traduzirItemNotes,
} from "../utils/shopeeApiLabels";
import { paginate } from "../../../utils/pagination";
import PaginationBar from "../../../components/tables/PaginationBar";
import { fmt } from "../../../utils/formatters";

const STORAGE_BACKUP_TAB = "backup_initial_tab";
const RISCO_PAGE_SIZE = 20;

const CATEGORIA_LABEL = {
  cancelamento: "Cancelamentos",
  pendente: "Pendentes",
  comissao_perdida: "Comissão perdida",
  backup: "Backup",
  principal: "Link principal",
  fraud_risk: "Risco de fraude",
};

function MetricChip({ icon: Icon, label, tone = "slate" }) {
  const tones = {
    rose: "bg-rose-100 text-rose-800 border-rose-200",
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    redFlash: "bg-red-600 text-white border-red-700 animate-pulse",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${tones[tone] || tones.slate}`}>
      {Icon && <Icon size={11} />}
      {label}
    </span>
  );
}

function RiscoMetricas({ item }) {
  const m = item.metricas || {};
  const chips = [];

  if (item.fraudStatus === "FRAUD") {
    chips.push(
      <MetricChip key="fraud" icon={ShieldX} tone="redFlash" label="Fraude confirmada (API)" />,
    );
  } else if (item.fraudStatus === "UNVERIFIED") {
    chips.push(
      <MetricChip key="unv" icon={ShieldAlert} tone="amber" label="Não verificado (API)" />,
    );
  }

  if (item.displayItemStatus) {
    chips.push(
      <MetricChip
        key="disp"
        tone="slate"
        label={traduzirDisplayItemStatusResumo(item.displayItemStatus)}
      />,
    );
  }

  if (m.cancelados > 0) {
    chips.push(
      <MetricChip
        key="canc"
        icon={XCircle}
        tone={m.taxa >= 0.35 ? "rose" : "amber"}
        label={`${m.cancelados} cancelado${m.cancelados !== 1 ? "s" : ""}${m.taxa ? ` · ${(m.taxa * 100).toFixed(0)}%` : ""}`}
      />,
    );
  }
  if (m.pendentes > 0) {
    chips.push(
      <MetricChip key="pend" icon={Clock} tone="amber" label={`${m.pendentes} pendente${m.pendentes !== 1 ? "s" : ""}`} />,
    );
  }
  if (m.comissaoPerdida >= 1) {
    chips.push(
      <MetricChip
        key="perd"
        icon={TrendingDown}
        tone="rose"
        label={`R$ ${m.comissaoPerdida.toFixed(2)} perdidos`}
      />,
    );
  }
  if (m.concluidos > 0 && item.categorias?.includes("cancelamento")) {
    chips.push(
      <MetricChip key="ok" label={`${m.concluidos} concluído${m.concluidos !== 1 ? "s" : ""}`} />,
    );
  }

  if (!chips.length) return null;
  return <div className="flex flex-wrap gap-1.5 mt-2">{chips}</div>;
}

export default function CentralRiscoPage({ onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState(null);
  const [dados, setDados] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(1);

  const carregar = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setDados(await getCentralRisco());
      setErro(null);
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const itensFiltrados = useMemo(() => {
    if (!dados?.itens) return [];
    const q = busca.trim().toLowerCase();

    return dados.itens.filter((item) => {
      if (filtro !== "todos" && item.nivel !== filtro) return false;

      if (filtroCategoria !== "todas") {
        const cats = item.categorias || [item.categoria];
        if (filtroCategoria === "multiplo" && cats.length <= 1) return false;
        if (filtroCategoria !== "multiplo" && !cats.includes(filtroCategoria)) return false;
      }

      if (!q) return true;
      const notaPt = traduzirItemNotes(item.itemNotes);
      const hay = [
        item.titulo,
        item.mensagem,
        item.loja,
        item.itemId,
        item.itemNotes,
        notaPt,
        traduzirDisplayItemStatus(item.displayItemStatus),
        item.displayItemStatus,
        ...(item.categorias || []).map((c) => CATEGORIA_LABEL[c] || c),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [dados, filtro, filtroCategoria, busca]);

  const paged = useMemo(
    () => paginate(itensFiltrados, page, RISCO_PAGE_SIZE),
    [itensFiltrados, page],
  );

  useEffect(() => {
    setPage(1);
  }, [filtro, filtroCategoria, busca]);

  function irBackup(grupoId) {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STORAGE_BACKUP_TAB, grupoId ? "grupos" : "listagem");
    }
    onNavigate?.("backup");
  }

  const categoriasDisponiveis = useMemo(() => {
    if (!dados?.itens) return [];
    const set = new Set();
    for (const item of dados.itens) {
      for (const c of item.categorias || [item.categoria]) {
        if (c) set.add(c);
      }
    }
    return [...set];
  }, [dados]);

  return (
    <div className="px-3 sm:px-4 py-2 max-w-6xl mx-auto space-y-4 pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="text-rose-600" size={26} />
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">Central de Risco</h1>
            <p className="text-xs text-slate-500 font-medium">
              Produtos agrupados por item — cancelamentos, fraude API, pendências e backups.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!loading && dados && (
            <p className="text-[11px] text-slate-400 font-medium hidden sm:block">
              Ordenação: fraude · críticos · cancelamentos
            </p>
          )}
          <button
            type="button"
            onClick={() => carregar(true)}
            disabled={loading || refreshing}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </div>

      {!loading && dados && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="surface-card p-3">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Total</div>
            <div className="text-2xl font-extrabold text-slate-900">{dados.total}</div>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 shadow-sm">
            <div className="text-[10px] text-rose-600 font-bold uppercase tracking-wide">Críticos</div>
            <div className="text-2xl font-extrabold text-rose-700">{dados.criticos}</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 shadow-sm">
            <div className="text-[10px] text-amber-700 font-bold uppercase tracking-wide">Avisos</div>
            <div className="text-2xl font-extrabold text-amber-800">{dados.avisos}</div>
          </div>
          <div className="bg-slate-900 text-white rounded-2xl p-3 shadow-sm col-span-2 sm:col-span-1">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Prejuízo est.</div>
            <div className="text-xl sm:text-2xl font-extrabold text-rose-300 tabular-nums">
              {fmt(dados.prejuizoTotal || 0)}
            </div>
            {(dados.prejuizoTotal || 0) <= 0 && dados.total > 0 && (
              <div className="text-[10px] text-slate-500 mt-1 leading-snug">
                Sem comissão cancelada registrada nos produtos em risco.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto, loja, itemId ou nota da API…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Filter size={14} className="text-slate-400" />
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            <option value="todas">Todas categorias</option>
            {categoriasDisponiveis.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_LABEL[c] || c}
              </option>
            ))}
            <option value="multiplo">Múltiplos riscos</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {[
          ["todos", "Todos"],
          ["critico", "Críticos"],
          ["aviso", "Avisos"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFiltro(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filtro === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label}
            {!loading && dados && id !== "todos" && (
              <span className="ml-1 opacity-70">({id === "critico" ? dados.criticos : dados.avisos})</span>
            )}
          </button>
        ))}
        {!loading && itensFiltrados.length > 0 && (
          <span className="text-[11px] text-slate-400 ml-auto">
            {itensFiltrados.length} item{itensFiltrados.length !== 1 ? "s" : ""} neste filtro
          </span>
        )}
      </div>

      {loading && <div className="text-center py-12 text-slate-500 text-sm">Analisando riscos…</div>}
      {erro && <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm">{erro}</div>}

      {!loading && !erro && itensFiltrados.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
          Nenhum risco detectado no momento.
        </div>
      )}

      {!loading && !erro && paged.items.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
            <span className="text-xs font-semibold text-slate-700">Itens em risco</span>
            <span className="text-[11px] text-slate-400">
              Exibindo {(paged.page - 1) * RISCO_PAGE_SIZE + 1}–{Math.min(paged.page * RISCO_PAGE_SIZE, paged.total)} de {paged.total}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {paged.items.map((item, idx) => (
              <div
                key={item.id}
                className={`p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                  item.nivel === "critico" ? "bg-rose-50/40" : "bg-amber-50/20"
                }`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-extrabold ${
                      item.nivel === "critico" ? "bg-rose-600 text-white" : "bg-amber-500 text-white"
                    }`}
                    title="Posição na fila de risco"
                  >
                    {(paged.page - 1) * RISCO_PAGE_SIZE + idx + 1}
                  </div>
                  <AlertTriangle
                    size={18}
                    className={`shrink-0 mt-1 ${item.nivel === "critico" ? "text-rose-600" : "text-amber-600"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase ${
                          item.nivel === "critico" ? "bg-rose-600 text-white" : "bg-amber-500 text-white"
                        }`}
                      >
                        {item.nivel}
                      </span>
                      {(item.categorias?.length > 1 ? item.categorias : [item.categoria]).map((cat) => (
                        <span key={cat} className="text-[9px] font-bold text-slate-500 uppercase">
                          {CATEGORIA_LABEL[cat] || cat}
                        </span>
                      ))}
                    </div>
                    <div className="font-bold text-slate-900 text-sm mt-1 line-clamp-2">{item.titulo}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{item.mensagem}</div>
                    {obterNotasApiTraduzidas(item) && (
                      <div className="mt-2 px-2.5 py-1.5 bg-slate-900/5 border border-slate-200 rounded-lg">
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">
                          O que a Shopee informou
                        </div>
                        <div className="text-[11px] text-slate-800 leading-snug font-medium">
                          {obterNotasApiTraduzidas(item)}
                        </div>
                        {obterTextoOriginalApi(item) && (
                          <details className="mt-1.5 group">
                            <summary className="text-[9px] text-slate-400 cursor-pointer hover:text-slate-600 select-none list-none flex items-center gap-1">
                              <span className="underline decoration-dotted">Ver texto original da API</span>
                            </summary>
                            <p className="mt-1 text-[10px] text-slate-500 leading-snug border-t border-slate-200 pt-1.5">
                              {obterTextoOriginalApi(item)}
                            </p>
                          </details>
                        )}
                      </div>
                    )}
                    <RiscoMetricas item={item} />
                    {item.loja && (
                      <div className="text-[10px] text-slate-400 mt-1.5">
                        {item.loja}
                        {item.itemId ? ` · ID ${item.itemId}` : ""}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0 sm:pt-1">
                  {(item.acao === "backup" || item.acao === "backup_grupo") && onNavigate && (
                    <button
                      type="button"
                      onClick={() => irBackup(item.grupoId)}
                      className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <Archive size={12} />
                      Ver Backup
                    </button>
                  )}
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <ExternalLink size={12} />
                      Abrir
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          <PaginationBar
            page={paged.page}
            totalPages={paged.totalPages}
            total={paged.total}
            pageSize={RISCO_PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

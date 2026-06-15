import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, RefreshCw, Trash2 } from "lucide-react";
import { deleteProduto } from "../repositories/productsRepository";
import { garantirDadosAtualizados } from "../../dashboard/repositories/metricsRepository";
import {
  deveSincronizarShopee,
  getPainelKpisFromSessionCache,
  getShopeeProdutosEnrichedCached,
  invalidateAllPeriodCaches,
  painelCacheEstaCompleto,
  prepararFiltroParaDadosReais,
} from "../../dashboard/services/periodDataCache";
import { filterProdutos, sortProdutos } from "../../../domain/attribution/productFilters";
import { paginate, DEFAULT_PAGE_SIZE } from "../../../utils/pagination";
import { fmt, fmtPct, fmtNum } from "../../../utils/formatters";
import {
  calcularRangeModoAll,
  labelPeriodoAtivo,
  periodoTemFiltro,
  readPeriodoFiltroStorage,
  resolverRangeParaDados,
} from "../../../utils/periodoFiltro";
import { formatDateDisplayPT } from "../../../utils/dates";
import { countUniqueLinkedAds } from "../../../utils/adLinkIds";
import LoadingSpinner from "../../../components/layout/LoadingSpinner";
import SortTh from "../../../components/tables/SortTh";
import PaginationBar from "../../../components/tables/PaginationBar";
import Badge from "../../../components/cards/Badge";
import LinkEditCell from "../components/LinkEditCell";
import AdLinkModal from "../components/AdLinkModal";

const ROI_PERIODO_VAZIO_TOOLTIP =
  "Sem gasto atribuído via SubID no período. Vínculos diretos Meta/Pin (Anúncios) só contam no modo \"Todo período\".";

function readDashboardSettings() {
  try {
    const raw = window.localStorage.getItem("afilia:settings");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      impostoMeta: typeof parsed.impostoMeta === "number" ? parsed.impostoMeta : 0,
      impostoNf: typeof parsed.impostoNf === "number" ? parsed.impostoNf : 0,
    };
  } catch {
    return { impostoMeta: 0, impostoNf: 0 };
  }
}

function linkedAdsCount(p) {
  return countUniqueLinkedAds(p.metaAdIds, p.pinterestAdIds);
}

function produtoRowKey(p, index) {
  return String(p.produto_id || p.id || p.nome || `row-${index}`);
}

export default function ShopeePage() {
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("comissao_concluida");
  const [sortDir, setSortDir] = useState("desc");
  const [linkingProduto, setLinkingProduto] = useState(null);
  const [periodoInfo, setPeriodoInfo] = useState(() => readPeriodoFiltroStorage());
  const [syncMsg, setSyncMsg] = useState(null);
  const lastLoadedRangeRef = useRef(null);

  const refreshPeriodo = useCallback(() => {
    setPeriodoInfo(readPeriodoFiltroStorage());
  }, []);

  useEffect(() => {
    const onPeriodoChange = () => refreshPeriodo();
    window.addEventListener("afilia:periodo-change", onPeriodoChange);
    return () => {
      window.removeEventListener("afilia:periodo-change", onPeriodoChange);
    };
  }, [refreshPeriodo]);

  const load = useCallback(async ({ forceSync = false, bypassCache = false } = {}) => {
    setLoading(true);
    try {
      const { periodoFiltro, rangeCustomApplied } = readPeriodoFiltroStorage();
      const range = resolverRangeParaDados(periodoFiltro, rangeCustomApplied);
      if (!range?.startDate || !range?.endDate) {
        setProdutos([]);
        setSyncMsg(null);
        return;
      }

      const rangeKey = `${range.startDate}|${range.endDate}`;
      const settings = readDashboardSettings();

      if (!forceSync && !bypassCache) {
        const { produtos: cached, _fromCache } = await getShopeeProdutosEnrichedCached(
          range.startDate,
          range.endDate,
          settings,
        );
        if (_fromCache) {
          setProdutos(cached);
          setSyncMsg(null);
          lastLoadedRangeRef.current = rangeKey;
          return;
        }
      }

      const precisaSync = periodoTemFiltro(periodoFiltro) && range.startDate && range.endDate;
      const kpisCached = await getPainelKpisFromSessionCache(range.startDate, range.endDate, settings, {
        bypassCache: forceSync || bypassCache,
      });
      const cacheCompleto = painelCacheEstaCompleto(kpisCached);

      const deveSync = deveSincronizarShopee({
        precisaSync,
        forceSync,
        periodoFiltro,
        cacheCompleto,
      });

      if (deveSync) {
        setSyncMsg("Sincronizando Shopee + Meta com o Dashboard…");
        const sync = await garantirDadosAtualizados(range.startDate, range.endDate, {
          forceAll: forceSync,
        }).catch(() => null);
        if (sync?.metaSync?.result?.gravados > 0) {
          setSyncMsg(
            `Meta diário: ${sync.metaSync.result.gravados} linhas (${sync.metaSync.result.range?.since || "?"} → ${sync.metaSync.result.range?.until || "?"})`,
          );
        } else if (sync?.refreshed) {
          setSyncMsg("Shopee atualizada — produtos/subids alinhados ao período.");
          if (forceSync) invalidateAllPeriodCaches();
        } else {
          setSyncMsg(null);
        }
      } else {
        setSyncMsg(null);
      }

      const { produtos: periodRows } = await getShopeeProdutosEnrichedCached(
        range.startDate,
        range.endDate,
        settings,
        { bypassCache: forceSync || bypassCache || deveSync },
      );
      setProdutos(periodRows);
      lastLoadedRangeRef.current = rangeKey;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { periodoFiltro, rangeCustomApplied } = periodoInfo;
    const range = resolverRangeParaDados(periodoFiltro, rangeCustomApplied);
    const rangeKey = range?.startDate && range?.endDate
      ? `${range.startDate}|${range.endDate}`
      : null;
    if (rangeKey && rangeKey === lastLoadedRangeRef.current) {
      return;
    }
    load({ forceSync: false });
  }, [load, periodoInfo.periodoFiltro, periodoInfo.rangeCustomApplied.start, periodoInfo.rangeCustomApplied.end]);

  const handleRefresh = useCallback(() => {
    prepararFiltroParaDadosReais();
    lastLoadedRangeRef.current = null;
    load({ forceSync: true, bypassCache: true });
  }, [load]);

  const handleDelete = async (id, nome) => {
    if (!confirm(`Remover "${nome}"?`)) return;
    await deleteProduto(id);
    invalidateAllPeriodCaches();
    lastLoadedRangeRef.current = null;
    load({ forceSync: false, bypassCache: true });
  };

  const filteredSorted = useMemo(() => {
    let list = produtos.filter((p) => !search || (p.nome || "").toLowerCase().includes(search.toLowerCase()));
    list = filterProdutos(list, { statusFilter, roiFilter: "all", origemFilter: "all" });
    return sortProdutos(list, sortField, sortDir);
  }, [produtos, search, statusFilter, sortField, sortDir]);

  const paged = useMemo(() => paginate(filteredSorted, page, DEFAULT_PAGE_SIZE), [filteredSorted, page]);

  useEffect(() => { setPage(1); }, [search, statusFilter, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const periodoLabel = labelPeriodoAtivo(periodoInfo.periodoFiltro, periodoInfo.rangeCustomApplied);
  const filtroAtivo = periodoTemFiltro(periodoInfo.periodoFiltro);
  const rangeTodoPeriodo = calcularRangeModoAll();
  const labelTodoPeriodo = `${formatDateDisplayPT(rangeTodoPeriodo.startDate)} – ${formatDateDisplayPT(rangeTodoPeriodo.endDate)}`;

  if (loading) return <LoadingSpinner label="Carregando..." className="py-8" />;

  return (
    <>
      {filtroAtivo && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-start gap-2">
          <BarChart3 size={16} className="shrink-0 mt-0.5" />
          <span>
          Mesmas fontes do Dashboard: <strong>shopee_daily</strong> + <strong>subid_daily</strong> + <strong>produto_daily</strong>
          {periodoLabel.includes("→") ? " · " : ": "}
          <strong>{formatDateDisplayPT(periodoLabel.split(" → ")[0])}</strong>
          {periodoLabel.includes("→") && (
            <> até <strong>{formatDateDisplayPT(periodoLabel.split(" → ")[1])}</strong></>
          )}
          {" "}(<span className="font-mono text-xs">{periodoLabel}</span>).
          Meses calibrados usam totais do app Shopee; SubID/Ranking/Produtos escalam no mesmo dia.
          {syncMsg && <div className="mt-1 text-xs opacity-90">{syncMsg}</div>}
          </span>
        </div>
      )}
      {!filtroAtivo && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-start gap-2">
          <BarChart3 size={16} className="shrink-0 mt-0.5" />
          <span>
          Dashboard em <strong>todo período</strong> — vendas e comissão vêm de <strong>produto_daily</strong> agregado
          (<strong>{labelTodoPeriodo}</strong>), alinhado a <strong>subid_daily</strong> e <strong>meta_ads_daily</strong>.
          Cadastro de produtos só dos IDs que venderam no intervalo.
          </span>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Buscar produto..."
            className="flex-1 min-w-[180px] px-3 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-[11px] border border-gray-200 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="all">Todos status</option>
            <option value="Escalando">Escalando</option>
            <option value="Validando">Validando</option>
            <option value="Pausado">Pausado</option>
          </select>
          <button
            type="button"
            onClick={handleRefresh}
            className="text-xs px-2 py-1 border border-gray-200 rounded-md hover:bg-gray-50 inline-flex items-center gap-1"
          >
            <RefreshCw size={12} />
            Atualizar
          </button>
          <span className="text-xs text-gray-400">{paged.total} produtos</span>
        </div>
        <div className="table-scroll">
          <table className="table-wide min-w-[960px]">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Produto</th>
                <th className="px-2 py-2">Loja</th>
                <SortTh label={filtroAtivo ? "Comissão Est." : "Comissão"} field="comissao_concluida" sortField={sortField} onSort={handleSort} />
                <SortTh label="Cliques" field="cliques" sortField={sortField} onSort={handleSort} />
                <SortTh label="Vendas" field="vendas" sortField={sortField} onSort={handleSort} />
                <th className="px-2 py-2">Conv.</th>
                <SortTh label="ROI" field="roi" sortField={sortField} onSort={handleSort} />
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Origem</th>
                <th className="px-2 py-2" />
                <th className="px-2 py-2">Link</th>
                <th className="px-2 py-2">Anúncios</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Nenhum produto encontrado</td></tr>
              ) : paged.items.map((p, rowIndex) => (
                <tr key={produtoRowKey(p, rowIndex)} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 max-w-[200px] truncate" title={p.nome}>{p.nome}</div>
                  </td>
                  <td className="px-2 py-2 text-center text-gray-500">{p.loja || "—"}</td>
                  <td className="px-2 py-2 text-center">
                    <div className="text-emerald-600 font-semibold">{fmt(p.comissao_concluida)}</div>
                    {(p.comissao_pendente || 0) > 0 && <div className="text-[9px] text-amber-600">+{fmt(p.comissao_pendente)} pend.</div>}
                  </td>
                  <td className="px-2 py-2 text-center">{fmtNum(p.cliques)}</td>
                  <td className="px-2 py-2 text-center">{fmtNum(p.vendas)}</td>
                  <td
                    className="px-2 py-2 text-center text-gray-600"
                    title={!p.cliques && p.fonte === "produto_daily" ? "Conversão requer import diário de cliques Shopee (Tier 2)" : undefined}
                  >
                    {p.cliques ? fmtPct(p.conv_rate) : "—"}
                  </td>
                  <td
                    className="px-2 py-2 text-center font-bold"
                    style={{ color: p.roi >= 1 ? "#16A34A" : p.roi > 0 ? "#2563EB" : "#64748B" }}
                    title={!p.investimento && filtroAtivo ? ROI_PERIODO_VAZIO_TOOLTIP : undefined}
                  >
                    {p.investimento ? fmtPct(p.roi) : "—"}
                  </td>
                  <td className="px-2 py-2 text-center"><Badge text={p.status} /></td>
                  <td className="px-2 py-2 text-center"><Badge text={p.origem} variant="Shopee" /></td>
                  <td className="px-2 py-2 text-center">
                    {!p.fonte?.includes("produto_daily") && (
                      <button type="button" onClick={() => handleDelete(p.id, p.nome)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center"><LinkEditCell produto={p} onSaved={handleRefresh} /></td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setLinkingProduto(p)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        linkedAdsCount(p) > 0
                          ? "border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                          : "border-gray-200 text-gray-400 hover:text-indigo-500 hover:border-indigo-200"
                      }`}
                    >
                      {linkedAdsCount(p) > 0
                        ? `${linkedAdsCount(p)} ads vinculados`
                        : "+ Vincular"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setPage} />
      </div>

      {linkingProduto && (
        <AdLinkModal produto={linkingProduto} onClose={() => setLinkingProduto(null)} onSaved={handleRefresh} />
      )}
    </>
  );
}

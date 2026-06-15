import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import {
  BarChart3,
  Clock,
  DollarSign,
  ShoppingBag,
  Target,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { calcMetaGastoResumo, carregarKPIsDoPeriodo, filterSubIdDailyBreakdown, formatDateBRTYYYYMMDD, garantirDadosAtualizados, getDashboardKPIsByPeriod, getPerdasKpiByPeriod, getProdutosPagina, getShopeeDashboardDataVersion } from "../repositories/metricsRepository";
import {
  calcSubIdFinanceiroMetrics,
  finalizarKpisComissaoDashboard,
  subIdComissaoExibida,
  subIdComissaoParaLucro,
} from "../../../domain/metrics/financeiroMetrics.js";
import {
  fmt,
  fmtNum,
  comissaoPendenteKpiValor,
  comissaoKpiTrendPedidosPendentes,
  comissaoKpiSubTrendSplit,
  enriquecerKpisComTrafego,
  lucroKpiTrendProjetado,
  roiKpiTrendProjetado,
  comissaoProjetadaValor,
  calcTicketPorPedido,
  somarVendasDiretasIndiretasSubIds,
  contarSubIdsComVenda,
  contarSubIdsNoPeriodo,
  formatMetaMensalProgress,
} from "../../../utils/formatters";
import DashboardSkeleton from "../components/DashboardSkeleton";
import { usePageToolbar } from "../../../components/layout/PageToolbarContext";
import KPICard from "../../../components/cards/KPICard";
import EmptyState from "../../../components/cards/EmptyState";
import OperationalAlerts from "../../../components/cards/OperationalAlerts";
import DashboardChartsPanel from "../../../components/dashboard/DashboardChartsPanel";
import StatusPedidosCards from "../../../components/dashboard/StatusPedidosCards";
import {
  PerformanceHeroFinanceiro,
  PerformanceHeroVolume,
} from "../../../components/dashboard/PerformanceHeroBanners";
import {
  SkeletonFinanceiro,
  SkeletonVolume,
  SkeletonPedidosCards,
  SkeletonChart,
} from "../../../components/dashboard/DashboardSkeletons";
import PeriodoFilterBar from "../../../components/filters/PeriodoFilterBar";
import SubIdDesktopFilter from "../components/SubIdDesktopFilter";
import SubIdDailyBreakdownTable from "../components/SubIdDailyBreakdownTable";
import SubIdDesktopTable from "../components/SubIdDesktopTable";
import SubIdDesktopToolbar from "../components/SubIdDesktopToolbar";
import SubIdFilterSheet from "../components/SubIdFilterSheet";
import SubIdMobilePanel from "../components/SubIdMobilePanel";
import {
  readSubIdColumnPrefs,
  subIdColumnStorageKey,
} from "../components/subIdColumns";
import { brtYesterdayYYYYMMDD, formatDateDisplayPT, isDiaRecenteBRT } from "../../../utils/dates";
import { useIsMobile } from "../../../utils/useMediaQuery";
import {
  calcularRangePeriodo,
  labelPeriodoAtivo,
  periodoTemFiltro,
  readInitialPeriodoState,
  resolverRangeParaDados,
  validarRangeCustom,
  writePeriodoFiltroStorage,
} from "../../../utils/periodoFiltro";
import {
  getModoAllPanelCached,
  getPainelPorPeriodoCached,
  invalidateAllPeriodCaches,
  prepararFiltroParaDadosReais,
} from "../services/periodDataCache";
import { registrarModoAllRefresh } from "../cache/modoAllCache";
import { diasInclusivosNoPeriodo } from "../cache/periodoPainelCache";

/** Acima disso não escaneia produto_daily (só ranking por SubID). */
const PRODUTOS_SCAN_MAX_DIAS = 14;

const PRODUTOS_PERIODO_TOP_N = 200;

/** Fallback silencioso, exceto permission-denied (UI dedicada em loadError). */
function softCatch(fallback) {
  return (err) => {
    if (err?.code === "permission-denied" || /insufficient permissions/i.test(String(err?.message || ""))) {
      throw err;
    }
    return fallback;
  };
}

function readDashboardSettings() {
  try {
    const raw = window.localStorage.getItem("afilia:settings");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      roiMinimo:   typeof parsed.roiMinimo   === "number" ? parsed.roiMinimo   : 0.5,
      metaMensal:  typeof parsed.metaMensal  === "number" ? parsed.metaMensal  : 10000,
      impostoMeta: typeof parsed.impostoMeta === "number" ? parsed.impostoMeta : 0,
      impostoNf:   typeof parsed.impostoNf   === "number" ? parsed.impostoNf   : 0,
    };
  } catch {
    return { roiMinimo: 0.5, metaMensal: 10000, impostoMeta: 0, impostoNf: 0 };
  }
}

const THROTTLE_REFRESH_KEY = "ultimo_refresh_periodo_ts";
const THROTTLE_REFRESH_DURACAO_MS = 60_000;

function getThrottleRefreshRestante() {
  try {
    const ultimoTs = parseInt(localStorage.getItem(THROTTLE_REFRESH_KEY) || "0", 10);
    if (!ultimoTs) return 0;
    const passado = Date.now() - ultimoTs;
    const restante = THROTTLE_REFRESH_DURACAO_MS - passado;
    return restante > 0 ? restante : 0;
  } catch {
    return 0;
  }
}

function registrarRefreshPeriodo() {
  try {
    localStorage.setItem(THROTTLE_REFRESH_KEY, String(Date.now()));
  } catch {}
}

function formatDateLocalYYYYMMDD(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function DashboardSection({ title, subtitle, children, className = "" }) {
  return (
    <section className={`dashboard-section ${className}`.trim()}>
      {title ? (
        <div className="pb-2 border-b border-slate-200">
          <h2 className="dashboard-section-heading">{title}</h2>
          {subtitle ? <p className="dashboard-section-desc">{subtitle}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const isMobile = useIsMobile();
  const isMobileRef = useRef(typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState(null);
  const [subSortField, setSubSortField] = useState("comissoes");
  const [subSortDir,   setSubSortDir]   = useState("desc");
  const [onlyLoss,     setOnlyLoss]     = useState(false);
  const [onlyProfit,   setOnlyProfit]   = useState(false);
  const [settings,     setSettings]     = useState(readDashboardSettings);
  const [subSearch,    setSubSearch]    = useState("");
  const [subIdsSelecionados, setSubIdsSelecionados] = useState([]);
  const [subIdFiltroBusca, setSubIdFiltroBusca] = useState("");
  const [loadingSubIds, setLoadingSubIds] = useState(false);
  const [metaGastoResumo, setMetaGastoResumo] = useState(null);
  const [subIdDailyBreakdown, setSubIdDailyBreakdown] = useState([]);
  const [loadingSubIdDaily, setLoadingSubIdDaily] = useState(false);
  const [dailySortField, setDailySortField] = useState("data");
  const [dailySortDir, setDailySortDir] = useState("asc");
  const [subColsOpen,  setSubColsOpen]  = useState(false);
  const [subFilterOpen, setSubFilterOpen] = useState(false);
  const [subCols,      setSubCols]      = useState(() => readSubIdColumnPrefs(
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  ));
  const [prodCursor,   setProdCursor]   = useState({ lastDoc: null, hasMore: false });
  const [periodoFiltro, setPeriodoFiltro] = useState(() => {
    const s = readInitialPeriodoState();
    return s.periodoFiltro;
  });
  const [rangeCustomDraft, setRangeCustomDraft] = useState(() => readInitialPeriodoState().rangeCustomDraft);
  const [rangeCustomApplied, setRangeCustomApplied] = useState(() => readInitialPeriodoState().rangeCustomApplied);
  const [rangeCustomErro, setRangeCustomErro] = useState(null);
  const [atualizandoPeriodo, setAtualizandoPeriodo] = useState(false);
  const [throttleRefreshMs, setThrottleRefreshMs] = useState(0);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const forceSyncRef = useRef(false);
  const forceModoAllRefreshRef = useRef(false);
  const { setToolbar } = usePageToolbar();

  const subColsRef = useRef(subCols);
  subColsRef.current = subCols;

  useEffect(() => {
    if (isMobileRef.current === isMobile) return;
    try {
      window.localStorage.setItem(
        subIdColumnStorageKey(isMobileRef.current),
        JSON.stringify(subColsRef.current),
      );
    } catch {}
    isMobileRef.current = isMobile;
    setSubCols(readSubIdColumnPrefs(isMobile));
    setSubColsOpen(false);
    setSubFilterOpen(false);
  }, [isMobile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(subIdColumnStorageKey(isMobileRef.current), JSON.stringify(subCols));
    } catch {}
  }, [subCols]);

  useEffect(() => {
    const tick = () => setThrottleRefreshMs(getThrottleRefreshRestante());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    writePeriodoFiltroStorage(periodoFiltro, rangeCustomApplied);
  }, [periodoFiltro, rangeCustomApplied]);

  const load = useCallback(async () => {
    const gen = ++loadGenerationRef.current;
    const stale = () => gen !== loadGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    let precisaSync = false;
    try {
      const s = readDashboardSettings();
      if (stale()) return;
      setSettings(s);
      setMetaGastoResumo(null);
      setSubIdDailyBreakdown([]);
      const range = calcularRangePeriodo(periodoFiltro, rangeCustomApplied);
      const filtroAtivo = periodoTemFiltro(periodoFiltro);

      if (periodoFiltro === "all") {
        const forceAllRefresh = forceModoAllRefreshRef.current;
        if (forceAllRefresh) forceModoAllRefreshRef.current = false;

        try {
          const { panelData, _fromCache } = await getModoAllPanelCached(s, {
            bypassCache: forceAllRefresh,
          });
          if (stale()) return;
          setData(panelData);
          setProdCursor(panelData.prodCursor || { lastDoc: null, hasMore: false });
          setMetaGastoResumo(panelData.metaGastoResumo ?? null);
          if (forceAllRefresh && !_fromCache) {
            registrarModoAllRefresh();
          }
        } catch (e) {
          if (!stale()) setLoadError(e);
        } finally {
          if (!stale()) {
            setLoading(false);
            setAtualizandoPeriodo(false);
          }
        }
        return;
      }

      if (filtroAtivo && !range) {
        if (!stale()) {
          setLoadError("Período inválido ou incompleto. Ajuste as datas e clique em Aplicar período.");
          setLoading(false);
          setAtualizandoPeriodo(false);
        }
        return;
      }

      const dataInicioBusca = range?.startDate ?? "2020-01-01";
      const dataFimBusca = range?.endDate ?? "2030-12-31";
      const diasPeriodo = diasInclusivosNoPeriodo(dataInicioBusca, dataFimBusca);
      precisaSync = periodoFiltro !== "all" && range?.startDate && range?.endDate;
      const forceSync = forceSyncRef.current;
      if (forceSync) {
        forceSyncRef.current = false;
        prepararFiltroParaDadosReais();
      }

      if (precisaSync) {
        setAtualizandoPeriodo(true);
      }

      const isDiaUnicoRecente = Boolean(
        range?.startDate
        && range.startDate === range.endDate
        && isDiaRecenteBRT(range.startDate, formatDateBRTYYYYMMDD())
      );

      let kpisFromSumario = null;
      const perdasVazias = { countPerdas: 0, totalFatPerdido: 0, totalComissaoPerdida: 0 };
      let perdas = perdasVazias;
      let produtosPage = filtroAtivo
        ? { produtos: [], lastDoc: null, hasMore: false }
        : await getProdutosPagina(50).catch(softCatch({ produtos: [], lastDoc: null, hasMore: false }));
      let subIdsFiltrados = [];
      let produtosPeriodo = [];
      let painelSource = "granular";

      if (filtroAtivo) {
        const painel = await getPainelPorPeriodoCached(dataInicioBusca, dataFimBusca, s, {
          includeProdutos: diasPeriodo <= PRODUTOS_SCAN_MAX_DIAS,
          bypassCache: forceSync,
        }).catch(softCatch(null));
        if (painel?.kpisFromSumario) {
          kpisFromSumario = painel.kpisFromSumario;
          perdas = painel.perdas || perdasVazias;
          subIdsFiltrados = painel.subIds || [];
          produtosPeriodo = painel.produtosPeriodo || [];
          painelSource = painel._source || (painel._fromCache ? "cache" : "granular");
          setSubIdDailyBreakdown(painel.dailyBreakdown || []);
          setMetaGastoResumo(painel.metaGastoResumo ?? null);
        }
      } else {
        kpisFromSumario = await getDashboardKPIsByPeriod(dataInicioBusca, dataFimBusca, s).catch(softCatch(null));
        perdas = await getPerdasKpiByPeriod(dataInicioBusca, dataFimBusca).catch(softCatch(perdasVazias));
      }

      if (stale()) return;

      const cacheCompleto = Boolean(kpisFromSumario);

      const fimPeriodoRecente = Boolean(
        range?.endDate && isDiaRecenteBRT(range.endDate, formatDateBRTYYYYMMDD()),
      );
      const deveSincronizarShopee = precisaSync && (
        periodoFiltro === "ontem"
        || !cacheCompleto
        || (forceSync && fimPeriodoRecente)
      );

      if (precisaSync && !deveSincronizarShopee && !stale()) {
        setAtualizandoPeriodo(false);
      }

      const dataVersionBeforeSync = precisaSync
        ? await getShopeeDashboardDataVersion().catch(() => 0)
        : null;

      const syncPromise = deveSincronizarShopee
        ? garantirDadosAtualizados(range.startDate, range.endDate, {
          forceAll: forceSync || (range.startDate === range.endDate && isDiaUnicoRecente && !cacheCompleto),
        })
        : null;

      const aplicarPainelPeriodo = () => {
        if (!kpisFromSumario) return null;
        const produtosHistorico = produtosPage?.produtos || [];
        const produtos = filtroAtivo ? [] : produtosHistorico;

        const kpisFinal = finalizarKpisComissaoDashboard({
          comissao: kpisFromSumario.comissao,
          comissaoReal: kpisFromSumario.comissaoReal ?? kpisFromSumario.comissao,
          comissaoEstimada: kpisFromSumario.comissaoEstimada || kpisFromSumario.comissao || 0,
          comissaoConcluida: kpisFromSumario.comissaoConcluida,
          comissaoPendente: kpisFromSumario.comissaoPendente,
          comissaoCancelada: kpisFromSumario.comissaoCancelada || 0,
          pedidosConcluidos: kpisFromSumario.pedidosConcluidos || 0,
          pedidosPendentes: kpisFromSumario.pedidosPendentes || 0,
          pedidosCancelados: kpisFromSumario.pedidosCancelados || 0,
          pedidosNaoPagos: kpisFromSumario.pedidosNaoPagos || 0,
          comissaoNaoPaga: kpisFromSumario.comissaoNaoPaga || 0,
          fatBruto: kpisFromSumario.fatBruto,
          vendas: kpisFromSumario.vendas,
          pedidos: kpisFromSumario.pedidos || 0,
          vendasDiretas: kpisFromSumario.vendasDiretas,
          vendasIndiretas: kpisFromSumario.vendasIndiretas,
          gastoMeta: kpisFromSumario.gastoMeta,
          gastoPin: kpisFromSumario.gastoPin,
          gastoTotal: kpisFromSumario.gastoTotal,
          ticketMedio: kpisFromSumario.ticketMedio,
          historicoDiario: kpisFromSumario.historicoDiario || [],
          splitIndisponivel: Boolean(kpisFromSumario.splitIndisponivel),
          splitPedidoNivel: kpisFromSumario.splitPedidoNivel,
          splitCriterio: kpisFromSumario.splitCriterio,
          aggregationMode: kpisFromSumario.aggregationMode,
          _comissaoModoPromosApp: kpisFromSumario._comissaoModoPromosApp,
          shopeeDataMode: kpisFromSumario.shopeeDataMode || "api_fiel",
          shopeePanelAudit: kpisFromSumario.shopeePanelAudit || null,
        }, s);

        const panelData = {
          kpis: {
            produtosAtivos: filtroAtivo
              ? (produtosPeriodo?.length ?? 0)
              : (kpisFromSumario.produtosCount || produtos.length),
            totalComissao: kpisFinal.comissao,
            comissaoReal: kpisFinal.comissaoReal,
            comissaoEstimada: kpisFinal.comissaoEstimada,
            comissaoConcluida: kpisFinal.comissaoConcluida,
            comissaoPendente: kpisFinal.comissaoPendente,
            splitIndisponivel: Boolean(kpisFinal.splitIndisponivel),
            comissaoCancelada: kpisFinal.comissaoCancelada || 0,
            pedidosConcluidos: kpisFinal.pedidosConcluidos || 0,
            pedidosPendentes: kpisFinal.pedidosPendentes || 0,
            pedidosCancelados: kpisFinal.pedidosCancelados || 0,
            pedidosNaoPagos: kpisFinal.pedidosNaoPagos || 0,
            comissaoNaoPaga: kpisFinal.comissaoNaoPaga || 0,
            faturamentoBruto: kpisFinal.fatBruto,
            totalVendas: kpisFinal.vendas,
            totalPedidos: kpisFinal.pedidos || 0,
            vendasDiretas: kpisFinal.vendasDiretas,
            vendasIndiretas: kpisFinal.vendasIndiretas,
            qtdItens: 0,
            totalCliquesShopee: 0,
            totalCliques: 0,
            totalInvestimento: kpisFinal.gastoTotal,
            lucroEstimado: kpisFinal.lucroProjetado ?? 0,
            lucro: kpisFinal.lucro,
            lucroProjetado: kpisFinal.lucroProjetado,
            roiProjetado: kpisFinal.roiProjetado,
            roasProjetado: kpisFinal.roasProjetado,
            roas: kpisFinal.roas,
            roiGeral: kpisFinal.roi,
            convRate: 0,
            cpcReal: 0,
            ticketMedio: kpisFinal.ticketMedio,
            impostoTotal: kpisFinal.impostoTotal || 0,
            metaTotalGasto: kpisFinal.gastoMeta,
            metaTotalCliques: 0,
            metaTotalImpressoes: 0,
            pinTotalGasto: kpisFinal.gastoPin,
            pinTotalCliques: 0,
            roiMedio: 0,
            lastUpdated: kpisFromSumario.lastUpdated,
            shopeeDataMode: kpisFinal.shopeeDataMode || "api_fiel",
            shopeePanelAudit: kpisFinal.shopeePanelAudit || null,
            splitPedidoNivel: kpisFinal.splitPedidoNivel,
            splitCriterio: kpisFinal.splitCriterio,
          },
          statusCount: { Escalando: 0, Validando: 0, Pausado: 0 },
          produtos,
          subIds: subIdsFiltrados,
          subIdDiagnostics: { totalRows: subIdsFiltrados.length, isReliable: true, source: painelSource },
          operationalAlerts: [],
          chartData: kpisFinal.historicoDiario || [],
          perdas,
        };

        setData(panelData);
        setProdCursor({
          lastDoc: filtroAtivo ? null : (produtosPage?.lastDoc || null),
          hasMore: filtroAtivo ? false : !!produtosPage?.hasMore,
        });
        return panelData;
      };

      const processarSyncEmBackground = async (sync) => {
        if (stale()) return;

        const deveRecarregar = sync && (
          sync.refreshed
          || sync.apiComDadosSemFirestore
          || sync.forced
          || sync.backgroundOnly
          || (sync.stale?.length > 0 && !sync.throttled)
          || (isDiaUnicoRecente && !sync.throttled)
        );

        if (deveRecarregar) {
          if (stale()) return;

          const versionAfterSync = await getShopeeDashboardDataVersion().catch(() => 0);
          const dadosMudaram = sync?.apiComDadosSemFirestore
            || dataVersionBeforeSync == null
            || versionAfterSync > dataVersionBeforeSync;

          if (!dadosMudaram) {
            if (!stale()) setAtualizandoPeriodo(false);
            return;
          }

          invalidateAllPeriodCaches();

          if (filtroAtivo) {
            const painel = await getPainelPorPeriodoCached(dataInicioBusca, dataFimBusca, s, {
              includeProdutos: diasPeriodo <= PRODUTOS_SCAN_MAX_DIAS,
              bypassCache: true,
            }).catch(softCatch(null));
            if (stale()) return;
            if (painel?.kpisFromSumario) {
              kpisFromSumario = painel.kpisFromSumario;
              perdas = painel.perdas || perdasVazias;
              subIdsFiltrados = painel.subIds || [];
              produtosPeriodo = painel.produtosPeriodo || [];
              painelSource = painel._source || "granular";
              setSubIdDailyBreakdown(painel.dailyBreakdown || []);
              setMetaGastoResumo(painel.metaGastoResumo ?? null);
            }
          } else {
            const aguardarFirestorePosSync = range.startDate === range.endDate
              && (!cacheCompleto || sync?.apiComDadosSemFirestore)
              && !sync?.semVendasNaApi;
            const kpisAtualizados = await carregarKPIsDoPeriodo(dataInicioBusca, dataFimBusca, {
              afterSync: aguardarFirestorePosSync,
              maxWaitMs: aguardarFirestorePosSync
                ? ((periodoFiltro === "ontem" || isDiaUnicoRecente || forceSync) ? 15000 : 10000)
                : 0,
              settings: s,
            }).catch(softCatch(null));
            if (stale()) return;
            if (kpisAtualizados) kpisFromSumario = kpisAtualizados;
            const perdasNovas = await getPerdasKpiByPeriod(dataInicioBusca, dataFimBusca).catch(softCatch(null));
            if (perdasNovas) perdas = perdasNovas;
          }
          if (stale()) return;
        }

        if (!stale() && kpisFromSumario) {
          aplicarPainelPeriodo();
        }
        if (!stale()) setAtualizandoPeriodo(false);
      };

      if (syncPromise) {
        syncPromise
          .then((sync) => processarSyncEmBackground(sync))
          .catch(() => {
            if (!stale()) {
              setAtualizandoPeriodo(false);
            }
          });
      }

      if (!kpisFromSumario) {
        if (filtroAtivo) {
          if (!stale()) {
            setLoadError("Sem dados Shopee para este período. Aguarde a sincronização ou force refresh.");
          }
        } else {
          const { panelData } = await getModoAllPanelCached(s, { bypassCache: true });
          if (stale()) return;
          setData(panelData);
          setProdCursor(panelData.prodCursor || { lastDoc: null, hasMore: false });
          setMetaGastoResumo(panelData.metaGastoResumo ?? null);
        }
        return;
      }

      if (kpisFromSumario) {
        aplicarPainelPeriodo();
      }

    } catch (e) {
      if (!stale()) setLoadError(e);
    } finally {
      if (!stale()) {
        setLoading(false);
        // Sync segue em background; filtros de período nunca ficam bloqueados.
        setAtualizandoPeriodo(false);
      }
    }
  }, [periodoFiltro, rangeCustomApplied]);

  const cancelarLoadEmAndamento = useCallback(() => {
    loadGenerationRef.current += 1;
    setAtualizandoPeriodo(false);
  }, []);

  const aplicarFiltroCustom = useCallback(() => {
    const v = validarRangeCustom(rangeCustomDraft.start, rangeCustomDraft.end);
    if (!v.ok) {
      setRangeCustomErro(v.erro);
      return;
    }
    cancelarLoadEmAndamento();
    setRangeCustomErro(null);
    setRangeCustomApplied({ start: v.start, end: v.end });
    setRangeCustomDraft({ start: v.start, end: v.end });
    forceSyncRef.current = true;
    prepararFiltroParaDadosReais();
    registrarRefreshPeriodo();
    setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
    setPeriodoFiltro("custom");
  }, [rangeCustomDraft, cancelarLoadEmAndamento]);

  const handlePresetPeriodo = useCallback((id) => {
    cancelarLoadEmAndamento();
    if (id !== "all" && id !== "ontem") {
      registrarRefreshPeriodo();
      setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
    }
    setPeriodoFiltro(id);
    if (id !== "custom") {
      setRangeCustomDraft({ start: "", end: "" });
      setRangeCustomApplied({ start: "", end: "" });
      setRangeCustomErro(null);
    }
  }, [cancelarLoadEmAndamento]);

  const customDraftPendente = periodoFiltro !== "custom"
    || rangeCustomDraft.start !== rangeCustomApplied.start
    || rangeCustomDraft.end !== rangeCustomApplied.end;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    load();
    return () => { loadGenerationRef.current += 1; };
  }, [load]);

  const kpis              = useMemo(
    () => (data?.kpis ? enriquecerKpisComTrafego(data.kpis, data?.subIds) : undefined),
    [data?.kpis, data?.subIds],
  );
  const subIds            = data?.subIds;

  /** KPIs de volume alinhados à soma SubID (bate com TOTAL da tabela). */
  const kpisVolume = useMemo(() => {
    if (!kpis) return undefined;
    if (!subIds?.length) return kpis;
    const { vendasDiretas, vendasIndiretas } = somarVendasDiretasIndiretasSubIds(subIds);
    return { ...kpis, vendasDiretas, vendasIndiretas };
  }, [kpis, subIds]);

  const subIdsComVenda = useMemo(() => contarSubIdsComVenda(subIds), [subIds]);
  const subIdsNoPeriodo = useMemo(() => contarSubIdsNoPeriodo(subIds), [subIds]);
  const chartData         = data?.chartData || [];
  const subIdDiagnostics  = data?.subIdDiagnostics;
  const operationalAlerts = data?.operationalAlerts || [];

  const subIdDailyFiltered = useMemo(() => {
    if (subIdsSelecionados.length > 0) {
      return filterSubIdDailyBreakdown(subIdDailyBreakdown, subIdsSelecionados, settings);
    }
    return (subIdDailyBreakdown || []).map(({ _bySubId, ...row }) => row);
  }, [subIdDailyBreakdown, subIdsSelecionados, settings]);

  const subIdDailySorted = useMemo(() => {
    const chrono = [...subIdDailyFiltered].sort((a, b) => a.data.localeCompare(b.data));
    const prevLucroByDate = new Map();
    for (let i = 1; i < chrono.length; i++) {
      prevLucroByDate.set(chrono[i].data, chrono[i - 1].lucro);
    }

    const rows = subIdDailyFiltered.map((row) => ({
      ...row,
      _prevLucro: prevLucroByDate.get(row.data) ?? null,
    }));

    const dir = dailySortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (dailySortField === "data") {
        return a.data.localeCompare(b.data) * dir;
      }
      const av = a?.[dailySortField] ?? 0;
      const bv = b?.[dailySortField] ?? 0;
      return (bv - av) * dir;
    });
    return rows;
  }, [subIdDailyFiltered, dailySortField, dailySortDir]);

  const handleDailySort = useCallback((field) => {
    if (dailySortField === field) {
      setDailySortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setDailySortField(field);
      setDailySortDir(field === "data" ? "asc" : "desc");
    }
  }, [dailySortField]);

  const subIdDailyTotals = useMemo(() => {
    const totals = subIdDailyFiltered.reduce((acc, r) => {
      acc.comissoes += subIdComissaoExibida(r);
      acc.gasto += r.gasto || 0;
      acc.faturamento += r.faturamento || 0;
      acc.total_vendas += r.total_vendas || 0;
      return acc;
    }, { comissoes: 0, gasto: 0, faturamento: 0, total_vendas: 0 });
    const fin = calcSubIdFinanceiroMetrics(totals.comissoes, totals.gasto);
    return {
      ...totals,
      lucro: fin.lucro,
      roiTotal: fin.roi,
    };
  }, [subIdDailyFiltered]);

  const subIdsFilteredSorted = useMemo(() => {
    const base = [...(subIds || [])];
    let rows = base;
    if (subIdsSelecionados.length > 0) {
      rows = rows.filter((r) => subIdsSelecionados.includes(r.subid || r.id));
    }
    const q = String(subSearch || "").trim().toLowerCase();
    if (q) rows = rows.filter((r) => String(r.subid || "").toLowerCase().includes(q));
    if (onlyLoss && !onlyProfit) rows = rows.filter((r) => (r.lucro || 0) < 0);
    if (onlyProfit && !onlyLoss) rows = rows.filter((r) => (r.lucro || 0) > 0);
    const dir = subSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a?.[subSortField] ?? 0;
      const bv = b?.[subSortField] ?? 0;
      return (bv - av) * dir;
    });
    return rows;
  }, [subIds, onlyLoss, onlyProfit, subSortField, subSortDir, subSearch, subIdsSelecionados]);

  const subIdsTabelaLabel = useMemo(() => {
    const filtrado = Boolean(subSearch || onlyLoss || onlyProfit || subIdsSelecionados.length > 0);
    if (filtrado) {
      return `${fmtNum(subIdsFilteredSorted.length)} de ${fmtNum(subIdsNoPeriodo)} SubIDs (filtro ativo)`;
    }
    return `${fmtNum(subIdsNoPeriodo)} SubIDs no período`;
  }, [
    subIdsFilteredSorted.length,
    subIdsNoPeriodo,
    subSearch,
    onlyLoss,
    onlyProfit,
    subIdsSelecionados.length,
  ]);

  const subIdTableTotals = useMemo(() => {
    const totals = subIdsFilteredSorted.reduce((acc, r) => {
      acc.comissoes += subIdComissaoExibida(r);
      acc.gasto += r.gasto || 0;
      acc.faturamento += r.faturamento || 0;
      acc.total_vendas += r.total_vendas || 0;
      acc.vendas_diretas += r.vendas_diretas || 0;
      acc.vendas_indiretas += r.vendas_indiretas || 0;
      acc.qtd_itens += r.qtd_itens || 0;
      acc.cliques_anuncio += r.cliques_anuncio || 0;
      acc.cliques_shopee += r.cliques_shopee || 0;
      return acc;
    }, {
      comissoes: 0, gasto: 0, faturamento: 0,
      total_vendas: 0, vendas_diretas: 0, vendas_indiretas: 0,
      qtd_itens: 0, cliques_anuncio: 0, cliques_shopee: 0,
    });
    const fin = calcSubIdFinanceiroMetrics(totals.comissoes, totals.gasto);
    return {
      ...totals,
      lucro: fin.lucro,
      roiTotal: fin.roi,
      ticketTotal: totals.total_vendas > 0 ? totals.faturamento / totals.total_vendas : 0,
      batTotal: totals.cliques_anuncio > 0 ? totals.cliques_shopee / totals.cliques_anuncio : 0,
    };
  }, [subIdsFilteredSorted]);

  const renderSubIdRow = useCallback((r) => {
    const roiColor = r.roi >= settings.roiMinimo ? "#16A34A" : r.roi >= 0 ? "#D97706" : "#DC2626";
    const lucroColor = (r.lucro || 0) >= 0 ? "#16A34A" : "#DC2626";
    return (
      <tr key={r.id || r.subid} className="hover:bg-slate-50/70 transition-colors border-b border-slate-100">
        <td className="px-3 py-2.5 font-medium text-slate-900">{r.subid || "—"}</td>
        {subCols.comissoes && <td className="px-2 py-2.5 text-center text-emerald-700 font-semibold">{fmt(subIdComissaoExibida(r))}</td>}
        {subCols.gasto && <td className="px-2 py-2.5 text-center text-slate-700">{fmt(r.gasto)}</td>}
        {subCols.lucro && <td className="px-2 py-2.5 text-center font-semibold" style={{ color: lucroColor }}>{fmt(r.lucro)}</td>}
        {subCols.roi && <td className="px-2 py-2 text-center font-bold" style={{ color: roiColor }}>{r.gasto > 0 ? ((r.roi || 0) * 100).toFixed(2) + "%" : "—"}</td>}
        {subCols.faturamento && <td className="px-2 py-2 text-center">{fmt(r.faturamento)}</td>}
        {subCols.ticket && <td className="px-2 py-2 text-center">{r.ticket_medio > 0 ? fmt(r.ticket_medio) : "—"}</td>}
        {subCols.total_vendas && <td className="px-2 py-2 text-center">{fmtNum(r.total_vendas)}</td>}
        {subCols.vendas_diretas && <td className="px-2 py-2 text-center">{fmtNum(r.vendas_diretas)}</td>}
        {subCols.vendas_indiretas && <td className="px-2 py-2 text-center">{fmtNum(r.vendas_indiretas)}</td>}
        {subCols.qtd_itens && <td className="px-2 py-2 text-center">{fmtNum(r.qtd_itens)}</td>}
        {subCols.cliques_anuncio && <td className="px-2 py-2 text-center">{fmtNum(r.cliques_anuncio)}</td>}
        {subCols.cliques_shopee && <td className="px-2 py-2 text-center">{fmtNum(r.cliques_shopee)}</td>}
        {subCols.batimento && <td className="px-2 py-2 text-center">{r.cliques_anuncio > 0 ? ((r.batimento || 0) * 100).toFixed(2) + "%" : "—"}</td>}
      </tr>
    );
  }, [subCols, settings.roiMinimo]);

  const kpisDosSelecionados = useMemo(() => {
    if (subIdsSelecionados.length === 0) return null;

    const filtrados = (subIds || []).filter((r) => subIdsSelecionados.includes(r.subid || r.id));
    if (filtrados.length === 0) return null;

    const comissao = filtrados.reduce((s, r) => s + subIdComissaoParaLucro(r), 0);
    const faturamento = filtrados.reduce((s, r) => s + (r.faturamento || 0), 0);
    const gasto = filtrados.reduce((s, r) => s + (r.gasto || 0), 0);
    const vendas = filtrados.reduce((s, r) => s + (r.total_vendas || 0), 0);
    const fin = calcSubIdFinanceiroMetrics(comissao, gasto);

    return {
      qtd: filtrados.length,
      comissao: fin.comissao,
      comissaoEstimada: fin.comissao,
      faturamento,
      gasto: fin.gasto,
      lucro: fin.lucro,
      roi: fin.roi,
      roas: fin.roas,
      impostoTotal: fin.impostoTotal,
      vendas,
    };
  }, [subIds, subIdsSelecionados, settings]);

  const todosSubIdsDisponiveis = useMemo(() => {
    const set = new Set();
    (subIds || []).forEach((r) => {
      const sid = r.subid || r.id || "";
      if (sid && sid !== "missing_subid") set.add(sid);
    });
    return [...set].sort();
  }, [subIds]);

  const subIdsParaCheckbox = useMemo(() => {
    const q = subIdFiltroBusca.trim().toLowerCase();
    if (!q) return todosSubIdsDisponiveis;
    return todosSubIdsDisponiveis.filter((s) => s.toLowerCase().includes(q));
  }, [todosSubIdsDisponiveis, subIdFiltroBusca]);

  const filtroPeriodoAtivo = periodoTemFiltro(periodoFiltro);
  const rangeAtivo = useMemo(
    () => resolverRangeParaDados(periodoFiltro, rangeCustomApplied),
    [periodoFiltro, rangeCustomApplied],
  );
  const modoAllCacheLabel = null;
  const periodoToolbar = useMemo(() => (
    <PeriodoFilterBar
      embedded
      periodoFiltro={periodoFiltro}
      modoAllCacheLabel={modoAllCacheLabel}
      rangeDraft={rangeCustomDraft}
      rangeApplied={rangeCustomApplied}
      rangeErro={rangeCustomErro}
      customPendente={customDraftPendente}
      atualizandoPeriodo={atualizandoPeriodo}
      throttleRefreshMs={throttleRefreshMs}
      onPreset={handlePresetPeriodo}
      onDraftChange={(next) => {
        setRangeCustomErro(null);
        setRangeCustomDraft(next);
      }}
      onApplyCustom={aplicarFiltroCustom}
      onClearCustom={() => {
        cancelarLoadEmAndamento();
        setRangeCustomDraft({ start: "", end: "" });
        setRangeCustomApplied({ start: "", end: "" });
        setRangeCustomErro(null);
        setPeriodoFiltro("mes_atual");
      }}
      onRefreshOntem={async () => {
        registrarRefreshPeriodo();
        setThrottleRefreshMs(THROTTLE_REFRESH_DURACAO_MS);
        await load();
      }}
    />
  ), [
    periodoFiltro,
    modoAllCacheLabel,
    rangeCustomDraft,
    rangeCustomApplied,
    rangeCustomErro,
    customDraftPendente,
    atualizandoPeriodo,
    throttleRefreshMs,
    handlePresetPeriodo,
    aplicarFiltroCustom,
    cancelarLoadEmAndamento,
    load,
  ]);

  useEffect(() => {
    setToolbar(periodoToolbar);
    return () => setToolbar(null);
  }, [periodoToolbar, setToolbar]);

  if (loading && !data) {
    return (
      <div className="dashboard-page animate-pulse">
        <div className="h-6 w-1/3 bg-slate-200 rounded mb-4" />
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SkeletonFinanceiro />
            <SkeletonVolume />
          </div>
          <SkeletonPedidosCards />
          <SkeletonChart />
        </section>
      </div>
    );
  }

  if (loadError) {
    const isPermissionError =
      loadError?.code === "permission-denied" ||
      String(loadError?.message || "").includes("insufficient permissions");
    return (
        <div className="surface-card border-t-4 border-t-red-500 p-6">
          <h3 className="text-sm font-semibold text-red-700 mb-2">
            {isPermissionError ? "Permissão do Firebase necessária" : "Erro ao carregar dashboard"}
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            {isPermissionError
              ? "O app conseguiu abrir, mas o Firestore bloqueou a leitura de uma das coleções usadas pelo dashboard."
              : "Ocorreu um erro ao buscar os dados do dashboard."}
          </p>
          <div className="text-xs bg-red-50 border border-red-100 rounded-md px-3 py-2 text-red-700">
            {String(loadError?.message || loadError)}
          </div>
          <button
            type="button"
            onClick={load}
            className="mt-3 px-4 py-2 btn-primary text-xs"
          >
            Tentar novamente
          </button>
        </div>
    );
  }

  const temKpis = Boolean(
    data?.kpis
    && (
      (data.kpis.comissaoEstimada || data.kpis.totalComissao || 0) > 0
      || (data.kpis.totalPedidos || 0) > 0
      || (data.kpis.faturamentoBruto || 0) > 0
    ),
  );
  const semCadastroGlobal = !data || (!temKpis && (data?.produtos?.length ?? 0) === 0);

  if (semCadastroGlobal && !filtroPeriodoAtivo) {
    return <EmptyState />;
  }

  if (!data) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
        <DashboardSkeleton />
      </div>
    );
  }

  const periodoSemVendas = filtroPeriodoAtivo
    && (data.kpis?.totalComissao || 0) === 0
    && (data.kpis?.totalVendas || 0) === 0
    && (data.kpis?.totalPedidos || 0) === 0;
  const periodoLabel = labelPeriodoAtivo(periodoFiltro, rangeCustomApplied);

  return (
      <div className="dashboard-page">
        <OperationalAlerts alerts={operationalAlerts} className="mb-0" />

        {periodoSemVendas && !atualizandoPeriodo && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900 flex items-start gap-2">
            <Clock size={16} className="shrink-0 mt-0.5" />
            <span>
              {periodoFiltro === "ontem" ? (
                <>
                  <strong>Ontem ({formatDateDisplayPT(brtYesterdayYYYYMMDD())}) ainda sem dados na API.</strong>{" "}
                  A Shopee costuma publicar no conversionReport com 24–48h de atraso. Veja o status em Configurações.
                </>
              ) : (
                <>
                  <strong>Nenhuma venda em {labelPeriodoAtivo(periodoFiltro, rangeCustomApplied)}.</strong>{" "}
                  Troque o período acima ou aguarde a sincronização (Configurações).
                </>
              )}
            </span>
          </div>
        )}

        {/* Bloco principal — estilo referência Campanhas Inteligentes */}
        <section className="space-y-4">
          <PerformanceHeroFinanceiro kpis={kpis} />
          <StatusPedidosCards kpis={kpis} perdas={data?.perdas} />
          <PerformanceHeroVolume
            kpis={kpisVolume || kpis}
            subIdsComVenda={subIdsComVenda}
            metaMensal={settings.metaMensal}
            showMetaMensal={periodoFiltro === "mes_atual"}
          />
          <DashboardChartsPanel
            chartData={chartData}
            startDate={rangeAtivo?.startDate}
            endDate={rangeAtivo?.endDate}
            kpis={kpis}
            perdas={data?.perdas}
            subIds={subIds}
            periodoLabel={periodoLabel}
          />
        </section>

        <DashboardSection title="Detalhes financeiros" subtitle="Projetado (operacional) — gasto, lucro e ticket">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          badge="Pendente"
          icon={<DollarSign size={18} />}
          iconBg="bg-sky-100 text-sky-700"
          accentTop="border-t-sky-500"
          tint="from-sky-50/70"
          label="Comissão"
          value={fmt(comissaoPendenteKpiValor(kpis))}
          trend={comissaoKpiTrendPedidosPendentes(kpis)}
          subTrend={comissaoKpiSubTrendSplit(kpis)}
          up={comissaoPendenteKpiValor(kpis) >= 0}
        />
        <KPICard
          badge="Projetado"
          icon={<DollarSign size={18} />}
          iconBg="bg-violet-100 text-violet-700"
          accentTop="border-t-violet-500"
          tint="from-violet-50/70"
          label="Comissão projetada"
          value={fmt(comissaoProjetadaValor(kpis))}
          trend={`${fmtNum(kpis.pedidosPendentes || 0)} conversões pendentes`}
          up
        />
        <KPICard
          badge="GMV"
          icon={<TrendingUp size={18} />}
          iconBg="bg-indigo-100 text-indigo-700"
          accentTop="border-t-indigo-500"
          tint="from-indigo-50/70"
          label="Fat. Bruto"
          value={fmt(kpis.faturamentoBruto)}
          trend={
            periodoFiltro === "mes_atual" && settings.metaMensal > 0
              ? formatMetaMensalProgress(kpis.faturamentoBruto, settings.metaMensal).headline
              : `${fmtNum(kpis.totalVendas)} itens negociados`
          }
          subTrend={
            periodoFiltro === "mes_atual" && settings.metaMensal > 0
              ? `Meta ${fmt(settings.metaMensal)} · ${fmtNum(kpis.totalVendas)} itens`
              : undefined
          }
          up
        />
        <KPICard
          badge="Mídia"
          icon={<Target size={18} />}
          iconBg="bg-violet-100 text-violet-700"
          accentTop="border-t-violet-500"
          tint="from-violet-50/70"
          label="Gasto"
          value={fmt(kpis.totalInvestimento)}
          trend={`Meta ${fmt(kpis.metaTotalGasto)} · Pin ${fmt(kpis.pinTotalGasto)}`}
        />
        <KPICard
          badge="Projetado"
          icon={<BarChart3 size={18} />}
          iconBg={(kpis.lucroProjetado || 0) >= 0 ? "bg-violet-100 text-violet-700" : "bg-red-100 text-red-700"}
          accentTop={(kpis.lucroProjetado || 0) >= 0 ? "border-t-violet-500" : "border-t-red-500"}
          tint={(kpis.lucroProjetado || 0) >= 0 ? "from-violet-50/70" : "from-red-50/60"}
          label="Lucro projetado"
          value={fmt(kpis.lucroProjetado || 0)}
          trend={lucroKpiTrendProjetado(kpis)}
          up={(kpis.lucroProjetado || 0) >= 0}
          down={(kpis.lucroProjetado || 0) < 0}
        />
        <KPICard
          badge="Projetado"
          icon={<TrendingUp size={18} />}
          iconBg="bg-indigo-100 text-indigo-700"
          accentTop="border-t-indigo-500"
          tint="from-indigo-50/70"
          label="ROI projetado"
          value={((kpis.roiProjetado || 0) * 100).toFixed(2) + "%"}
          trend={roiKpiTrendProjetado(kpis)}
          up={(kpis.roiProjetado || 0) >= 0}
          down={(kpis.roiProjetado || 0) < 0}
        />
        <KPICard
          badge="Estoque"
          icon={<ShoppingBag size={18} />}
          iconBg="bg-orange-100 text-orange-700"
          accentTop="border-t-orange-500"
          tint="from-orange-50/70"
          label="Itens vendidos"
          value={fmtNum(kpis.totalVendas)}
          trend={`${fmtNum((kpisVolume || kpis)?.vendasDiretas || 0)}D / ${fmtNum((kpisVolume || kpis)?.vendasIndiretas || 0)}I`}
          up
        />
        <KPICard
          badge="GMV"
          icon={<Ticket size={18} />}
          iconBg="bg-rose-100 text-rose-700"
          accentTop="border-t-rose-500"
          tint="from-rose-50/70"
          label="Ticket por item"
          value={fmt(kpis.ticketMedio)}
          trend={
            (kpis.totalPedidos || 0) > 0
              ? `Ticket por pedido ${fmt(calcTicketPorPedido(kpis))}`
              : "GMV ÷ itens vendidos"
          }
          up
        />
          </div>
        </DashboardSection>

        <DashboardSection
          title="Campanhas por SubID"
          subtitle={periodoFiltro !== "all" && subIds && subIds.length > 0
            ? "Dados de subid_daily / produto_daily do período (alinhados aos KPIs após sync)"
            : "Detalhamento e filtros por campanha"}
        >
      {subIds && subIds.length > 0 && (subIdDiagnostics?.isReliable || periodoFiltro !== "all") && (
        <div className="surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            {subIds && subIds.length > 0 && todosSubIdsDisponiveis.length > 0 && (
              isMobile ? (
                <SubIdFilterSheet
                  isMobile
                  open={subFilterOpen}
                  onOpenChange={setSubFilterOpen}
                  subIdsSelecionados={subIdsSelecionados}
                  setSubIdsSelecionados={setSubIdsSelecionados}
                  todosSubIdsDisponiveis={todosSubIdsDisponiveis}
                  subIdFiltroBusca={subIdFiltroBusca}
                  setSubIdFiltroBusca={setSubIdFiltroBusca}
                  subIdsParaCheckbox={subIdsParaCheckbox}
                />
              ) : (
                <SubIdDesktopFilter
                  subIdsSelecionados={subIdsSelecionados}
                  setSubIdsSelecionados={setSubIdsSelecionados}
                  todosSubIdsDisponiveis={todosSubIdsDisponiveis}
                  subIdFiltroBusca={subIdFiltroBusca}
                  setSubIdFiltroBusca={setSubIdFiltroBusca}
                  subIdsParaCheckbox={subIdsParaCheckbox}
                />
              )
            )}

            {kpisDosSelecionados && (
              <div className="mb-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-indigo-900">
                    Resumo dos {kpisDosSelecionados.qtd} SubID(s) selecionado(s)
                  </h3>
                  <span className="text-xs text-indigo-600">
                    {kpisDosSelecionados.vendas} vendas
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Comissão</div>
                    <div className="text-lg font-bold text-indigo-700">
                      R$ {(kpisDosSelecionados.comissaoEstimada || kpisDosSelecionados.comissao).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Faturamento</div>
                    <div className="text-lg font-bold text-gray-900">
                      R$ {kpisDosSelecionados.faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Gasto</div>
                    <div className="text-lg font-bold text-gray-900">
                      R$ {kpisDosSelecionados.gasto.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Lucro</div>
                    <div className={`text-lg font-bold ${kpisDosSelecionados.lucro >= 0 ? "text-green-600" : "text-red-600"}`}>
                      R$ {kpisDosSelecionados.lucro.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">ROI</div>
                    <div className={`text-lg font-bold ${kpisDosSelecionados.roi >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {(kpisDosSelecionados.roi * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">ROAS</div>
                    <div className="text-lg font-bold text-gray-900">
                      {kpisDosSelecionados.roas.toFixed(2)}x
                    </div>
                  </div>
                  <div className="surface-card p-3 border border-indigo-100/80 shadow-sm">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Vendas</div>
                    <div className="text-lg font-bold text-gray-900">
                      {kpisDosSelecionados.vendas.toLocaleString("pt-BR")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isMobile && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold">
                    Detalhamento por SubID
                    {loadingSubIds && <span className="ml-2 text-xs font-normal text-gray-400">carregando…</span>}
                  </h3>
                  <span className="text-xs text-gray-400">{subIdsTabelaLabel}</span>
                </div>
                <SubIdDesktopToolbar
                  subSearch={subSearch}
                  setSubSearch={setSubSearch}
                  subCols={subCols}
                  setSubCols={setSubCols}
                  subColsOpen={subColsOpen}
                  setSubColsOpen={setSubColsOpen}
                  subSortField={subSortField}
                  setSubSortField={setSubSortField}
                  subSortDir={subSortDir}
                  setSubSortDir={setSubSortDir}
                  onlyLoss={onlyLoss}
                  setOnlyLoss={setOnlyLoss}
                  onlyProfit={onlyProfit}
                  setOnlyProfit={setOnlyProfit}
                />
              </>
            )}
          </div>

          {isMobile ? (
            <SubIdMobilePanel
              loadingSubIds={loadingSubIds}
              rowCount={subIdsFilteredSorted.length}
              rowCountLabel={subIdsTabelaLabel}
              subSearch={subSearch}
              setSubSearch={setSubSearch}
              subCols={subCols}
              setSubCols={setSubCols}
              subColsOpen={subColsOpen}
              setSubColsOpen={setSubColsOpen}
              subSortField={subSortField}
              setSubSortField={setSubSortField}
              subSortDir={subSortDir}
              setSubSortDir={setSubSortDir}
              onlyLoss={onlyLoss}
              setOnlyLoss={setOnlyLoss}
              onlyProfit={onlyProfit}
              setOnlyProfit={setOnlyProfit}
              rows={subIdsFilteredSorted}
              roiMinimo={settings.roiMinimo}
              totals={subIdTableTotals}
            />
          ) : (
            <SubIdDesktopTable
              rows={subIdsFilteredSorted}
              subCols={subCols}
              totals={subIdTableTotals}
              renderSubIdRow={renderSubIdRow}
            />
          )}
          {metaGastoResumo && periodoFiltro !== "all" && (
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-600 bg-slate-50">
              Meta no período (conta, <code className="text-[10px]">meta_ads_daily</code>): <strong>{fmt(metaGastoResumo.metaConta)}</strong>
              {" · "}Atribuído aos SubIDs: <strong>{fmt(metaGastoResumo.metaNasLinhas)}</strong>
              {metaGastoResumo.metaNaoAtribuido > 0.01 && (
                <>{" · "}Sem SubID mapeado: <strong className="text-amber-800">{fmt(metaGastoResumo.metaNaoAtribuido)}</strong></>
              )}
            </div>
          )}
        </div>
      )}

      {(!subIds || subIds.length === 0) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
          Nenhum SubID encontrado no período selecionado (subid_daily).
        </div>
      )}
        </DashboardSection>

        <DashboardSection
          title="Desempenho diário por SubID"
          subtitle={periodoFiltro === "all"
            ? "Selecione um período acima para ver gasto e vendas dia a dia"
            : subIdsSelecionados.length > 0
              ? `Detalhamento dos ${subIdsSelecionados.length} SubID(s) selecionado(s) — ${subIdDailyFiltered.length} dia(s)`
              : "Evolução dia a dia no período — veja se a campanha melhorou ou piorou"}
        >
      {periodoFiltro !== "all" ? (
        <div className="surface-card overflow-hidden">
          <SubIdDailyBreakdownTable
            rows={subIdDailySorted}
            totals={subIdDailyTotals}
            loading={loadingSubIdDaily}
            roiMinimo={settings.roiMinimo}
            isMobile={isMobile}
            sortField={dailySortField}
            sortDir={dailySortDir}
            onSort={handleDailySort}
          />
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
          Escolha um período (7 dias, 30 dias, personalizado, etc.) para visualizar o desempenho diário de gasto, vendas e lucro.
        </div>
      )}
        </DashboardSection>
      </div>
  );
}

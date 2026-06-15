import { useMemo } from "react";
import { Info, LineChart, PieChart } from "lucide-react";
import ChartCanvas from "../charts/ChartCanvas";
import { fmt, fmtNum, splitCriterioPromosAppTooltip } from "../../utils/formatters";
import { resolverStatusPedidos } from "./StatusPedidosCards";

function formatChartDay(iso) {
  if (!iso || iso.length < 10) return iso || "";
  const [, m, d] = iso.split("-");
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d} de ${meses[Number(m) - 1] || m}`;
}

function buildCanalSlices(subIds = []) {
  const sorted = [...subIds]
    .filter((r) => (r.comissoes || r.comissoes_estimadas || 0) > 0 || (r.total_vendas || 0) > 0)
    .sort((a, b) => (b.comissoes_estimadas || b.comissoes || 0) - (a.comissoes_estimadas || a.comissoes || 0));

  if (!sorted.length) return null;

  const top = sorted.slice(0, 5);
  const resto = sorted.slice(5);
  const labels = top.map((r) => String(r.subid || r.id || "—").slice(0, 18));
  const values = top.map((r) => Number(r.comissoes_estimadas || r.comissoes || 0));
  const cores = ["#F97316", "#6366F1", "#14B8A6", "#EC4899", "#8B5CF6"];

  if (resto.length) {
    labels.push("Outros");
    values.push(resto.reduce((s, r) => s + Number(r.comissoes_estimadas || r.comissoes || 0), 0));
    cores.push("#94A3B8");
  }

  return { labels, values, cores };
}

function comissaoDoDia(row) {
  const concluida = Number(row.comissaoConcluida || 0);
  const pendente = Number(row.comissaoPendente || 0);
  const estimada = Number(
    row.comissaoEstimada
    ?? row.comissao_estimada
    ?? row.comissao
    ?? 0,
  );
  const total = concluida + pendente > 0 ? concluida + pendente : estimada;
  return { concluida, pendente, total };
}

function filtrarHistoricoPeriodo(rows, startDate, endDate) {
  if (!startDate || !endDate) return rows;
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  return rows.filter((r) => {
    const d = String(r.data || "").slice(0, 10);
    return d >= start && d <= end;
  });
}

function buildComissaoLineChart(rows) {
  if (!rows.length) return null;

  const labels = rows.map((r) => formatChartDay(r.data));
  const series = rows.map(comissaoDoDia);
  if (!series.some((s) => s.total > 0)) return null;

  const pointRadius = rows.length > 31 ? 0 : 3;

  return {
    labels,
    datasets: [{
      label: "Projetado",
      data: series.map((s) => s.total),
      borderColor: "#8B5CF6",
      backgroundColor: "rgba(139, 92, 246, 0.12)",
      fill: true,
      tension: 0.35,
      pointRadius,
      borderWidth: 2.5,
    }],
  };
}

export default function DashboardChartsPanel({
  chartData = [],
  startDate = null,
  endDate = null,
  kpis = {},
  perdas = null,
  subIds = [],
  periodoLabel = "Período selecionado",
}) {
  const status = resolverStatusPedidos(kpis, perdas);
  const canal = buildCanalSlices(subIds);

  const lineChart = useMemo(() => {
    const rows = filtrarHistoricoPeriodo(
      [...chartData].sort((a, b) => String(a.data).localeCompare(String(b.data))),
      startDate,
      endDate,
    );
    return buildComissaoLineChart(rows);
  }, [chartData, startDate, endDate]);

  const statusChart = useMemo(() => {
    const slices = [
      { label: "Conversões concl.", value: status.concluidos, color: "#22C55E" },
      { label: "Conversões pend.", value: status.pendentes, color: "#FBBF24" },
      { label: "Cancelados", value: status.cancelados, color: "#EF4444" },
    ];
    if (status.pedidosNaoPagos > 0) {
      slices.push({ label: "Não liquidados", value: status.pedidosNaoPagos, color: "#71717A" });
    }
    if (status.pedidosComPerda > 0
      && status.pedidosComPerda !== status.cancelados) {
      slices.push({ label: "Perdas (log)", value: status.pedidosComPerda, color: "#64748B" });
    }
    const filtered = slices.filter((s) => s.value > 0);
    if (!filtered.length) return null;

    return {
      labels: filtered.map((s) => s.label),
      datasets: [{
        data: filtered.map((s) => s.value),
        backgroundColor: filtered.map((s) => s.color),
        borderWidth: 2,
        borderColor: "#fff",
      }],
    };
  }, [status]);

  const canalChart = useMemo(() => {
    if (!canal) return null;
    return {
      labels: canal.labels,
      datasets: [{
        data: canal.values,
        backgroundColor: canal.cores,
        borderWidth: 2,
        borderColor: "#fff",
      }],
    };
  }, [canal]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: { boxWidth: 12, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 10 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: "#F1F5F9" },
        ticks: {
          font: { size: 10 },
          callback: (v) => `R$ ${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`,
        },
      },
    },
  }), []);

  const doughnutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: {
        position: "bottom",
        labels: { boxWidth: 10, font: { size: 11 }, padding: 12 },
      },
    },
  }), []);

  const semGraficos = !lineChart && !statusChart;

  if (semGraficos) {
    return (
      <div className="surface-card p-8 text-center text-sm text-slate-500">
        Sem histórico diário para exibir gráficos neste período.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <div className="xl:col-span-6 surface-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <LineChart size={16} className="text-emerald-600" />
          <div>
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <span>Comissão</span>
              <span
                className="text-slate-400 cursor-help"
                title={splitCriterioPromosAppTooltip(kpis)}
                aria-label={splitCriterioPromosAppTooltip(kpis)}
              >
                <Info size={14} />
              </span>
            </div>
            <div className="text-[11px] text-slate-500">{periodoLabel} · comissão projetada por dia</div>
          </div>
        </div>
        {lineChart ? (
          <ChartCanvas type="line" data={lineChart} options={lineOptions} height={260} />
        ) : (
          <div className="h-[260px] flex items-center justify-center text-xs text-slate-400">Sem série diária</div>
        )}
      </div>

      <div className="xl:col-span-3 surface-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <PieChart size={16} className="text-amber-500" />
          <div className="text-sm font-semibold text-slate-800">Status de conversão</div>
        </div>
        {statusChart ? (
          <>
            <ChartCanvas type="doughnut" data={statusChart} options={doughnutOptions} height={240} />
            <div className="text-center text-[11px] text-slate-500 mt-2">
              {fmtNum(Number(kpis.totalPedidos || 0) || status.concluidos + status.pendentes)} pedidos validados
              {(status.cancelados || 0) > 0
                ? ` · ${fmtNum(status.cancelados)} cancelados`
                : ""}
            </div>
          </>
        ) : (
          <div className="h-[240px] flex items-center justify-center text-xs text-slate-400">Sem pedidos</div>
        )}
      </div>

      <div className="xl:col-span-3 surface-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <PieChart size={16} className="text-orange-500" />
          <div className="text-sm font-semibold text-slate-800">Performance por SubID</div>
        </div>
        {canalChart ? (
          <ChartCanvas type="doughnut" data={canalChart} options={doughnutOptions} height={240} />
        ) : (
          <div className="h-[240px] flex items-center justify-center text-xs text-slate-400 text-center px-4">
            Comissão por campanha aparece após carregar SubIDs
          </div>
        )}
      </div>
    </div>
  );
}

import { CheckCircle2, Clock, Hourglass, Info, Package, XCircle } from "lucide-react";
import { fmtNum, splitCriterioPromosAppTooltip } from "../../utils/formatters";

function resolverStatusPedidos(kpis = {}, perdas = null) {
  const pedidosValidados = Number(kpis.totalPedidos || 0);
  let concluidos = Number(kpis.pedidosConcluidos || 0);
  let pendentes = Number(kpis.pedidosPendentes || 0);
  let cancelados = Number(kpis.pedidosCancelados || 0);
  const pedidosComPerda = Number(perdas?.countPerdas || 0);
  const pedidosNaoPagos = Number(kpis.pedidosNaoPagos || 0);

  if (pedidosValidados > 0 && concluidos === 0 && pendentes === 0 && cancelados === 0) {
    const comConc = Number(kpis.comissaoConcluida || 0);
    const comPend = Number(kpis.comissaoPendente || 0);
    const comCanc = Number(kpis.comissaoCancelada || 0);
    const comTot = comConc + comPend + comCanc;
    if (comTot > 0) {
      concluidos = Math.round(pedidosValidados * (comConc / comTot));
      pendentes = Math.round(pedidosValidados * (comPend / comTot));
      cancelados = Math.max(0, pedidosValidados - concluidos - pendentes);
    } else {
      pendentes = pedidosValidados;
    }
  }

  if (pedidosValidados > 0 && concluidos + pendentes + cancelados === 0) {
    pendentes = pedidosValidados;
  }

  return {
    concluidos,
    pendentes,
    cancelados,
    pedidosValidados,
    pedidosComPerda,
    pedidosNaoPagos,
  };
}

function StatusCard({ tone, icon: Icon, title, value, subtitle, tooltip }) {
  const tones = {
    green: "from-emerald-500 to-emerald-600 shadow-emerald-500/25",
    yellow: "from-amber-400 to-amber-500 shadow-amber-400/25",
    red: "from-red-500 to-red-600 shadow-red-500/25",
    blue: "from-sky-500 to-sky-600 shadow-sky-500/25",
    gray: "from-slate-500 to-slate-600 shadow-slate-500/20",
    slate: "from-zinc-500 to-zinc-600 shadow-zinc-500/20",
  };

  return (
    <div className={`rounded-2xl p-5 text-white bg-gradient-to-br ${tones[tone]} shadow-lg flex gap-4 items-start`}>
      <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white/90 flex items-center gap-1.5">
          <span>{title}</span>
          {tooltip ? (
            <span className="relative group cursor-help" title={tooltip} aria-label={tooltip}>
              <Info size={14} className="opacity-80" />
            </span>
          ) : null}
        </div>
        <div className="text-3xl font-extrabold tracking-tight mt-1">{fmtNum(value)}</div>
        {subtitle ? <div className="text-xs text-white/75 mt-1">{subtitle}</div> : null}
      </div>
    </div>
  );
}

export default function StatusPedidosCards({ kpis, perdas }) {
  const status = resolverStatusPedidos(kpis, perdas);
  const criterioTooltip = splitCriterioPromosAppTooltip(kpis);
  const perdasIgualCancelados = status.pedidosComPerda > 0
    && status.pedidosComPerda === status.cancelados;
  const exibirCardPerdas = status.pedidosComPerda > 0 && !perdasIgualCancelados;

  const cards = [
    {
      key: "concl",
      tone: "green",
      icon: CheckCircle2,
      title: "Conversões concluídas",
      value: status.concluidos,
      subtitle: "100% dos pedidos válidos COMPLETED",
      tooltip: criterioTooltip,
    },
    {
      key: "pend",
      tone: "yellow",
      icon: Clock,
      title: "Conversões pendentes",
      value: status.pendentes,
      subtitle: "Aguardando liquidação na Shopee",
    },
    {
      key: "valid",
      tone: "blue",
      icon: Package,
      title: "Pedidos validados",
      value: status.pedidosValidados,
      subtitle: "Total rastreado no período (API)",
    },
    {
      key: "canc",
      tone: "red",
      icon: XCircle,
      title: "Pedidos cancelados",
      value: status.cancelados,
      subtitle: perdasIgualCancelados
        ? "Status CANCELLED na API (inclui log_perdas)"
        : "Cancelados ou devolvidos na API",
    },
    {
      key: "unpaid",
      tone: "slate",
      icon: Hourglass,
      title: "Não liquidados",
      value: status.pedidosNaoPagos,
      subtitle: "UNPAID — aguardando pagamento",
    },
  ];

  if (exibirCardPerdas) {
    cards.push({
      key: "perda",
      tone: "gray",
      icon: Hourglass,
      title: "Perdas (log)",
      value: status.pedidosComPerda,
      subtitle: "Registro log_perdas — pode sobrepor cancelados",
    });
  }

  const gridCols = cards.length >= 6
    ? "xl:grid-cols-6"
    : cards.length === 5
      ? "xl:grid-cols-5"
      : "xl:grid-cols-4";

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
        Conversão — status PromosApp
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridCols} gap-4`}>
        {cards.map((c) => (
          <StatusCard
            key={c.key}
            tone={c.tone}
            icon={c.icon}
            title={c.title}
            value={c.value}
            subtitle={c.subtitle}
            tooltip={c.tooltip}
          />
        ))}
      </div>
    </div>
  );
}

export { resolverStatusPedidos };

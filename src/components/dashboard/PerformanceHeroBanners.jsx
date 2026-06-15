import { ShoppingBag, Target, TrendingUp, Wallet } from "lucide-react";
import {
  fmt,
  fmtNum,
  fmtRoas,
  comissaoPendenteKpiValor,
  comissaoProjetadaValor,
  comissaoLiquidacaoContexto,
  formatTaxaConversaoPedidos,
  calcTicketPorPedido,
  formatMetaMensalProgress,
  somarVendasDiretasIndiretasSubIds,
  contarSubIdsComVenda,
  contarSubIdsNoPeriodo,
  roasProjetado,
} from "../../utils/formatters";

function FinanceDualPanel({ label, comissao, roiPct, lucro, roas, highlight = false }) {
  return (
    <div
      className={`rounded-xl p-4 border min-w-0 ${
        highlight
          ? "bg-white/15 border-white/25"
          : "bg-white/10 border-white/15"
      }`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/60 mb-2">{label}</div>
      <div className="text-sm text-white/85 mb-1">Comissão {fmt(comissao)}</div>
      <div className="text-2xl font-extrabold tracking-tight">{roiPct}% ROI</div>
      <div className="text-[11px] text-white/70 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Lucro {fmt(lucro)}</span>
        <span>ROAS {fmtRoas(roas)}</span>
      </div>
    </div>
  );
}

function HeroMetric({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center shrink-0">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-white/75 uppercase tracking-wide">{label}</div>
        <div className="text-lg font-bold truncate">{value}</div>
        {sub ? <div className="text-[10px] text-white/60 truncate">{sub}</div> : null}
      </div>
    </div>
  );
}

/** Bloco 1 — Financeiro: comissão, ROI, lucro e ROAS projetados. */
export function PerformanceHeroFinanceiro({ kpis = {} }) {
  const roiProjetado = ((kpis.roiProjetado || 0) * 100).toFixed(2);
  const contextoPendente = comissaoLiquidacaoContexto(kpis);

  return (
    <div className="rounded-2xl p-5 text-white bg-gradient-to-br from-violet-600 to-indigo-700 shadow-lg shadow-indigo-500/20">
      <div className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Wallet size={16} />
        Financeiro — tráfego e comissão
      </div>

      <div className="mb-4">
        <FinanceDualPanel
          label="Projetado"
          comissao={comissaoProjetadaValor(kpis)}
          roiPct={roiProjetado}
          lucro={kpis.lucroProjetado || 0}
          roas={roasProjetado(kpis)}
          highlight
        />
      </div>

      <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/15">
        <HeroMetric icon={Wallet} label="Investimento (mídia)" value={fmt(kpis.totalInvestimento)} />
        <HeroMetric
          icon={Target}
          label="Comissão pendente"
          value={fmt(comissaoPendenteKpiValor(kpis))}
          sub={kpis.pedidosPendentes > 0 ? `${fmtNum(kpis.pedidosPendentes)} conversões pendentes` : undefined}
        />
      </div>

      {contextoPendente && (
        <p className="mt-3 pt-3 border-t border-white/15 text-[11px] text-white/80">
          {contextoPendente}
        </p>
      )}
    </div>
  );
}

/** Bloco 3 — Volume: GMV, itens, tickets, diretas/indiretas. */
export function PerformanceHeroVolume({
  kpis = {},
  subIdsComVenda = 0,
  metaMensal = 0,
  showMetaMensal = false,
}) {
  const fatBruto = Number(kpis.faturamentoBruto) || 0;
  const meta = Number(metaMensal) || 0;
  const metaProgress = formatMetaMensalProgress(fatBruto, meta);
  const metaBatida = meta > 0 && fatBruto >= meta;
  const ticketPedido = calcTicketPorPedido(kpis);
  const taxaAds = formatTaxaConversaoPedidos(kpis);

  return (
    <div className="rounded-2xl p-5 text-white bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/20">
      <div className="text-sm font-semibold mb-4 flex items-center gap-2">
        <ShoppingBag size={16} />
        Volume — vendas Shopee
      </div>
      <div className="grid grid-cols-2 gap-4">
        <HeroMetric
          icon={Target}
          label="SubIDs com venda"
          value={fmtNum(subIdsComVenda)}
          sub="Com comissão ou itens no período"
        />
        <HeroMetric icon={ShoppingBag} label="Itens vendidos" value={fmtNum(kpis.totalVendas || 0)} />
        <HeroMetric icon={TrendingUp} label="Fat. bruto (GMV)" value={fmt(fatBruto)} />
        <HeroMetric
          icon={Wallet}
          label="Ticket por item"
          value={fmt(kpis.ticketMedio)}
          sub={ticketPedido > 0 ? `Ticket por pedido ${fmt(ticketPedido)}` : undefined}
        />
      </div>
      <div className="mt-4 pt-3 border-t border-white/15 text-[11px] text-white/70 flex flex-wrap gap-x-4 gap-y-1">
        <span>{fmtNum(kpis.vendasDiretas || 0)} diretas</span>
        <span>{fmtNum(kpis.vendasIndiretas || 0)} indiretas</span>
        {taxaAds && <span>{taxaAds}</span>}
      </div>
      {showMetaMensal && meta > 0 && (
        <div className="mt-4 pt-3 border-t border-white/15">
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/80 mb-1.5">
            <span className="font-medium">Meta mensal de faturamento</span>
            <span className="font-semibold">{metaProgress.headline}</span>
          </div>
          <div className="h-2 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all duration-500"
              style={{ width: `${metaProgress.barPct}%` }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-white/70 flex flex-wrap justify-between gap-x-3 gap-y-0.5">
            <span>{fmt(metaProgress.fat)} de {fmt(metaProgress.meta)}</span>
            <span>
              {metaProgress.ratio >= 10
                ? metaProgress.detailPct
                : metaBatida
                  ? `Meta batida (+${fmt(fatBruto - meta)})`
                  : `Faltam ${fmt(meta - fatBruto)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** @deprecated use PerformanceHeroFinanceiro + StatusPedidosCards + PerformanceHeroVolume */
export default function PerformanceHeroBanners(props) {
  return (
    <>
      <PerformanceHeroFinanceiro {...props} />
      <PerformanceHeroVolume {...props} />
    </>
  );
}

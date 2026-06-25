import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Sparkles,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Pause,
  Zap,
  Target,
  Trophy,
  Activity,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { supabase } from "../../../services/supabase/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fmt, fmtNum } from "../../../utils/formatters";

import {
  parseTotais,
  parseTabelaCampanhas,
  parseCampanhaBlocos,
  parsePlanoAcao,
  parseResumoTextual,
  getExecutionSteps,
  getEstimatedImpact,
  STATUS_CFG
} from "../traffic/parseAiAnalysis";

/* =====================================================================
 *  SUB-COMPONENTES
 * ===================================================================== */

function HeaderHero({ data, modelo, onRefresh, refreshing, onCopy, copied, onToggleRaw, showRaw }) {
  const dataFmt = useMemo(() => {
    if (!data) return "—";
    try {
      const d = new Date(data + "T00:00:00");
      return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    } catch {
      return data;
    }
  }, [data]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white shadow-lg">
      {/* glow decorativo */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />

      <div className="relative p-5 md:p-7 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 blur-md opacity-60" />
            <div className="relative w-14 h-14 rounded-2xl bg-white/95 flex items-center justify-center shadow-xl">
              <Bot size={28} className="text-indigo-600" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl md:text-2xl font-bold tracking-tight">Consultor de Tráfego</h2>
              <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 text-[10px] font-extrabold uppercase tracking-wider shadow">
                PRO
              </span>
            </div>
            <p className="text-indigo-100/80 text-xs md:text-sm mt-0.5 font-medium">
              Diagnóstico diário do seu portfólio — gerado por IA
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-[11px] bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 backdrop-blur-sm">
            <Clock size={12} className="text-indigo-200" />
            <span className="text-indigo-50 capitalize">{dataFmt}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 backdrop-blur-sm">
            <Sparkles size={12} className="text-amber-300" />
            <span className="text-indigo-50 font-mono">{modelo || "—"}</span>
          </div>
          <button
            type="button"
            onClick={onCopy}
            title="Copiar análise"
            className="flex items-center gap-1.5 text-[11px] bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl px-3 py-1.5 transition"
          >
            {copied ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>
          <button
            type="button"
            onClick={onToggleRaw}
            title="Ver markdown completo"
            className="flex items-center gap-1.5 text-[11px] bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl px-3 py-1.5 transition"
          >
            {showRaw ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>{showRaw ? "Ocultar" : "Bruto"}</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[11px] bg-white text-indigo-700 hover:bg-indigo-50 rounded-xl px-3 py-1.5 font-semibold transition disabled:opacity-60"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            <span>{refreshing ? "..." : "Atualizar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, accent = "indigo", sub, positive }) {
  const palettes = {
    indigo: "from-indigo-50 to-white border-indigo-100 text-indigo-700",
    emerald: "from-emerald-50 to-white border-emerald-100 text-emerald-700",
    rose: "from-rose-50 to-white border-rose-100 text-rose-700",
    amber: "from-amber-50 to-white border-amber-100 text-amber-700",
  };
  const valueColor =
    positive === true ? "text-emerald-700" : positive === false ? "text-rose-700" : "text-slate-900";
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${palettes[accent]} p-4 transition hover:shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</span>
        <Icon size={14} className="opacity-70" />
      </div>
      <div className={`text-2xl font-extrabold tracking-tight tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1 font-medium">{sub}</div>}
    </div>
  );
}

function KpiDashboard({ totais }) {
  if (!totais) return null;
  const margem = totais.gasto > 0 ? (totais.lucro / totais.gasto) * 100 : 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        icon={Activity}
        label="Gasto total"
        value={fmt(totais.gasto)}
        accent="indigo"
        sub="Investimento em mídia"
      />
      <KpiCard
        icon={TrendingUp}
        label="Comissão total"
        value={fmt(totais.comissao)}
        accent="emerald"
        sub="Receita atribuída"
      />
      <KpiCard
        icon={totais.lucro >= 0 ? TrendingUp : TrendingDown}
        label="Lucro líquido"
        value={`${totais.lucro >= 0 ? "+" : ""}${fmt(totais.lucro)}`}
        accent={totais.lucro >= 0 ? "emerald" : "rose"}
        positive={totais.lucro >= 0}
        sub={`Margem ${margem >= 0 ? "+" : ""}${margem.toFixed(1)}%`}
      />
      <KpiCard
        icon={Target}
        label="ROI geral"
        value={`${totais.roiGeral >= 0 ? "+" : ""}${totais.roiGeral.toFixed(2)}%`}
        accent={totais.roiGeral >= 0 ? "emerald" : "rose"}
        positive={totais.roiGeral >= 0}
        sub={totais.roiGeral >= 0 ? "Portfólio no positivo" : "Portfólio no vermelho"}
      />
    </div>
  );
}

function RoiBar({ roi }) {
  // mapeia roi (-100 a +100) em uma barra centrada em 0
  const clamped = Math.max(-100, Math.min(100, roi));
  const isPos = clamped >= 0;
  const widthPct = Math.min(50, (Math.abs(clamped) / 100) * 50);
  return (
    <div className="relative w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-300" />
      <div
        className={`absolute top-0 bottom-0 ${isPos ? "bg-emerald-500 left-1/2" : "bg-rose-500 right-1/2"}`}
        style={{ width: `${widthPct}%` }}
      />
    </div>
  );
}

function CampaignsTable({ campaigns }) {
  if (!campaigns || campaigns.length === 0) return null;
  const sorted = [...campaigns].sort((a, b) => b.roi - a.roi);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center gap-2">
        <Target size={14} className="text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-800">Ranking de campanhas</h3>
        <span className="text-[11px] text-slate-500 ml-auto">{sorted.length} campanhas analisadas · ordenadas por ROI</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50/50 border-b border-slate-100">
              <th className="text-left px-5 py-2.5 font-bold">Campanha</th>
              <th className="text-right px-3 py-2.5 font-bold">Gasto</th>
              <th className="text-right px-3 py-2.5 font-bold">Cliques</th>
              <th className="text-right px-3 py-2.5 font-bold">Comissão</th>
              <th className="text-right px-3 py-2.5 font-bold">CPC</th>
              <th className="px-3 py-2.5 font-bold text-right min-w-[160px]">ROI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {sorted.map((c, i) => {
              const cfg = STATUS_CFG[c.status];
              const cpc = c.cliques > 0 ? c.gasto / c.cliques : 0;
              return (
                <tr key={`${c.nome}-${i}`} className="hover:bg-slate-50/60 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      <span className="font-semibold text-slate-800 font-mono text-[13px]">{c.nome}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">{fmt(c.gasto)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">{fmtNum(c.cliques)}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">{fmt(c.comissao)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-500 text-xs">{cpc > 0 ? fmt(cpc) : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-end gap-1.5 min-w-[140px]">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold tabular-nums ${cfg.chip}`}>
                        {c.roi >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {c.roi >= 0 ? "+" : ""}{c.roi.toFixed(2)}%
                      </span>
                      <RoiBar roi={c.roi} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusSummaryBar({ campaigns }) {
  if (!campaigns || campaigns.length === 0) return null;
  const buckets = { champion: 0, ok: 0, warn: 0, critical: 0 };
  campaigns.forEach((c) => {
    buckets[c.status] = (buckets[c.status] || 0) + 1;
  });
  const items = [
    { key: "champion", label: "Validadas", icon: Trophy },
    { key: "ok", label: "Saudáveis", icon: CheckCircle2 },
    { key: "warn", label: "Em atenção", icon: AlertTriangle },
    { key: "critical", label: "Críticas", icon: XCircle },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {items.map(({ key, label, icon: Icon }) => {
        const cfg = STATUS_CFG[key];
        const count = buckets[key] || 0;
        return (
          <div
            key={key}
            className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.border} ${cfg.bgSolid}`}
          >
            <div className={`w-9 h-9 rounded-lg bg-white border ${cfg.border} flex items-center justify-center ${cfg.text}`}>
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <div className={`text-2xl font-extrabold tabular-nums leading-none ${cfg.textStrong}`}>{count}</div>
              <div className={`text-[11px] font-semibold mt-0.5 ${cfg.text}`}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResumoCard({ texto, totais }) {
  if (!texto) return null;
  const positivo = totais && totais.lucro >= 0;
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-5 ${positivo ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"}`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${positivo ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
          {positivo ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        </div>
        <div className="min-w-0">
          <h3 className={`text-sm font-bold mb-1 ${positivo ? "text-emerald-900" : "text-rose-900"}`}>
            Leitura do portfólio
          </h3>
          <div className={`text-sm leading-relaxed ${positivo ? "text-emerald-900/90" : "text-rose-900/90"}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{texto}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

function CampaignDetailCard({ bloco }) {
  const cfg = STATUS_CFG[bloco.status];
  const Icon = cfg.icon;
  return (
    <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} overflow-hidden transition hover:shadow-md`}>
      <div className={`px-5 py-3.5 border-b ${cfg.border} bg-white/60 backdrop-blur-sm flex items-center gap-3`}>
        <div className={`w-9 h-9 rounded-lg bg-white border ${cfg.border} flex items-center justify-center ${cfg.text}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-slate-800 text-sm">{bloco.nome}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${cfg.chip} border`}>
              {cfg.label}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xl font-extrabold tabular-nums ${cfg.textStrong}`}>
            {bloco.roi >= 0 ? "+" : ""}{bloco.roi.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">ROI</div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {(bloco.gasto != null || bloco.comissao != null || bloco.lucro != null) && (
          <div className="grid grid-cols-3 gap-2">
            {bloco.gasto != null && (
              <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Gasto</div>
                <div className="text-sm font-bold text-slate-800 tabular-nums">{fmt(bloco.gasto)}</div>
              </div>
            )}
            {bloco.comissao != null && (
              <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Comissão</div>
                <div className="text-sm font-bold text-slate-800 tabular-nums">{fmt(bloco.comissao)}</div>
              </div>
            )}
            {bloco.lucro != null && (
              <div className={`rounded-lg bg-white border p-2.5 ${bloco.lucro >= 0 ? "border-emerald-200" : "border-rose-200"}`}>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                  {bloco.lucro >= 0 ? "Lucro" : "Prejuízo"}
                </div>
                <div className={`text-sm font-bold tabular-nums ${bloco.lucro >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {bloco.lucro >= 0 ? "+" : ""}{fmt(bloco.lucro)}
                </div>
              </div>
            )}
          </div>
        )}

        {bloco.analise && (
          <div className="text-sm text-slate-700 leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">Análise</div>
            <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-strong:text-slate-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{bloco.analise}</ReactMarkdown>
            </div>
          </div>
        )}

        {bloco.recomendacao && (
          <div className={`rounded-xl border ${cfg.border} bg-white/70 p-3.5 flex items-start gap-3`}>
            <div className={`shrink-0 w-7 h-7 rounded-lg ${cfg.bgSolid} border ${cfg.border} flex items-center justify-center ${cfg.text}`}>
              {bloco.status === "critical" ? <Pause size={13} /> : bloco.status === "warn" ? <AlertTriangle size={13} /> : <Zap size={13} />}
            </div>
            <div className="min-w-0">
              <div className={`text-[10px] uppercase tracking-wider font-bold mb-0.5 ${cfg.text}`}>Recomendação</div>
              <div className="text-sm text-slate-800 leading-snug font-medium">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{bloco.recomendacao}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {(() => {
          const steps = getExecutionSteps(bloco.status, bloco.nome);
          const impact = getEstimatedImpact(bloco);
          if (!steps?.length && !impact) return null;
          return (
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
              {impact && (
                <div>
                  <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 ${cfg.text}`}>
                    {impact.label}
                  </div>
                  <div className={`text-lg font-extrabold tabular-nums ${cfg.textStrong}`}>
                    {fmt(impact.diario)} <span className="text-xs font-semibold text-slate-500">/ dia</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">{impact.descricao}</div>
                </div>
              )}
              {steps?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-bold mb-1.5 text-slate-500">
                    Passo a passo ({cfg.actionVerb})
                  </div>
                  <ol className="text-xs text-slate-600 space-y-1 list-decimal pl-4 marker:text-slate-400 marker:font-bold">
                    {steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function CampaignsBySection({ blocos }) {
  if (!blocos || blocos.length === 0) return null;
  const groups = {
    critical: blocos.filter((b) => b.status === "critical"),
    warn: blocos.filter((b) => b.status === "warn"),
    champion: blocos.filter((b) => b.status === "champion" || b.status === "ok"),
  };
  const titles = {
    critical: { label: "Críticas — Pausar imediatamente", icon: XCircle, color: "text-rose-700" },
    warn: { label: "Em atenção — Ajustar", icon: AlertTriangle, color: "text-amber-700" },
    champion: { label: "Validadas — Escalar com atenção", icon: Trophy, color: "text-emerald-700" },
  };

  return (
    <div className="space-y-6">
      {["critical", "warn", "champion"].map((key) => {
        const itens = groups[key];
        if (itens.length === 0) return null;
        const T = titles[key];
        const Icon = T.icon;
        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-3">
              <Icon size={16} className={T.color} />
              <h3 className={`text-sm font-bold ${T.color}`}>{T.label}</h3>
              <span className="text-[11px] text-slate-400 font-semibold">({itens.length})</span>
              <div className="flex-1 h-px bg-slate-200 ml-2" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {itens.map((b, i) => (
                <CampaignDetailCard key={`${b.nome}-${i}`} bloco={b} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlanoAcao({ itens }) {
  if (!itens || itens.length === 0) return null;
  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-white overflow-hidden shadow-sm">
      <div className="px-5 py-3.5 border-b border-indigo-100 flex items-center gap-2 bg-white/60">
        <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
          <Zap size={14} />
        </div>
        <h3 className="text-sm font-bold text-indigo-900">Plano de ação para hoje</h3>
        <span className="text-[11px] text-indigo-500 ml-auto font-semibold">{itens.length} ações</span>
      </div>
      <ol className="p-5 space-y-2.5">
        {itens.map((item, i) => (
          <li key={i} className="flex items-start gap-3 group">
            <div className="shrink-0 w-6 h-6 rounded-full bg-white border-2 border-indigo-200 text-indigo-700 flex items-center justify-center text-[11px] font-extrabold group-hover:border-indigo-400 transition">
              {i + 1}
            </div>
            <div className="text-sm text-slate-700 leading-relaxed pt-0.5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ p: ({ children }) => <span>{children}</span> }}
              >
                {item}
              </ReactMarkdown>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RawMarkdownView({ md }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="prose prose-sm prose-slate max-w-none
                      prose-headings:font-bold prose-headings:text-slate-800
                      prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
                      prose-p:text-slate-600 prose-p:leading-relaxed
                      prose-strong:text-slate-900
                      prose-table:text-sm prose-th:bg-slate-50 prose-th:font-bold
                      prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2
                      prose-td:border-b prose-td:border-slate-100">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </div>
    </div>
  );
}

/* =====================================================================
 *  PAINEL PRINCIPAL
 * ===================================================================== */

export default function TrafficInsightPanel() {
  const [analise, setAnalise] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchAnalise = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("ai_daily_analysis")
        .select("*")
        .order("data", { ascending: false })
        .limit(1)
        .single();
      if (err) throw err;
      setAnalise(data);
    } catch (e) {
      console.error("Erro ao buscar análise da IA:", e);
      setError(e);
      setAnalise(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAnalise(false);
  }, []);

  const md = analise?.analise_markdown || "";

  const { totais, campaigns, blocos, plano, resumo } = useMemo(() => {
    return {
      totais: parseTotais(md),
      campaigns: parseTabelaCampanhas(md),
      blocos: parseCampanhaBlocos(md),
      plano: parsePlanoAcao(md),
      resumo: parseResumoTextual(md),
    };
  }, [md]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  /* --------- LOADING --------- */
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 rounded-2xl bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  /* --------- ERROR --------- */
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-8 text-center">
        <XCircle size={36} className="mx-auto text-rose-400 mb-3" />
        <h3 className="text-base font-bold text-rose-900">Não foi possível carregar a análise</h3>
        <p className="text-sm text-rose-700 mt-1 mb-4">{String(error?.message || error)}</p>
        <button
          onClick={() => fetchAnalise(false)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
        >
          <RefreshCw size={14} /> Tentar novamente
        </button>
      </div>
    );
  }

  /* --------- EMPTY --------- */
  if (!analise) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Bot size={32} className="text-slate-400" />
        </div>
        <h3 className="text-base font-bold text-slate-800">Nenhuma análise disponível ainda</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          O script de automação matinal ainda não rodou hoje. Assim que rodar, o consultor de IA aparece aqui com o diagnóstico completo do portfólio.
        </p>
      </div>
    );
  }

  /* --------- RENDER --------- */
  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <HeaderHero
        data={analise.data}
        modelo={analise.modelo}
        onRefresh={() => fetchAnalise(true)}
        refreshing={refreshing}
        onCopy={handleCopy}
        copied={copied}
        onToggleRaw={() => setShowRaw((v) => !v)}
        showRaw={showRaw}
      />

      {totais && <KpiDashboard totais={totais} />}

      {campaigns.length > 0 && <StatusSummaryBar campaigns={campaigns} />}

      {resumo && <ResumoCard texto={resumo} totais={totais} />}

      {campaigns.length > 0 && <CampaignsTable campaigns={campaigns} />}

      {blocos.length > 0 && <CampaignsBySection blocos={blocos} />}

      {plano.length > 0 && <PlanoAcao itens={plano} />}

      {showRaw && <RawMarkdownView md={md} />}

      {/* Fallback se NADA pôde ser parseado mas existe markdown */}
      {!totais && !campaigns.length && !blocos.length && !plano.length && md && (
        <RawMarkdownView md={md} />
      )}
    </div>
  );
}

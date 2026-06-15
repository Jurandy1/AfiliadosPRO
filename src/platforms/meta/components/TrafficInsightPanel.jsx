import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronUp, Zap, AlertTriangle, CheckCircle, Info, Lightbulb,
} from "lucide-react";
import { analisarTrafego, NIVEL_LABEL } from "../traffic/trafficAnalysis";
import { fmt } from "../../../utils/formatters";

function ScoreRing({ score, label, size = 72 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? "#16A34A" : score >= 45 ? "#D97706" : "#DC2626";
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize="15" fontWeight="600" fill={color}>
          {score}
        </text>
      </svg>
      <span className="text-[11px] text-gray-500 text-center max-w-[76px] leading-tight">{label}</span>
    </div>
  );
}

function vereditoClasses(veredito) {
  if (veredito === "Conta saudável") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (veredito === "Precisa ajustes") return "bg-amber-100 text-amber-800 border-amber-200";
  if (veredito === "Ação urgente" || veredito === "Conta em risco") return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function InsightAlertCard({ item }) {
  const cfg = {
    critico: { bg: "bg-red-50", border: "border-red-200", icon: AlertTriangle, ic: "text-red-600" },
    alto: { bg: "bg-amber-50", border: "border-amber-200", icon: AlertTriangle, ic: "text-amber-600" },
    medio: { bg: "bg-blue-50", border: "border-blue-200", icon: Info, ic: "text-blue-600" },
  }[item.nivel] || { bg: "bg-gray-50", border: "border-gray-200", icon: Info, ic: "text-gray-600" };
  const Icon = cfg.icon;
  const badge = NIVEL_LABEL[item.nivel] || NIVEL_LABEL.medio;

  return (
    <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-4 mb-3`}>
      <div className="flex items-start gap-2 mb-2">
        <Icon size={16} className={`${cfg.ic} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{item.titulo}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/80 text-gray-700">
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-gray-700 mt-1">{item.descricao}</p>
        </div>
      </div>
      {item.significado && (
        <div className="ml-6 mb-2 pl-3 border-l-2 border-gray-300/60">
          <p className="text-[11px] text-gray-600">
            <strong className="text-gray-800">O que isso significa:</strong> {item.significado}
          </p>
        </div>
      )}
      <p className="text-xs font-medium text-indigo-800 ml-6 flex items-start gap-1">
        <Lightbulb size={13} className="shrink-0 mt-0.5" />
        <span><strong>O que fazer:</strong> {item.acao}</span>
      </p>
    </div>
  );
}

function OportunidadeCard({ op }) {
  return (
    <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 mb-3">
      <div className="flex items-start gap-2">
        <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-emerald-900">{op.titulo}</div>
          <p className="text-xs text-emerald-800/90 mt-1">{op.descricao}</p>
          {op.significado && <p className="text-[11px] text-emerald-700 mt-1">{op.significado}</p>}
          <p className="text-xs font-medium text-emerald-900 mt-2">→ {op.acao}</p>
        </div>
      </div>
    </div>
  );
}

function SectionToggle({ open, onToggle, title, hint }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex justify-between items-center py-1 bg-transparent border-none cursor-pointer group"
    >
      <div className="text-left">
        <span className="text-sm font-semibold text-gray-800 group-hover:text-indigo-700">{title}</span>
        {hint && <span className="block text-[11px] text-gray-400 font-normal">{hint}</span>}
      </div>
      {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
    </button>
  );
}

export default function TrafficInsightPanel({ meta, pins, thresholds }) {
  const [exp, setExp] = useState({ alertas: true, oport: true, passos: true, insights: true });
  const toggle = (k) => setExp((p) => ({ ...p, [k]: !p[k] }));

  const analise = useMemo(() => analisarTrafego(meta, pins, thresholds), [meta, pins, thresholds]);
  const hasData = meta.length > 0 || pins.length > 0;

  if (!hasData) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center mb-4">
        <Zap size={32} className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-700">Consultor aguardando dados</p>
        <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
          Sincronize Meta Ads (automático no backend) ou importe Pinterest. Você receberá explicações simples e um plano de ação.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-cyan-50">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center shadow-md">
            <Zap size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <h3 className="text-base font-semibold text-gray-900">Consultor de Tráfego</h3>
            <p className="text-xs text-gray-600">Leitura automática dos seus anúncios — linguagem simples, ações práticas</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${vereditoClasses(analise.veredito)}`}>
            {analise.veredito}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="flex flex-wrap gap-6 items-start">
          <div className="flex gap-4 flex-wrap">
            <ScoreRing score={analise.scoreGeral} label="Saúde geral" size={88} />
            <ScoreRing score={analise.scoreFin} label="Dinheiro" size={76} />
            <ScoreRing score={analise.scoreCria} label="Criativos" size={76} />
            <ScoreRing score={analise.scoreAnom} label="Desempenho" size={76} />
          </div>
          <div className="flex-1 min-w-[240px] bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="text-sm leading-relaxed text-gray-800">{analise.resumo}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-[11px] bg-white border border-gray-200 px-2 py-1 rounded-lg">
                CTR {analise.ctrGlobal.toFixed(2)}%
              </span>
              <span className="text-[11px] bg-white border border-gray-200 px-2 py-1 rounded-lg">
                CPC {fmt(analise.cpcMeta)}
              </span>
              {analise.freqMedia > 0 && (
                <span className="text-[11px] bg-white border border-gray-200 px-2 py-1 rounded-lg">
                  Frequência ~{analise.freqMedia.toFixed(1)}x
                </span>
              )}
              {analise.totalCliquesExternos > 0 && (
                <span className="text-[11px] bg-white border border-gray-200 px-2 py-1 rounded-lg">
                  {analise.totalCliquesExternos} cliques no link
                </span>
              )}
            </div>
          </div>
        </div>

        <SectionToggle
          open={exp.alertas}
          onToggle={() => toggle("alertas")}
          title={`Problemas encontrados (${analise.alertas.length})`}
          hint="Coisas que podem estar prejudicando seu lucro"
        />
        {exp.alertas && (
          analise.alertas.length === 0
            ? (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
                Nenhum problema grave detectado. Continue monitorando.
              </p>
            )
            : analise.alertas.map((a, i) => <InsightAlertCard key={i} item={a} />)
        )}

        <SectionToggle
          open={exp.oport}
          onToggle={() => toggle("oport")}
          title={`Oportunidades (${analise.oportunidades.length})`}
          hint="O que está funcionando e pode crescer"
        />
        {exp.oport && (
          analise.oportunidades.length === 0
            ? <p className="text-xs text-gray-500 px-1">Nenhuma oportunidade clara ainda — corrija os alertas primeiro.</p>
            : analise.oportunidades.map((o, i) => <OportunidadeCard key={i} op={o} />)
        )}

        {analise.insights.length > 0 && (
          <>
            <SectionToggle
              open={exp.insights}
              onToggle={() => toggle("insights")}
              title="Comparativo de criativos"
              hint="Diferença entre anúncios que performam bem e mal"
            />
            {exp.insights && analise.insights.map((ins, i) => {
              const d = ins.dados;
              return (
                <div key={i} className="bg-violet-50 border border-violet-100 rounded-xl p-4 text-xs text-violet-900">
                  <p className="font-semibold mb-2">{ins.titulo}</p>
                  <p>
                    Seus melhores anúncios têm estrutura de texto nota <strong>{d.aidaTop}/100</strong>;
                    os piores, <strong>{d.aidaBottom}/100</strong>.
                  </p>
                  {d.melhor && <p className="mt-1">Referência boa: <em>{d.melhor.substring(0, 55)}…</em></p>}
                </div>
              );
            })}
          </>
        )}

        <SectionToggle open={exp.passos} onToggle={() => toggle("passos")} title="Plano de ação (passo a passo)" hint="" />
        {exp.passos && (
          <ol className="space-y-2 list-none pl-0">
            {analise.passos.map((p, i) => (
              <li key={i} className="flex gap-3 bg-indigo-50/50 border border-indigo-100 rounded-xl px-4 py-3">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-800 leading-relaxed">{p}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

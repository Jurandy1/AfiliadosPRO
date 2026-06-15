import { useEffect, useState } from "react";
import { Activity, Globe, Monitor, RotateCcw } from "lucide-react";
import {
  resetReadTracker,
  setReadTrackerEnabled,
  subscribeReadTracker,
} from "../../services/firebase/readTracker";
import { subscribeGlobalUsage } from "../../services/firebase/firestoreUsageSync";

const PERIOD_LABELS = {
  all: "Todo período",
  ontem: "Ontem",
  "7d": "7 dias",
  "14d": "14 dias",
  "30d": "30 dias",
  mes_atual: "Este mês",
  mes_anterior: "Mês anterior",
  custom: "Personalizado",
};

function BarRow({ label, reads = 0, writes = 0, total, tone = "slate" }) {
  const ops = reads + writes;
  const pct = total > 0 ? Math.min(100, (ops / total) * 100) : 0;
  const colors = {
    rose: "bg-rose-500",
    amber: "bg-amber-500",
    slate: "bg-slate-600",
    teal: "bg-teal-600",
    violet: "bg-violet-600",
  };
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-[11px]">
        <span className="text-slate-700 truncate font-medium" title={label}>{label}</span>
        <span className="text-slate-500 shrink-0 tabular-nums">
          {reads > 0 && `${reads.toLocaleString("pt-BR")}L`}
          {reads > 0 && writes > 0 && " · "}
          {writes > 0 && `${writes.toLocaleString("pt-BR")}G`}
          {ops === 0 && "0"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${colors[tone] || colors.slate}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, danger = false }) {
  return (
    <div className={`border rounded-lg p-3 ${danger ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200"}`}>
      <div className="text-[10px] text-slate-400 uppercase font-bold">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums ${danger ? "text-rose-700" : "text-slate-900"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default function FirestoreReadDiagnostics() {
  const [stats, setStats] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [view, setView] = useState("global");

  useEffect(() => {
    const unsubGlobal = subscribeGlobalUsage(() => {});
    const unsubLocal = subscribeReadTracker(setStats);
    return () => {
      unsubGlobal();
      unsubLocal();
    };
  }, []);

  useEffect(() => {
    if (stats) setEnabled(stats.enabled);
  }, [stats]);

  const global = stats?.globalToday;
  const sessionReads = stats?.totalReads || 0;
  const sessionWrites = stats?.totalWrites || 0;
  const globalReads = global?.reads ?? 0;
  const globalWrites = global?.writes ?? 0;
  const dangerGlobalReads = (global?.projectedDailyReads ?? 0) > (stats?.freeTierDailyReads ?? 50000);
  const dangerGlobalWrites = (global?.projectedDailyWrites ?? 0) > (stats?.freeTierDailyWrites ?? 20000);

  const activeCollections = view === "global"
    ? (global?.collections || [])
    : (stats?.byCollection || []);
  const activeSources = view === "global"
    ? (global?.sources || [])
    : (stats?.bySource || []);
  const activeOps = view === "global"
    ? (global?.ops || [])
    : (stats?.byOp || []);
  const activePeriods = view === "global"
    ? (global?.periods || [])
    : (stats?.byPeriod || []);
  const activeTotal = view === "global"
    ? globalReads + globalWrites
    : sessionReads + sessionWrites;

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionHeading icon={Activity} title="Diagnóstico Firestore" />
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">
            Rastreamento <strong>sempre ativo</strong> em todas as telas. Conta leituras e gravações do app
            e agrega o total do dia em <code className="text-[10px] bg-slate-100 px-1 rounded">firestore_usage</code>
            — qualquer pessoa/dispositivo que usar o sistema soma no mesmo contador global (BRT).
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setReadTrackerEnabled(e.target.checked)}
          />
          Rastrear operações
        </label>
      </div>

      {!enabled && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Rastreamento desligado — ligue para medir leituras e gravações.
        </div>
      )}

      {enabled && stats && (
        <>
          <div className="flex flex-wrap gap-2">
            <TabButton active={view === "global"} onClick={() => setView("global")} icon={Globe}>
              Global hoje
            </TabButton>
            <TabButton active={view === "session"} onClick={() => setView("session")} icon={Monitor}>
              Esta aba
            </TabButton>
          </div>

          {view === "global" ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard
                label="Leituras hoje"
                value={globalReads.toLocaleString("pt-BR")}
                sub={`${stats.globalPctReadsOfFreeTier}% da cota (${stats.freeTierDailyReads.toLocaleString("pt-BR")})`}
                danger={dangerGlobalReads}
              />
              <MetricCard
                label="Gravações hoje"
                value={globalWrites.toLocaleString("pt-BR")}
                sub={`${stats.globalPctWritesOfFreeTier}% da cota (${stats.freeTierDailyWrites.toLocaleString("pt-BR")})`}
                danger={dangerGlobalWrites}
              />
              <MetricCard
                label="Sessões hoje"
                value={String(global?.sessions ?? 0)}
                sub="browsers/dispositivos distintos"
              />
              <MetricCard
                label="Projeção leituras 24h"
                value={(global?.projectedDailyReads ?? 0).toLocaleString("pt-BR")}
                sub="ritmo global de hoje"
                danger={dangerGlobalReads}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard label="Leituras (aba)" value={sessionReads.toLocaleString("pt-BR")} sub="persiste ao recarregar no mesmo dia" />
              <MetricCard label="Gravações (aba)" value={sessionWrites.toLocaleString("pt-BR")} />
              <MetricCard
                label="Poupadas pelo Cache"
                value={(stats.totalCacheHits || 0).toLocaleString("pt-BR")}
                sub="Evitadas no Firestore hoje"
                danger={false}
              />
              <MetricCard
                label="Leituras/min"
                value={stats.readsPerMinute.toLocaleString("pt-BR")}
              />
            </div>
          )}

          {(stats.byCollection?.find((r) => r.key === "produtos")?.reads || 0) > 15_000 && view === "session" && (
            <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <strong>produtos</strong> com scan alto nesta aba — evite refresh forçado em períodos longos.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resetReadTracker()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
            >
              <RotateCcw size={14} />
              Zerar contador desta aba
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">Por coleção</div>
              {activeCollections.length === 0 ? (
                <p className="text-[11px] text-slate-400">Navegue no app para registrar operações.</p>
              ) : (
                activeCollections.slice(0, 10).map((row) => (
                  <BarRow
                    key={row.key}
                    label={row.key}
                    reads={row.reads}
                    writes={row.writes}
                    total={activeTotal}
                    tone="rose"
                  />
                ))
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">Por arquivo (origem)</div>
              {activeSources.length === 0 ? (
                <p className="text-[11px] text-slate-400">Mostra qual arquivo disparou a operação.</p>
              ) : (
                activeSources.slice(0, 10).map((row) => (
                  <BarRow
                    key={row.key}
                    label={row.key}
                    reads={row.reads}
                    writes={row.writes}
                    total={activeTotal}
                    tone="teal"
                  />
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeOps.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-700">Por operação</div>
                {activeOps.slice(0, 8).map((row) => (
                  <BarRow
                    key={row.key}
                    label={row.key}
                    reads={row.reads}
                    writes={row.writes}
                    total={activeTotal}
                    tone="violet"
                  />
                ))}
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">Por filtro de período</div>
              {activePeriods.length === 0 ? (
                <p className="text-[11px] text-slate-400">Nenhum período registrado ainda.</p>
              ) : (
                activePeriods.map((row) => (
                  <BarRow
                    key={row.key}
                    label={row.key}
                    reads={row.reads}
                    writes={row.writes}
                    total={activeTotal}
                    tone="amber"
                  />
                ))
              )}
            </div>
          </div>

          {view === "session" && stats.recentEvents.length > 0 && (
            <details className="bg-white border border-slate-200 rounded-lg">
              <summary className="px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer">
                Últimas {stats.recentEvents.length} operações (esta aba)
              </summary>
              <div className="max-h-52 overflow-auto border-t border-slate-100">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-slate-50 text-slate-400">
                    <tr>
                      <th className="text-left px-2 py-1">Hora (ms)</th>
                      <th className="text-left px-2 py-1">Tipo</th>
                      <th className="text-left px-2 py-1">Op</th>
                      <th className="text-left px-2 py-1">Coleção</th>
                      <th className="text-right px-2 py-1">Qtd</th>
                      <th className="text-left px-2 py-1">Período</th>
                      <th className="text-left px-2 py-1">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentEvents.map((ev, i) => (
                      <tr key={`${ev.ts}-${i}`} className={`border-t border-slate-50 ${ev.nPlusOneAlert ? "bg-rose-100" : ""}`}>
                        <td className="px-2 py-1 text-slate-400 tabular-nums">
                          {new Date(ev.ts).toLocaleTimeString("pt-BR")}
                          {ev.durationMs > 0 && <span className="text-slate-300 ml-1">({ev.durationMs}ms)</span>}
                        </td>
                        <td className="px-2 py-1 text-slate-500">
                          {ev.kind === "cache" ? "C" : (ev.kind === "write" ? "G" : "L")}
                        </td>
                        <td className={`px-2 py-1 text-slate-500 ${ev.nPlusOneAlert ? "font-bold text-rose-700" : ""}`}>
                          {ev.burstCount > 1 && <strong className="text-indigo-600 mr-1">[{ev.burstCount}x]</strong>}
                          {ev.op}
                          {ev.nPlusOneAlert && <span className="ml-1 text-rose-600" title="Gargalo detectado: muitas requisições isoladas! Use getDocs(in).">⚠️ N+1</span>}
                        </td>
                        <td className="px-2 py-1 font-medium">{ev.collection}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{ev.docs}</td>
                        <td className="px-2 py-1 font-semibold text-amber-700">{PERIOD_LABELS[ev.period] || ev.period || "—"}</td>
                        <td className="px-2 py-1 text-slate-600 truncate max-w-[160px]" title={ev.source}>{ev.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <p className="text-[10px] text-slate-400">
            Console:{" "}
            <code className="bg-slate-100 px-1 rounded">window.__afiliaFirestoreTracker.snapshot()</code>
            {" · "}
            L = leitura, G = gravação, C = cache local. Flush global a cada ~15s.
          </p>
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
      }`}
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

function SectionHeading({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={16} className="text-slate-600" />
      <h4 className="text-sm font-bold text-slate-900">{title}</h4>
    </div>
  );
}

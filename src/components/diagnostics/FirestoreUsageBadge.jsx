import { useEffect, useState } from "react";
import { Activity, Database } from "lucide-react";
import { subscribeReadTracker } from "../../services/firebase/readTracker";

export default function FirestoreUsageBadge({ onOpenSettings }) {
  const [stats, setStats] = useState(null);

  useEffect(() => subscribeReadTracker(setStats), []);

  if (!stats?.enabled) return null;

  const global = stats.globalToday;
  const reads = global?.reads ?? stats.totalReads;
  const writes = global?.writes ?? stats.totalWrites;
  const dangerReads = (global?.projectedDailyReads ?? stats.projectedDailyReads) > stats.freeTierDailyReads;
  const dangerWrites = (global?.projectedDailyWrites ?? stats.projectedDailyWrites) > stats.freeTierDailyWrites;
  const danger = dangerReads || dangerWrites;

  return (
    <button
      type="button"
      onClick={() => (typeof onOpenSettings === "function" ? onOpenSettings() : null)}
      className={`hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
        danger
          ? "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100"
          : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
      }`}
      title="Diagnóstico Firestore — clique para ver detalhes em Configurações"
    >
      <Database size={13} className={danger ? "text-rose-600" : "text-slate-500"} />
      <span className="tabular-nums">
        {reads.toLocaleString("pt-BR")}L
        {" · "}
        {writes.toLocaleString("pt-BR")}G
      </span>
      {global?.sessions > 1 && (
        <span className="text-[10px] text-slate-400 font-medium">{global.sessions} sessões</span>
      )}
      <span className={`relative flex h-1.5 w-1.5 ${danger ? "" : "opacity-70"}`}>
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${danger ? "bg-rose-400" : "bg-emerald-400"}`} />
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${danger ? "bg-rose-500" : "bg-emerald-500"}`} />
      </span>
    </button>
  );
}

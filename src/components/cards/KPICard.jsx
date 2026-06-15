export default function KPICard({
  icon,
  iconBg,
  label,
  value,
  trend,
  subTrend,
  up,
  down,
  badge,
  accentTop = "border-t-indigo-500",
  tint = "from-indigo-50/50",
  variant = "default",
}) {
  const isDanger = variant === "danger";

  return (
    <div
      className={`rounded-2xl border shadow-premium p-5 transition-all duration-200 hover:shadow-card-hover border-t-4 ${
        isDanger
          ? "bg-rose-50/50 border-rose-200 border-t-red-500"
          : `surface-card-elevated ${accentTop} bg-gradient-to-br ${tint} to-white`
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={`text-xs font-bold uppercase tracking-wider ${isDanger ? "text-red-700" : "text-slate-400"}`}>
          {label}
        </span>
        {badge && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
            isDanger ? "bg-red-500 text-white" : "bg-slate-100 text-slate-700"
          }`}>
            {badge}
          </span>
        )}
      </div>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-2xl font-extrabold mt-1 tracking-tight ${
            isDanger ? "text-red-700" : down ? "text-red-600" : up ? "text-emerald-600" : "text-slate-900"
          }`}>
            {value}
          </div>
          {trend && (
            <div className={`text-[11px] mt-2 font-semibold ${isDanger ? "text-red-600" : down ? "text-red-600" : up ? "text-emerald-600" : "text-slate-500"}`}>
              {trend}
            </div>
          )}
          {subTrend && (
            <div className={`text-[11px] mt-0.5 whitespace-pre-line ${isDanger ? "text-red-500" : "text-slate-400"}`}>
              {subTrend}
            </div>
          )}
        </div>
        {icon && !isDanger && (
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${iconBg}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

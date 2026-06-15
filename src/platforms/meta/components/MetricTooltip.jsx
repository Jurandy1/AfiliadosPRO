import { HelpCircle } from "lucide-react";
import { TRAFFIC_GLOSSARY } from "../traffic/trafficGlossary";

export default function MetricTooltip({ metricKey, className = "" }) {
  const g = TRAFFIC_GLOSSARY[metricKey];
  if (!g) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 group relative ${className}`}
      title={`${g.title}: ${g.text}`}
    >
      <span>{g.label}</span>
      <HelpCircle size={11} className="text-gray-400 shrink-0" />
      <span className="pointer-events-none absolute bottom-full left-0 mb-1 hidden group-hover:block z-20 w-56 p-2 text-[11px] leading-snug bg-gray-900 text-white rounded-lg shadow-lg">
        <strong className="block text-cyan-200 mb-0.5">{g.title}</strong>
        {g.text}
      </span>
    </span>
  );
}

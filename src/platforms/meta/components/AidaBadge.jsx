import { avaliarAIDA } from "../traffic/trafficAnalysis";

export default function AidaBadge({ nome }) {
  const aida = avaliarAIDA(nome);
  const color = aida.total >= 60 ? "#16A34A" : aida.total >= 35 ? "#D97706" : "#DC2626";
  const label = aida.total >= 60 ? "Bom texto" : aida.total >= 35 ? "Texto fraco" : "Sem CTA";
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
      style={{ background: `${color}18`, color }}
      title="Nota da estrutura do texto (Atenção → Interesse → Desejo → Ação)"
    >
      {label} {aida.total}
    </span>
  );
}

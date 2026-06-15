const styles = {
  Escalando: "bg-emerald-100 text-emerald-700",
  Validando: "bg-blue-100 text-blue-700",
  Pausado: "bg-gray-100 text-gray-600",
  "Sem Estoque": "bg-red-100 text-red-700",
  Shopee: "bg-orange-100 text-orange-700",
  Alta: "bg-emerald-100 text-emerald-700",
  Média: "bg-yellow-100 text-yellow-700",
  Baixa: "bg-red-100 text-red-700",
};

export default function Badge({ text, variant }) {
  const cls = styles[variant || text] || "bg-gray-100 text-gray-600";
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{text}</span>
  );
}

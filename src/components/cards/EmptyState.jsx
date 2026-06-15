import { ShoppingBag } from "lucide-react";

export default function EmptyState() {
  return (
    <div className="surface-card p-12 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-50 flex items-center justify-center">
        <ShoppingBag className="text-indigo-400" size={32} />
      </div>
      <h3 className="text-lg font-bold text-slate-800 mb-2">Nenhum produto cadastrado</h3>
      <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
        Comece importando seus CSVs da Shopee na aba Importar
      </p>
    </div>
  );
}

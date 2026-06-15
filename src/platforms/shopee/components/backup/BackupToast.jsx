import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export default function BackupToast({ mensagem, tipo = "info", onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4500);
    return () => clearTimeout(timer);
  }, [onClose]);

  const cores = {
    sucesso: "bg-emerald-600 text-white shadow-lg shadow-emerald-600/25",
    erro: "bg-rose-600 text-white shadow-lg shadow-rose-600/25",
    info: "bg-slate-900 text-white shadow-lg shadow-slate-900/25",
    aviso: "bg-amber-50 text-slate-950 border border-amber-200 shadow-lg",
  };

  const Icon = tipo === "sucesso" ? CheckCircle2 : tipo === "info" ? Info : AlertTriangle;

  return (
    <div className={`fixed z-50 flex items-center gap-3 px-4 py-3 rounded-xl left-3 right-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md ${cores[tipo] || cores.info}`}>
      <Icon size={18} />
      <span className="text-xs font-bold tracking-wide">{mensagem}</span>
      <button type="button" onClick={onClose} className="hover:opacity-70 ml-1 p-0.5" aria-label="Fechar">
        <X size={15} />
      </button>
    </div>
  );
}

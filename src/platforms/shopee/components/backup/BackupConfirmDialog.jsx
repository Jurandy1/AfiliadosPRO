import { AlertTriangle } from "lucide-react";

export default function BackupConfirmDialog({ isOpen, titulo, mensagem, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-[110] p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl border border-slate-100 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-3 text-amber-600 mb-3">
          <AlertTriangle className="shrink-0" size={24} />
          <h4 className="font-extrabold text-slate-900 text-base">{titulo}</h4>
        </div>
        <p className="text-slate-600 text-xs leading-relaxed mb-6 font-medium">{mensagem}</p>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="w-full sm:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

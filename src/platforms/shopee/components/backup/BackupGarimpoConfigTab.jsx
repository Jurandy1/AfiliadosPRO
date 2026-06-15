import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, Zap } from "lucide-react";
import { fmt } from "../../../../utils/formatters";
import {
  calcFaixaPrecoGarimpo,
  DEFAULT_BACKUP_GARIMPO_SETTINGS,
  parsePrecoGarimpo,
  readBackupGarimpoSettings,
  writeBackupGarimpoSettings,
} from "../../utils/backupGarimpoSettings";

export default function BackupGarimpoConfigTab({ showToast }) {
  const [form, setForm] = useState(readBackupGarimpoSettings);
  const [exemploPreco, setExemploPreco] = useState("99.90");

  useEffect(() => {
    writeBackupGarimpoSettings(form);
  }, [form.precoToleranciaAcimaPct, form.precoToleranciaAbaixoPct]);

  const faixaExemplo = useMemo(() => {
    return calcFaixaPrecoGarimpo(parsePrecoGarimpo(exemploPreco), form);
  }, [exemploPreco, form]);

  const restaurarPadrao = useCallback(() => {
    setForm({ ...DEFAULT_BACKUP_GARIMPO_SETTINGS });
    showToast?.("Configurações do garimpo restauradas.", "sucesso");
  }, [showToast]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white border border-violet-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-violet-900 font-extrabold text-sm mb-1">
          <Zap size={16} className="text-violet-600" />
          Robô de Garimpo — ofertas semelhantes
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Define a faixa de <strong>preço do produto em R$</strong> (não comissão) em relação ao principal
          do grupo. Ofertas fora dessa faixa não aparecem nas sugestões automáticas.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-xs text-slate-700 block">
            Até quanto % <strong>mais caro</strong> que o principal?
            <div className="mt-2 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={form.precoToleranciaAcimaPct}
                onChange={(e) => setForm((p) => ({ ...p, precoToleranciaAcimaPct: Number(e.target.value) }))}
                className="flex-1 accent-violet-600"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={form.precoToleranciaAcimaPct}
                onChange={(e) => setForm((p) => ({ ...p, precoToleranciaAcimaPct: Number(e.target.value || 0) }))}
                className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold"
              />
              <span className="text-slate-500 font-semibold">%</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Ex.: 15% → principal R$ 100 aceita até R$ 115
            </span>
          </label>

          <label className="text-xs text-slate-700 block">
            Até quanto % <strong>mais barato</strong> que o principal?
            <div className="mt-2 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                value={form.precoToleranciaAbaixoPct}
                onChange={(e) => setForm((p) => ({ ...p, precoToleranciaAbaixoPct: Number(e.target.value) }))}
                className="flex-1 accent-violet-600"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={form.precoToleranciaAbaixoPct}
                onChange={(e) => setForm((p) => ({ ...p, precoToleranciaAbaixoPct: Number(e.target.value || 0) }))}
                className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold"
              />
              <span className="text-slate-500 font-semibold">%</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Ex.: 25% → principal R$ 100 aceita a partir de R$ 75
            </span>
          </label>
        </div>

        <div className="mt-5 p-3 bg-violet-50/80 border border-violet-100 rounded-xl">
          <div className="text-[10px] font-bold text-violet-800 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Settings size={12} />
            Simulador
          </div>
          <label className="text-xs text-slate-600 block mb-2">
            Preço do produto principal (R$)
            <input
              type="text"
              inputMode="decimal"
              value={exemploPreco}
              onChange={(e) => setExemploPreco(e.target.value)}
              className="mt-1 w-full max-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"
            />
          </label>
          {faixaExemplo ? (
            <p className="text-sm text-slate-800">
              Garimpo aceita ofertas entre{" "}
              <strong>{fmt(faixaExemplo.min)}</strong> e <strong>{fmt(faixaExemplo.max)}</strong>
            </p>
          ) : (
            <p className="text-xs text-slate-500">Informe um preço válido para ver a faixa.</p>
          )}
        </div>

        <button
          type="button"
          onClick={restaurarPadrao}
          className="mt-4 text-xs font-semibold text-slate-500 hover:text-violet-700 underline"
        >
          Restaurar padrão ({DEFAULT_BACKUP_GARIMPO_SETTINGS.precoToleranciaAcimaPct}% / {DEFAULT_BACKUP_GARIMPO_SETTINGS.precoToleranciaAbaixoPct}%)
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        Salvo automaticamente neste navegador. Vale para o bloco &quot;Robô de Garimpo&quot; dentro dos grupos/ninhos.
      </p>
    </div>
  );
}

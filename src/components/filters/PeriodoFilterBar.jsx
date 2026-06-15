import { useEffect, useState } from "react";
import AlertasBell from "../AlertasBell";
import BrDateInput from "./BrDateInput";
import { brtMaxDataSelecionavel, formatDateDisplayPT } from "../../utils/dates";
import {
  calcularRangePeriodo,
  labelPeriodoAtivo,
  labelPeriodoPreset,
  periodoTemFiltro,
} from "../../utils/periodoFiltro";
import { CalendarRange, ChevronDown, Loader2, RefreshCw } from "lucide-react";

const PRESETS = [
  { id: "all", label: "Todo período" },
  { id: "ontem", label: "Ontem" },
  { id: "7d", label: "7 dias" },
  { id: "14d", label: "14 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes_atual", label: "Este mês" },
  { id: "mes_anterior", label: "Mês anterior" },
];

const MAX_DATA = brtMaxDataSelecionavel();

function PresetChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap ${
        active
          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/30"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function PeriodoFilterBar({
  periodoFiltro,
  rangeDraft,
  rangeApplied,
  rangeErro,
  customPendente,
  atualizandoPeriodo,
  throttleRefreshMs = 0,
  onPreset,
  onDraftChange,
  onApplyCustom,
  onClearCustom,
  onRefreshOntem,
  modoAllCacheLabel,
  trailing,
  embedded = false,
}) {
  const rangeAtivo = calcularRangePeriodo(periodoFiltro, rangeApplied);
  const labelAtivo = labelPeriodoAtivo(periodoFiltro, rangeApplied);
  const filtroAtivo = periodoTemFiltro(periodoFiltro) && Boolean(rangeAtivo);
  const labelExibicao = periodoFiltro === "custom" ? labelAtivo : labelPeriodoPreset(periodoFiltro);
  const [customAberto, setCustomAberto] = useState(periodoFiltro === "custom" || customPendente);

  useEffect(() => {
    if (periodoFiltro === "custom" || customPendente) setCustomAberto(true);
  }, [periodoFiltro, customPendente]);

  const resumoPeriodo = filtroAtivo ? labelAtivo : "Selecione um intervalo";
  const subtituloPreset = periodoFiltro !== "all" && periodoFiltro !== "custom" && filtroAtivo
    ? labelExibicao
    : periodoFiltro === "custom"
      ? "Intervalo personalizado"
      : labelExibicao;

  const presetStrip = (
    <div
      className={`flex items-center gap-1 p-1 rounded-xl border border-slate-200/90 bg-slate-50/80 ${
        embedded ? "min-w-0 flex-1 overflow-x-auto scrollbar-thin" : "inline-flex flex-wrap"
      }`}
    >
      {PRESETS.map((opt) => (
        <PresetChip
          key={opt.id}
          active={periodoFiltro === opt.id}
          onClick={() => onPreset(opt.id)}
        >
          {opt.label}
          {opt.id === "all" && periodoFiltro === "all" && modoAllCacheLabel ? (
            <span className="ml-1 text-[10px] opacity-80">· {modoAllCacheLabel}</span>
          ) : null}
        </PresetChip>
      ))}
    </div>
  );

  const acoesDireita = (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => setCustomAberto((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
          periodoFiltro === "custom" || customAberto
            ? "border-indigo-200 bg-indigo-50 text-indigo-800"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        <CalendarRange size={14} className="shrink-0" />
        <span className="hidden sm:inline">Personalizado</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${customAberto ? "rotate-180" : ""}`} />
      </button>

      {periodoFiltro === "ontem" && onRefreshOntem ? (
        <button
          type="button"
          onClick={onRefreshOntem}
          disabled={atualizandoPeriodo || throttleRefreshMs > 0}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {atualizandoPeriodo ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {atualizandoPeriodo
            ? "Sync…"
            : throttleRefreshMs > 0
              ? `${Math.ceil(throttleRefreshMs / 1000)}s`
              : "Atualizar"}
        </button>
      ) : null}

      {atualizandoPeriodo && periodoFiltro !== "ontem" ? (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-100">
          <Loader2 size={12} className="animate-spin" />
          Carregando…
        </span>
      ) : null}

      {trailing}
      <AlertasBell />
    </div>
  );

  const painelCustom = customAberto && (
    <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <BrDateInput
          label="Data inicial"
          compact
          value={rangeDraft.start}
          max={MAX_DATA}
          onChange={(iso) => onDraftChange({ ...rangeDraft, start: iso })}
        />
        <BrDateInput
          label="Data final"
          compact
          value={rangeDraft.end}
          min={rangeDraft.start || undefined}
          max={MAX_DATA}
          onChange={(iso) => onDraftChange({ ...rangeDraft, end: iso })}
        />
        <button
          type="button"
          onClick={onApplyCustom}
          disabled={!rangeDraft.start || !rangeDraft.end}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed shadow-sm"
        >
          Aplicar período
        </button>
        {periodoFiltro === "custom" && (
          <button
            type="button"
            onClick={onClearCustom}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Limpar
          </button>
        )}
        <span className="text-[11px] text-slate-400 sm:ml-auto">
          Dados disponíveis até {formatDateDisplayPT(MAX_DATA)}
        </span>
      </div>
      {customPendente && rangeDraft.start && rangeDraft.end && (
        <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
          Intervalo selecionado — clique em <strong>Aplicar período</strong> para atualizar o painel.
        </p>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="space-y-2.5" lang="pt-BR">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 lg:gap-4">
          <div className="flex items-center gap-3 min-w-0 shrink-0 lg:w-[220px] xl:w-[240px]">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <CalendarRange size={16} className="text-indigo-600" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {subtituloPreset}
              </div>
              <div className="text-sm font-semibold text-slate-800 truncate" title={resumoPeriodo}>
                {resumoPeriodo}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 flex-1">
            {presetStrip}
            {acoesDireita}
          </div>
        </div>

        {painelCustom}

        {rangeErro && (
          <div className="p-3 bg-amber-50/90 border border-amber-200/50 rounded-xl text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm backdrop-blur-sm transition-all duration-300">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span>{rangeErro}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onPreset("mes_atual")}
                className="px-2.5 py-1 rounded bg-white hover:bg-slate-50 border border-slate-200 text-[10px] font-semibold text-slate-700 transition-colors"
              >
                Este mês
              </button>
              <button
                type="button"
                onClick={() => onPreset("all")}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-[10px] font-semibold text-white transition-colors"
              >
                Todo período
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="surface-card px-4 py-3 mb-3 border border-slate-200/80 relative overflow-hidden" lang="pt-BR">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-[11px] font-bold uppercase text-slate-500 tracking-wide shrink-0">Período</span>
        {filtroAtivo && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-[11px] text-indigo-900 font-medium max-w-full truncate">
            {labelExibicao}
            {periodoFiltro !== "all" && periodoFiltro !== "custom" ? (
              <span className="text-indigo-600/80 ml-1.5">· {labelAtivo}</span>
            ) : null}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {presetStrip}
        {acoesDireita}
      </div>

      {painelCustom && <div className="mt-3">{painelCustom}</div>}

      {rangeErro && (
        <div className="mt-3 p-3 bg-amber-50/90 border border-amber-200/50 rounded-xl text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm backdrop-blur-sm transition-all duration-300">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span>{rangeErro}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPreset("mes_atual")}
              className="px-2.5 py-1 rounded bg-white hover:bg-slate-50 border border-slate-200 text-[10px] font-semibold text-slate-700 transition-colors"
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => onPreset("all")}
              className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-[10px] font-semibold text-white transition-colors"
            >
              Todo período
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

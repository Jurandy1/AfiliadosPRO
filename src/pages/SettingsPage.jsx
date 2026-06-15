import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Receipt, SlidersHorizontal } from "lucide-react";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import SectionTitle from "../components/ui/SectionTitle";
import FirestoreReadDiagnostics from "../components/diagnostics/FirestoreReadDiagnostics";
import SyncStatusPanel from "../components/settings/SyncStatusPanel";
import { getDashboardKPIsByPeriod } from "../platforms/dashboard/repositories/metricsRepository";
import { brtMonthLabelPT } from "../utils/dates";
import { fmt } from "../utils/formatters";
import { calcularRangePeriodo } from "../utils/periodoFiltro";

const SHOPEE_BONUS_CAP = 100_000;

/** Faixas oficiais: % do bônus sobre o faturamento real; teto R$ 100 mil. */
function shopeeBonusTiers(metaBase) {
  const m = Number(metaBase) || 0;
  if (m <= 0) return [];
  return [
    { id: 1, label: "100% da meta", fator: 1, pct: 1, threshold: m },
    { id: 2, label: "125% da meta (+25%)", fator: 1.25, pct: 2, threshold: m * 1.25 },
    { id: 3, label: "150% da meta (+50%)", fator: 1.5, pct: 3, threshold: m * 1.5 },
  ];
}

function calcShopeeBonus(faturamento, metaBase) {
  const fat = Number(faturamento) || 0;
  const tiers = shopeeBonusTiers(metaBase);
  if (!tiers.length || fat <= 0) {
    return { tier: null, pct: 0, bruto: 0, liquido: 0, capped: false };
  }
  let active = null;
  for (const t of tiers) {
    if (fat >= t.threshold) active = t;
  }
  if (!active) {
    return { tier: null, pct: 0, bruto: 0, liquido: 0, capped: false, falta: tiers[0].threshold - fat };
  }
  const bruto = fat * (active.pct / 100);
  const liquido = Math.min(bruto, SHOPEE_BONUS_CAP);
  return {
    tier: active,
    pct: active.pct,
    bruto,
    liquido,
    capped: bruto > SHOPEE_BONUS_CAP,
    falta: null,
  };
}

export default function SettingsPage() {
  const read = () => {
    try {
      const raw = window.localStorage.getItem("afilia:settings");
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        roiMinimo: typeof parsed.roiMinimo === "number" ? parsed.roiMinimo : 0.5,
        metaMensal: typeof parsed.metaMensal === "number" ? parsed.metaMensal : 10000,
        impostoMeta: typeof parsed.impostoMeta === "number" ? parsed.impostoMeta : 0,
        impostoNf: typeof parsed.impostoNf === "number" ? parsed.impostoNf : 0,
      };
    } catch {
      return { roiMinimo: 0.5, metaMensal: 10000, impostoMeta: 0, impostoNf: 0 };
    }
  };

  const [form, setForm] = useState(read);
  const [fatBrutoMes, setFatBrutoMes] = useState(null);
  const [fatLoading, setFatLoading] = useState(true);
  const [fatErro, setFatErro] = useState(null);
  const [mesRefLabel, setMesRefLabel] = useState("");

  useEffect(() => {
    window.localStorage.setItem("afilia:settings", JSON.stringify(form));
  }, [form]);

  const carregarFatBrutoMes = useCallback(async () => {
    const range = calcularRangePeriodo("mes_atual", { start: "", end: "" });
    if (!range) {
      setFatBrutoMes(0);
      setMesRefLabel("");
      setFatLoading(false);
      return;
    }
    setMesRefLabel(brtMonthLabelPT(range.yearMonth));
    setFatLoading(true);
    setFatErro(null);
    try {
      const kpis = await getDashboardKPIsByPeriod(range.startDate, range.endDate);
      setFatBrutoMes(Number(kpis?.fatBruto ?? 0));
    } catch (err) {
      setFatErro(err?.message || "Não foi possível carregar o Fat. Bruto do mês.");
      setFatBrutoMes(0);
    } finally {
      setFatLoading(false);
    }
  }, []);

  useEffect(() => {
    carregarFatBrutoMes();
  }, [carregarFatBrutoMes]);

  const fatMes = Number(fatBrutoMes) || 0;
  const bonusSim = useMemo(
    () => calcShopeeBonus(fatMes, form.metaMensal),
    [fatMes, form.metaMensal],
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-4xl">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Configurações</h3>
      <p className="text-xs text-gray-500 mb-5">
        Estas configurações impactam o dashboard (ROI mínimo, meta mensal e impostos).
      </p>

      <div className="grid grid-cols-1 gap-4">
        <div className="border border-gray-100 rounded-lg p-4">
          <SectionTitle icon={SlidersHorizontal} className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
            Configurações
          </SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">
              ROI mínimo aceitável
              <div className="flex items-center gap-3 mt-2">
                <input
                  type="range"
                  min={-1}
                  max={5}
                  step={0.05}
                  value={form.roiMinimo}
                  onChange={(e) => setForm((p) => ({ ...p, roiMinimo: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <span className="font-semibold text-gray-800 w-16 text-right">{(form.roiMinimo * 100).toFixed(0)}%</span>
              </div>
            </label>

            <label className="text-xs text-gray-600">
              Meta mensal de faturamento (R$)
              <input
                type="number"
                min={0}
                step={100}
                value={form.metaMensal}
                onChange={(e) => setForm((p) => ({ ...p, metaMensal: parseFloat(e.target.value || "0") }))}
                className="mt-2 w-full border border-gray-200 rounded px-3 py-2 text-sm"
              />
            </label>
          </div>
        </div>

        <div className="border border-gray-100 rounded-lg p-4">
          <SectionTitle icon={Receipt} className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
            Impostos
          </SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">
              Imposto Meta Ads (%)
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={form.impostoMeta}
                onChange={(e) => setForm((p) => ({ ...p, impostoMeta: parseFloat(e.target.value || "0") }))}
                className="mt-2 w-full border border-gray-200 rounded px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-gray-600">
              Imposto Nota Fiscal (%)
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={form.impostoNf}
                onChange={(e) => setForm((p) => ({ ...p, impostoNf: parseFloat(e.target.value || "0") }))}
                className="mt-2 w-full border border-gray-200 rounded px-3 py-2 text-sm"
              />
            </label>
          </div>

          {(form.impostoMeta > 0 || form.impostoNf > 0) && (
            <div className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Impostos ativos — {form.impostoMeta.toFixed(1)}% Meta Ads · {form.impostoNf.toFixed(1)}% NF
            </div>
          )}
        </div>

        {form.metaMensal > 0 && (
          <div className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <SectionTitle icon={Gift} className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                Bônus Shopee
              </SectionTitle>
              {mesRefLabel && (
                <span className="text-[10px] text-gray-500 capitalize">{mesRefLabel}</span>
              )}
            </div>
            {fatLoading ? (
              <LoadingSpinner label="Carregando..." className="py-3" />
            ) : fatErro ? (
              <p className="text-xs text-red-600">{fatErro}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">Fat. Bruto (mês)</p>
                  <p className="text-sm font-semibold text-gray-900">{fmt(fatMes)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">Bônus estimado</p>
                  <p className="text-sm font-semibold text-emerald-700">{fmt(bonusSim.liquido)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <SyncStatusPanel />

        <FirestoreReadDiagnostics />

        <div className="text-[11px] text-gray-500">
          As alterações ficam salvas neste navegador e passam a valer ao recarregar o dashboard.
        </div>
      </div>
    </div>
  );
}

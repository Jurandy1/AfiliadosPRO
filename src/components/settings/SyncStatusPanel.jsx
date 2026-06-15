import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Server } from "lucide-react";
import LoadingSpinner from "../layout/LoadingSpinner";
import SectionTitle from "../ui/SectionTitle";
import { getSyncHealthStatus } from "../../platforms/dashboard/repositories/metricsRepository";
import { formatarTempoAtras } from "../../utils/formatters";

function SyncRow({ label, value, error, tone = "default" }) {
  const valueClass = tone === "ok"
    ? "text-emerald-700"
    : tone === "warn"
      ? "text-amber-800"
      : "text-gray-800";

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 py-2 border-b border-gray-100 last:border-0">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <div className="text-xs text-right sm:max-w-[65%]">
        <span className={`font-medium ${valueClass}`}>{value}</span>
        {error ? (
          <p className="text-[11px] text-red-600 mt-0.5 flex items-start justify-end gap-1">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function falhaMaisRecenteQueSucesso(falhaAt, sucessoAt, error) {
  if (!error) return false;
  if (!sucessoAt) return true;
  if (!falhaAt) return true;
  return falhaAt.getTime() > sucessoAt.getTime();
}

function SyncJobBlock({ titulo, sucessoAt, falhaAt, error }) {
  const falhaAtiva = falhaMaisRecenteQueSucesso(falhaAt, sucessoAt, error);
  const sucessoLabel = formatarTempoAtras(sucessoAt) || "—";

  return (
    <div className="py-2 border-b border-gray-100 last:border-0 space-y-1">
      <div className="text-[11px] font-medium text-gray-700">{titulo}</div>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 pl-2 border-l-2 border-emerald-200">
        <span className="text-[10px] text-gray-500">Último sucesso</span>
        <span className="text-xs font-medium text-emerald-700 sm:text-right">{sucessoLabel}</span>
      </div>
      {falhaAtiva ? (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 pl-2 border-l-2 border-red-200">
          <span className="text-[10px] text-gray-500">Última falha</span>
          <div className="sm:text-right">
            <span className="text-xs font-medium text-amber-800">
              {formatarTempoAtras(falhaAt) || "registrada"}
            </span>
            <p className="text-[11px] text-red-600 mt-0.5 flex items-start sm:justify-end gap-1">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {error}
            </p>
          </div>
        </div>
      ) : error && sucessoAt ? (
        <p className="text-[10px] text-emerald-700 flex items-center gap-1 pl-2">
          <CheckCircle2 size={11} />
          Falha anterior resolvida
        </p>
      ) : null}
    </div>
  );
}

function ApiCard({ title, accent, schedule, children }) {
  return (
    <div className={`border rounded-lg p-4 ${accent}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <Server size={16} className="text-gray-400 shrink-0" />
      </div>
      <p className="text-[11px] text-gray-500 mb-3">{schedule}</p>
      <div>{children}</div>
    </div>
  );
}

export default function SyncStatusPanel() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [, setTick] = useState(0);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const data = await getSyncHealthStatus();
      setHealth(data);
    } catch (e) {
      setErro(e?.message || "Falha ao carregar status de sincronização.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    // Polling agressivo removido para evitar o consumo fantasma de leituras no Firestore.
    // A atualização agora é manual via botão "Atualizar" no painel.
    const tickId = setInterval(() => setTick((t) => t + 1), 60000);
    return () => {
      clearInterval(tickId);
    };
  }, [carregar]);

  const shopee = health?.shopee || {};
  const meta = health?.meta || {};
  const shopeeUltima = shopee.ultimaAtualizacaoHoje
    || shopee.lastRecent3dAt
    || shopee.lastIncrementalAt
    || shopee.lastReconcile15dAt;

  const incrementalFalhou = falhaMaisRecenteQueSucesso(
    shopee.lastIncrementalFailedAt,
    shopee.lastIncrementalAt,
    shopee.lastIncrementalError,
  );
  const recent3dOk = shopee.lastRecent3dAt && !falhaMaisRecenteQueSucesso(
    shopee.lastRecent3dFailedAt,
    shopee.lastRecent3dAt,
    shopee.lastRecent3dError,
  );

  return (
    <div className="border border-gray-100 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <SectionTitle icon={RefreshCw} className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          Status e sincronização
        </SectionTitle>
        <button
          type="button"
          onClick={() => { setLoading(true); carregar(); }}
          className="text-[11px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"
        >
          <RefreshCw size={12} />
          Atualizar
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Horários das APIs automáticas. Sucesso e falha são exibidos separadamente — o erro some após a próxima execução OK.
      </p>

      {loading && !health ? (
        <LoadingSpinner label="Carregando status..." className="py-4" />
      ) : erro ? (
        <p className="text-xs text-red-600">{erro}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ApiCard
            title="Shopee Affiliate"
            accent="border-orange-100 bg-orange-50/30"
            schedule="Incremental 0h/6h/12h/18h BRT · reconcile 04:00 · dias recentes a cada 4h"
          >
            <SyncRow
              label="Última gravação (hoje)"
              value={formatarTempoAtras(shopee.ultimaAtualizacaoHoje) || "—"}
              tone={shopee.ultimaAtualizacaoHoje ? "ok" : "default"}
            />
            <SyncJobBlock
              titulo="Sync dias recentes"
              sucessoAt={shopee.lastRecent3dAt}
              falhaAt={shopee.lastRecent3dFailedAt}
              error={shopee.lastRecent3dError}
            />
            <SyncJobBlock
              titulo="Incremental"
              sucessoAt={shopee.lastIncrementalAt}
              falhaAt={shopee.lastIncrementalFailedAt}
              error={shopee.lastIncrementalError}
            />
            <SyncJobBlock
              titulo="Reconcile 15 dias"
              sucessoAt={shopee.lastReconcile15dAt}
              falhaAt={shopee.lastReconcile15dFailedAt}
              error={shopee.lastReconcile15dError}
            />
            {incrementalFalhou && recent3dOk ? (
              <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-2">
                O incremental falhou na API Shopee (rede/timeout), mas o sync dos dias recentes rodou{" "}
                {formatarTempoAtras(shopee.lastRecent3dAt)} — anteontem, ontem e hoje devem estar atualizados.
              </p>
            ) : null}
            {shopeeUltima ? (
              <p className="text-[10px] text-emerald-700 mt-2 flex items-center gap-1">
                <Clock size={11} />
                Referência geral: {formatarTempoAtras(shopeeUltima)}
              </p>
            ) : (
              <p className="text-[10px] text-amber-700 mt-2">Ainda sem registro de sync no Firestore.</p>
            )}
          </ApiCard>

          <ApiCard
            title="Meta Ads"
            accent="border-indigo-100 bg-indigo-50/30"
            schedule="Gasto diário (meta_ads_daily): a cada 4h · anúncios a cada 6h"
          >
            <SyncJobBlock
              titulo="Gasto diário"
              sucessoAt={meta.lastDailySyncAt}
              falhaAt={meta.lastDailySyncFailedAt}
              error={meta.lastDailySyncError}
            />
            <SyncJobBlock
              titulo="Anúncios (last_30d)"
              sucessoAt={meta.lastAdsSyncAt}
              falhaAt={meta.lastAdsSyncFailedAt}
              error={meta.lastAdsSyncError}
            />
            {meta.lastRange?.since && meta.lastRange?.until ? (
              <SyncRow
                label="Último intervalo"
                value={`${meta.lastRange.since} → ${meta.lastRange.until}`}
              />
            ) : null}
            {!meta.lastDailySyncAt && !meta.lastAdsSyncAt ? (
              <p className="text-[10px] text-amber-700 mt-2">Ainda sem registro de sync no Firestore.</p>
            ) : null}
          </ApiCard>
        </div>
      )}
    </div>
  );
}

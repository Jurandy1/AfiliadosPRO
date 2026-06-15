import { useEffect, useState } from "react";
import { Check, DollarSign, Lightbulb, Loader2, MousePointerClick, Target, Trash2, TrendingUp, X } from "lucide-react";
import {
  getImportacoes,
  importMetaAds,
  importPinterest,
  importShopeeClique,
  importShopeeVenda,
  removerHistoricoShopeeVendas,
  removerImportacao,
} from "../repositories/importsRepository";
import Badge from "../../../components/cards/Badge";
import ReconcileAdsButton from "../components/ReconcileAdsButton";
import ReconcileButton from "../components/ReconcileButton";
import { uploadImportFile } from "../../../services/firebase/storage";
import { formatFirestoreDate } from "../../../utils/dates";
import {
  formatImportPeriodo,
  formatLinhasImport,
  formatPedidosSync,
  formatRegistrosApi,
  getImportOrigem,
} from "../components/importHistoryUtils";

const ZONES = [
  { id: "shopee_venda", name: "Shopee — Vendas", desc: "Relatório de Comissões", format: ".csv", icon: <DollarSign size={32} className="text-orange-500" />, accept: ".csv" },
  { id: "shopee_clique", name: "Shopee — Cliques", desc: "Relatório de Cliques", format: ".csv", icon: <MousePointerClick size={32} className="text-red-500" />, accept: ".csv" },
  { id: "meta_ads", name: "Meta Ads", desc: "Relatório do Gerenciador", format: ".xlsx", icon: <Target size={32} className="text-blue-600" />, accept: ".xlsx,.xls" },
  { id: "pinterest", name: "Pinterest", desc: "Relatório de Anúncios", format: ".csv", icon: <TrendingUp size={32} className="text-red-600" />, accept: ".csv" },
];

const TIPO_LABELS = {
  shopee_venda: "Shopee Vendas",
  shopee_clique: "Shopee Cliques",
  meta_ads: "Meta Ads",
  pinterest: "Pinterest",
};

export default function ImportsPage({ onImportDone }) {
  const [uploading, setUploading] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [removingId, setRemovingId] = useState(null);
  const [clearingShopeeVendas, setClearingShopeeVendas] = useState(false);
  const [modeByTipo, setModeByTipo] = useState({
    shopee_venda: "replace",
    shopee_clique: "replace",
    meta_ads: "replace",
    pinterest: "replace",
  });

  const formatImportError = (err) => {
    const code = err?.code || "";
    const msg = String(err?.message || err || "");
    const isPermission = code === "permission-denied" || msg.includes("insufficient permissions");
    const isAuthRestricted = code === "auth/admin-restricted-operation" || msg.includes("admin-restricted-operation");
    if (isPermission) {
      return `Permissão insuficiente no Firebase (Firestore). Código: ${code || "permission-denied"}. Mensagem: ${msg}`;
    }
    if (isAuthRestricted) {
      return `O Firebase Auth bloqueou uma operação (admin-restricted-operation). Mensagem: ${msg}`;
    }
    return msg || "Erro desconhecido";
  };

  useEffect(() => {
    getImportacoes().then(setHistory).catch(() => {});
  }, [result]);

  const handleFile = async (tipo, e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(tipo);
    setResult(null);

    try {
      try {
        await Promise.allSettled(files.map((f) => uploadImportFile(f, tipo)));
      } catch (err) {
        console.warn("Storage:", err.message);
      }

      const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
      let res;
      const mode = modeByTipo[tipo] || "replace";
      if (tipo === "shopee_venda") res = await importShopeeVenda(buffers, { mode });
      else if (tipo === "shopee_clique") res = await importShopeeClique(buffers, { mode });
      else if (tipo === "meta_ads") res = await importMetaAds(buffers, { mode });
      else if (tipo === "pinterest") res = await importPinterest(buffers, { mode });

      setResult({ success: true, tipo, ...res });
      onImportDone?.();
    } catch (err) {
      console.error(err);
      setResult({ success: false, error: formatImportError(err) });
    } finally {
      setUploading(null);
      e.target.value = "";
    }
  };

  const handleRemoveImport = async (item) => {
    const extra = item?.modo === "append"
      ? "\n\nAtenção: no modo Somar, remover o item do histórico não desfaz os totais acumulados."
      : "";
    const ok = window.confirm(
      `Remover importação de ${TIPO_LABELS[item.tipo] || item.tipo} e limpar dados desse tipo?${extra}`,
    );
    if (!ok) return;

    setRemovingId(item.id);
    try {
      await removerImportacao(item.id, item.tipo, item.modo);
      setHistory((prev) => prev.filter((h) => h.id !== item.id));
      onImportDone?.();
    } catch (err) {
      console.error(err);
      setResult({ success: false, error: err.message || "Erro ao remover importação" });
    } finally {
      setRemovingId(null);
    }
  };

  const handleClearShopeeVendaHistory = async () => {
    const ok = window.confirm(
      "Apagar do histórico TODAS as importações do tipo 'Shopee Vendas' (CSV e API)?\n\nIsso só remove os registros em /importacoes. Não apaga produtos/subid_vendas.",
    );
    if (!ok) return;

    setClearingShopeeVendas(true);
    setResult(null);
    try {
      const deleted = await removerHistoricoShopeeVendas();
      setHistory((prev) => prev.filter((h) => h.tipo !== "shopee_venda"));
      setResult({ success: true, tipo: "shopee_venda", linhas: 0, produtos: 0, subIds: 0, message: `${deleted} registro(s) removido(s) do histórico.` });
      onImportDone?.();
    } catch (err) {
      console.error(err);
      setResult({ success: false, error: err.message || "Erro ao limpar histórico de Shopee Vendas" });
    } finally {
      setClearingShopeeVendas(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
        <h3 className="text-sm font-semibold mb-1">Importar relatórios</h3>
        <p className="text-xs text-gray-400 mb-5">
          Suba os arquivos exportados de cada plataforma. Recomendado: semanal (toda segunda).
          Após importar, os anúncios são vinculados automaticamente aos produtos pelo Sub_id1.
        </p>

        <div className="grid grid-cols-4 gap-3 mb-5">
          {ZONES.map((z) => {
            const inputId = `import_${z.id}`;
            return (
              <div key={z.id}>
                <label
                  htmlFor={inputId}
                  className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all block ${
                    uploading === z.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30"
                  }`}
                >
                  <div className="mb-2">{z.icon}</div>
                  <div className="font-semibold text-sm">{z.name}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{z.desc}</div>
                  {(z.id === "shopee_venda" || z.id === "shopee_clique") && (
                    <div className="mt-2 flex items-center justify-center">
                      <select
                        value={modeByTipo[z.id] || "replace"}
                        onChange={(e) => setModeByTipo((prev) => ({ ...prev, [z.id]: e.target.value }))}
                        className="text-[10px] border border-gray-200 rounded-md px-2 py-1 bg-white"
                        disabled={!!uploading}
                      >
                        <option value="replace">Substituir (recomendado)</option>
                        <option value="append">Somar (apenas sem sobreposição)</option>
                      </select>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-300 mt-0.5">{z.format}</div>
                  {uploading === z.id ? (
                    <div className="mt-3 text-xs text-indigo-600 flex items-center justify-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Processando...
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-indigo-600 font-medium">Subir arquivo</div>
                  )}
                </label>
                <input
                  id={inputId}
                  type="file"
                  accept={z.accept}
                  multiple
                  onChange={(e) => handleFile(z.id, e)}
                  className="sr-only"
                  disabled={!!uploading}
                />
              </div>
            );
          })}
        </div>

        {result && (
          <div className={`rounded-lg p-3 text-xs mb-4 ${result.success ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {result.success ? (
              <>
                <div className="flex items-center gap-2 font-semibold">
                  <Check size={14} /> Importação concluída!
                </div>
                <div className="mt-1">
                  {result.linhas} linhas processadas
                  {result.produtos ? ` → ${result.produtos} produtos` : ""}
                  {result.subIds ? ` → ${result.subIds} sub_ids` : ""}
                  {result.produtosVinculados != null && result.produtosVinculados > 0 ? ` · ${result.produtosVinculados} produtos vinculados a anúncios` : ""}
                  {result.produtosAtualizados != null && result.produtosAtualizados > 0 ? ` · ${result.produtosAtualizados} produtos com cliques atualizados` : ""}
                </div>
                {result.message && (
                  <div className="mt-1 text-[11px] text-emerald-700">
                    {result.message}
                  </div>
                )}
                {result.subIdsPersistidos === false && (
                  <div className="mt-1 text-[11px] text-amber-700">
                    Aviso: os agregados por SubID não puderam ser salvos no Firestore.
                    {result.subIdsError ? ` Motivo: ${result.subIdsError}` : ""}
                  </div>
                )}
                {result.porReferenciador && (
                  <div className="mt-1">
                    Por canal: {Object.entries(result.porReferenciador).map(([k, v]) => `${k}: ${v}`).join(", ")}
                  </div>
                )}
                {result.colunas && (
                  <div className="mt-1 text-[10px] text-gray-500">
                    Colunas detectadas: {result.colunas.slice(0, 8).join(", ")}
                    {result.colunas.length > 8 ? ` +${result.colunas.length - 8} mais` : ""}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <X size={14} /> Erro: {result.error}
              </div>
            )}
          </div>
        )}

        <div className="space-y-0">
          <ReconcileAdsButton />
          <ReconcileButton />
        </div>

        <div className="bg-gray-50 rounded-lg p-3 mt-4 text-xs text-gray-500">
          <div className="font-semibold text-gray-700 mb-1">Onde exportar cada relatório:</div>
          <div><strong>Shopee Vendas:</strong> Shopee Afiliados → Relatórios → Comissões → Exportar CSV</div>
          <div><strong>Shopee Cliques:</strong> Shopee Afiliados → Relatórios → Cliques → Exportar CSV</div>
          <div><strong>Meta Ads:</strong> Gerenciador de Anúncios → Relatórios → Exportar XLSX</div>
          <div><strong>Pinterest:</strong> Pinterest Ads → Reports → Export CSV</div>
          <div className="mt-2 text-[10px] text-indigo-600 font-medium flex items-start gap-1.5">
            <Lightbulb size={12} className="shrink-0 mt-0.5" />
            <span>
              Encoding automático — o sistema tenta UTF-8, Latin-1 e Windows-1252 para garantir que todos os caracteres especiais sejam lidos corretamente.
            </span>
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-semibold">Histórico de importações</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">
                <strong>API</strong> = sync automático Shopee · <strong>Registros API</strong> = conversões brutas da API · <strong>Pedidos</strong> = total contado no dashboard
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearShopeeVendaHistory}
              disabled={clearingShopeeVendas}
              className="inline-flex items-center gap-1 rounded border border-amber-200 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              {clearingShopeeVendas ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Limpar Shopee Vendas
            </button>
          </div>
          <div className="table-scroll">
          <table className="table-wide min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-gray-400 uppercase text-[10px] tracking-wider">
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Origem</th>
                <th className="text-left px-3 py-2">Período</th>
                <th className="px-3 py-2 text-center" title="Conversões brutas retornadas pela API Shopee">Reg. API</th>
                <th className="px-3 py-2 text-center" title="Pedidos pendentes + concluídos gravados no dashboard">Pedidos</th>
                <th className="px-3 py-2 text-center">Linhas</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {history.map((h) => {
                const origem = getImportOrigem(h);
                const isShopeeVenda = h.tipo === "shopee_venda";
                return (
                <tr key={h.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 whitespace-nowrap">{formatFirestoreDate(h.importadoEm)}</td>
                  <td className="px-3 py-2">
                    <Badge text={TIPO_LABELS[h.tipo] || h.tipo} variant="Shopee" />
                  </td>
                  <td className="px-3 py-2">
                    {isShopeeVenda ? (
                      <span title={origem.title}>
                        <Badge text={origem.label} variant={origem.variant} />
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate" title={formatImportPeriodo(h)}>
                    {isShopeeVenda ? formatImportPeriodo(h) : "—"}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-[11px]">
                    {isShopeeVenda ? formatRegistrosApi(h) : "—"}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold text-indigo-700">
                    {isShopeeVenda ? formatPedidosSync(h) : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">{formatLinhasImport(h)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge text={h.status === "sucesso" ? "OK" : "Erro"} variant={h.status === "sucesso" ? "Escalando" : "Sem Estoque"} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveImport(h)}
                      disabled={removingId === h.id}
                      className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {removingId === h.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Remover
                    </button>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </>
  );
}

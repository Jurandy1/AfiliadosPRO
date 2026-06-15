import { useEffect, useMemo, useState } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import { getPerformanceBundleCached } from "../../dashboard/services/periodDataCache";
import { useIsMobile } from "../../../utils/useMediaQuery";
import { fmt } from "../../../utils/formatters";

function pad(n) {
  return String(n).padStart(2, "0");
}

function primeiroDiaMes() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function PerformanceMobileCards({ rows, type }) {
  if (!rows.length) return null;

  if (type === "produtos") {
    return (
      <div className="divide-y divide-slate-100">
        {rows.map((p) => (
          <div key={p.produto_id || p.nome} className="p-4 bg-white">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Produto</div>
            <div className="text-sm font-bold text-slate-900 leading-snug mb-3 break-words">{p.nome}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2">
                <div className="text-[9px] uppercase text-emerald-700/70 font-semibold">Comissão est.</div>
                <div className="text-sm font-bold text-emerald-700 mt-0.5">{fmt(p.comissao_estimada)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
                <div className="text-[9px] uppercase text-slate-400 font-semibold">Itens</div>
                <div className="text-sm font-semibold text-slate-800 mt-0.5">{p.qtd_itens ?? 0}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 col-span-2">
                <div className="text-[9px] uppercase text-slate-400 font-semibold">Faturamento</div>
                <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmt(p.faturamento)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((s) => (
        <div key={s.subid} className="p-4 bg-white">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">SubID</div>
          <div className="text-sm font-bold text-slate-900 break-all leading-snug mb-3">{s.subid}</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2">
              <div className="text-[9px] uppercase text-emerald-700/70 font-semibold">Comissão est.</div>
              <div className="text-sm font-bold text-emerald-700 mt-0.5">{fmt(s.comissoes_estimadas)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
              <div className="text-[9px] uppercase text-slate-400 font-semibold">Pedidos</div>
              <div className="text-sm font-semibold text-slate-800 mt-0.5">{s.pedidos ?? 0}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 col-span-2">
              <div className="text-[9px] uppercase text-slate-400 font-semibold">Faturamento</div>
              <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmt(s.faturamento)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PerformanceDesktopTable({ rows, type }) {
  if (type === "produtos") {
    return (
      <table className="w-full text-sm min-w-[520px]">
        <thead className="bg-gray-50 text-xs uppercase text-gray-600">
          <tr>
            <th className="text-left px-3 py-2">Produto</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Comissão est.</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Itens</th>
            <th className="text-right px-3 py-2 whitespace-nowrap">Faturamento</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.produto_id || p.nome} className="border-t">
              <td className="px-3 py-2 max-w-[360px]" title={p.nome}>
                <span className="line-clamp-2">{p.nome}</span>
              </td>
              <td className="px-3 py-2 text-right font-medium text-emerald-700 whitespace-nowrap">
                {fmt(p.comissao_estimada)}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{p.qtd_itens}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(p.faturamento)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="w-full text-sm min-w-[480px]">
      <thead className="bg-gray-50 text-xs uppercase text-gray-600">
        <tr>
          <th className="text-left px-3 py-2">SubID</th>
          <th className="text-right px-3 py-2 whitespace-nowrap">Comissão est.</th>
          <th className="text-right px-3 py-2 whitespace-nowrap">Pedidos</th>
          <th className="text-right px-3 py-2 whitespace-nowrap">Faturamento</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.subid} className="border-t">
            <td className="px-3 py-2 font-mono text-xs break-all">{s.subid}</td>
            <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmt(s.comissoes_estimadas)}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">{s.pedidos}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(s.faturamento)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PerformanceProdutoPage() {
  const isMobile = useIsMobile();
  const [startDate, setStartDate] = useState(primeiroDiaMes());
  const [endDate, setEndDate] = useState(hojeISO());
  const [loading, setLoading] = useState(true);
  const [produtos, setProdutos] = useState([]);
  const [subids, setSubids] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [aba, setAba] = useState("produtos");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { produtos: p, subIds: s, kpis: k } = await getPerformanceBundleCached(
          startDate,
          endDate,
          {},
          { topN: 200 },
        );
        if (cancel) return;
        setProdutos(p);
        setSubids(s);
        setKpis(k);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [startDate, endDate]);

  const totalProdutos = useMemo(
    () => produtos.reduce((s, p) => s + Number(p.comissao_estimada || 0), 0),
    [produtos],
  );

  const rowsAtivos = aba === "produtos" ? produtos : subids;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 max-w-6xl mx-auto">
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="text-indigo-600 shrink-0" size={24} />
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Performance por produto</h1>
        </div>
        <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
          Top produtos e SubIDs no período — fonte{" "}
          <code className="text-[10px] sm:text-xs bg-gray-100 px-1 rounded">produto_daily</code> e{" "}
          <code className="text-[10px] sm:text-xs bg-gray-100 px-1 rounded">subid_daily</code>.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-4 sm:mb-6 items-stretch sm:items-end">
        <label className="text-sm flex-1 sm:flex-none">
          <span className="text-gray-600 block mb-1">De</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full sm:w-auto border rounded-lg px-2 py-2 text-sm"
          />
        </label>
        <label className="text-sm flex-1 sm:flex-none">
          <span className="text-gray-600 block mb-1">Até</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full sm:w-auto border rounded-lg px-2 py-2 text-sm"
          />
        </label>
        {kpis && (
          <div className="sm:ml-auto text-xs sm:text-sm text-gray-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            KPI período: <strong>{fmt(kpis.comissaoEstimada)}</strong> estimado ·{" "}
            {kpis.pedidos} pedidos
          </div>
        )}
      </div>

      <div className="flex border-b mb-4 gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setAba("produtos")}
          className={`shrink-0 px-3 sm:px-4 py-2 text-sm border-b-2 whitespace-nowrap ${aba === "produtos" ? "border-indigo-600 text-indigo-700 font-semibold" : "border-transparent text-gray-500"}`}
        >
          Produtos ({produtos.length})
        </button>
        <button
          type="button"
          onClick={() => setAba("subid")}
          className={`shrink-0 px-3 sm:px-4 py-2 text-sm border-b-2 whitespace-nowrap ${aba === "subid" ? "border-indigo-600 text-indigo-700 font-semibold" : "border-transparent text-gray-500"}`}
        >
          SubID ({subids.length})
        </button>
      </div>

      {loading && <div className="text-center py-10 text-gray-500">Carregando...</div>}

      {!loading && rowsAtivos.length === 0 && (
        <div className="text-center py-8 text-gray-500 flex flex-col items-center gap-2">
          <TrendingUp size={28} className="text-gray-300" />
          Sem dados {aba === "produtos" ? "de produto" : "de SubID"} no período. Rode o sync Shopee no Dashboard.
        </div>
      )}

      {!loading && rowsAtivos.length > 0 && (
        <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
          {aba === "produtos" && (
            <div className="px-3 sm:px-4 py-2 bg-gray-50 text-xs text-gray-600 border-b">
              Soma top {produtos.length}: {fmt(totalProdutos)}
            </div>
          )}
          {isMobile ? (
            <PerformanceMobileCards rows={rowsAtivos} type={aba} />
          ) : (
            <div className="overflow-x-auto">
              <PerformanceDesktopTable rows={rowsAtivos} type={aba} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

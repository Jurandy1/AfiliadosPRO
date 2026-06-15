import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import SortTh from "../../../components/tables/SortTh";
import { fmt, fmtNum } from "../../../utils/formatters";
import { formatDateDisplayPT } from "../../../utils/dates";
import { subIdComissaoExibida } from "../../../domain/metrics/financeiroMetrics.js";

function fmtVendas(v) {
  return fmtNum(Math.round(v || 0));
}

function TrendIcon({ delta }) {
  if (delta == null || Math.abs(delta) < 0.01) {
    return <Minus size={14} className="text-gray-400 inline" aria-label="Estável" />;
  }
  if (delta > 0) {
    return <ArrowUp size={14} className="text-emerald-600 inline" aria-label="Melhorou" />;
  }
  return <ArrowDown size={14} className="text-red-500 inline" aria-label="Piorou" />;
}

function DailyRow({ row, prevLucro, roiMinimo }) {
  const lucroColor = (row.lucro || 0) >= 0 ? "text-emerald-700" : "text-red-600";
  const roiColor = row.roi >= roiMinimo ? "#16A34A" : row.roi >= 0 ? "#D97706" : "#DC2626";
  const delta = prevLucro != null ? (row.lucro || 0) - prevLucro : null;

  return (
    <tr className="hover:bg-gray-50/50">
      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
        {formatDateDisplayPT(row.data)}
      </td>
      <td className="px-2 py-2 text-center text-emerald-700 font-semibold">{fmt(subIdComissaoExibida(row))}</td>
      <td className="px-2 py-2 text-center">{fmt(row.faturamento)}</td>
      <td className="px-2 py-2 text-center text-slate-700">{fmt(row.gasto)}</td>
      <td className={`px-2 py-2 text-center font-semibold ${lucroColor}`}>{fmt(row.lucro)}</td>
      <td className="px-2 py-2 text-center font-bold" style={{ color: roiColor }}>
        {row.gasto > 0 ? ((row.roi || 0) * 100).toFixed(2) + "%" : "—"}
      </td>
      <td className="px-2 py-2 text-center">{fmtVendas(row.total_vendas)}</td>
      <td className="px-2 py-2 text-center">
        <TrendIcon delta={delta} />
      </td>
    </tr>
  );
}

function DailyCard({ row, prevLucro, roiMinimo }) {
  const lucroColor = (row.lucro || 0) >= 0 ? "text-emerald-700" : "text-red-600";
  const roiColor = row.roi >= roiMinimo ? "#16A34A" : row.roi >= 0 ? "#D97706" : "#DC2626";
  const delta = prevLucro != null ? (row.lucro || 0) - prevLucro : null;

  return (
    <div className="border border-gray-100 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-gray-900">{formatDateDisplayPT(row.data)}</span>
        <TrendIcon delta={delta} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Comissão</span>
          <div className="font-semibold text-emerald-700">{fmt(subIdComissaoExibida(row))}</div>
        </div>
        <div>
          <span className="text-gray-500">Gasto</span>
          <div className="font-semibold">{fmt(row.gasto)}</div>
        </div>
        <div>
          <span className="text-gray-500">Lucro</span>
          <div className={`font-semibold ${lucroColor}`}>{fmt(row.lucro)}</div>
        </div>
        <div>
          <span className="text-gray-500">ROI</span>
          <div className="font-bold" style={{ color: roiColor }}>
            {row.gasto > 0 ? ((row.roi || 0) * 100).toFixed(2) + "%" : "—"}
          </div>
        </div>
        <div>
          <span className="text-gray-500">Faturamento</span>
          <div>{fmt(row.faturamento)}</div>
        </div>
        <div>
          <span className="text-gray-500">Vendas</span>
          <div>{fmtVendas(row.total_vendas)}</div>
        </div>
      </div>
    </div>
  );
}

export default function SubIdDailyBreakdownTable({
  rows,
  totals,
  loading,
  roiMinimo = 0.5,
  isMobile,
  sortField,
  sortDir,
  onSort,
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-card border border-surface-border p-6 h-64 flex flex-col space-y-4">
        <div className="h-6 w-1/4 bg-gray-100 animate-pulse rounded" />
        <div className="flex-1 space-y-3 mt-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 w-full bg-gray-50 animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!rows?.length) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        Sem dados diários no período selecionado.
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="p-3 space-y-2">
        {rows.map((row) => (
          <DailyCard
            key={row.data}
            row={row}
            prevLucro={row._prevLucro}
            roiMinimo={roiMinimo}
          />
        ))}
        <div className="bg-slate-900 text-white rounded-lg p-3 text-xs font-bold">
          <div className="mb-2">TOTAL DO PERÍODO</div>
          <div className="grid grid-cols-2 gap-2 font-normal">
            <div>Comissão: <span className="text-emerald-400">{fmt(totals.comissoes)}</span></div>
            <div>Gasto: <span className="text-rose-400">{fmt(totals.gasto)}</span></div>
            <div>Lucro: <span className={totals.lucro >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmt(totals.lucro)}</span></div>
            <div>Vendas: {fmtVendas(totals.total_vendas)}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="table-wide min-w-[720px]">
        <thead>
          <tr className="table-head-row">
            <SortTh label="Dia" field="data" sortField={sortField} onSort={onSort} className="text-left px-3 py-2.5" />
            <SortTh label="Comissão" field="comissoes" sortField={sortField} onSort={onSort} />
            <SortTh label="Faturamento" field="faturamento" sortField={sortField} onSort={onSort} />
            <SortTh label="Gasto" field="gasto" sortField={sortField} onSort={onSort} />
            <SortTh label="Lucro" field="lucro" sortField={sortField} onSort={onSort} />
            <SortTh label="ROI" field="roi" sortField={sortField} onSort={onSort} />
            <SortTh label="Vendas" field="total_vendas" sortField={sortField} onSort={onSort} />
            <th className="px-2 py-2.5 text-center" title="Comparado ao dia anterior (lucro)">Tend.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row) => (
            <DailyRow
              key={row.data}
              row={row}
              prevLucro={row._prevLucro}
              roiMinimo={roiMinimo}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-900 text-white font-extrabold text-[12px]">
            <td className="px-3 py-3">TOTAL</td>
            <td className="px-3 py-3 text-center text-emerald-400">{fmt(totals.comissoes)}</td>
            <td className="px-3 py-3 text-center">{fmt(totals.faturamento)}</td>
            <td className="px-3 py-3 text-center text-rose-400">{fmt(totals.gasto)}</td>
            <td className={`px-3 py-3 text-center ${totals.lucro >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {fmt(totals.lucro)}
            </td>
            <td className={`px-3 py-3 text-center ${totals.roiTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {totals.gasto > 0 ? (totals.roiTotal * 100).toFixed(2) + "%" : "—"}
            </td>
            <td className="px-3 py-3 text-center">{fmtVendas(totals.total_vendas)}</td>
            <td className="px-3 py-3" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

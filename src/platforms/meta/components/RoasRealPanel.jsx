import { useMemo } from "react";
import { fmt, fmtNum } from "../../../utils/formatters";
import MetricTooltip from "./MetricTooltip";

export default function RoasRealPanel({ meta, subIdMap }) {
  const itens = useMemo(() => {
    if (!meta || meta.length === 0) return [];

    return meta
      .map((m) => {
        const subKey = String(m.subid || "").trim();
        const subData = subKey ? (subIdMap[subKey] || null) : null;
        const gasto = Number(m.valorUsado || 0);
        const comissao = subData ? subData.comissao : 0;
        const vendas = subData ? subData.vendas : 0;
        const roas = gasto > 0 ? comissao / gasto : 0;
        const lucro = comissao - gasto;

        return {
          nome: m.nomeAnuncio || "—",
          subid: subKey,
          gasto,
          comissao,
          vendas,
          roas,
          lucro,
          temAtribuicao: !!subData,
        };
      })
      .filter((it) => it.gasto > 0)
      .sort((a, b) => b.roas - a.roas);
  }, [meta, subIdMap]);

  if (itens.length === 0) return null;

  const totalGasto = itens.reduce((s, it) => s + it.gasto, 0);
  const totalComissao = itens.reduce((s, it) => s + it.comissao, 0);
  const totalLucro = totalComissao - totalGasto;
  const roasGeral = totalGasto > 0 ? totalComissao / totalGasto : 0;

  const lucrativos = itens.filter((it) => it.roas >= 1).length;
  const empate = itens.filter((it) => it.roas > 0 && it.roas < 1).length;
  const semVendas = itens.filter((it) => it.roas === 0).length;

  return (
    <div className="mb-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-3 gap-3 sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1 flex-wrap">
            <MetricTooltip metricKey="roas" /> real — comissão Shopee ÷ gasto Meta
          </h3>
          <p className="text-xs text-gray-500 mt-1 max-w-lg">
            Cruza o gasto de cada anúncio com as vendas do mesmo SubID na Shopee.
            Acima de <strong>1x</strong> você ganhou mais comissão do que gastou; abaixo de 1x, está no prejuízo.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500">ROAS geral</div>
          <div className={`text-lg font-bold ${roasGeral >= 1 ? "text-green-600" : "text-red-600"}`}>
            {roasGeral.toFixed(2)}x
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 text-xs">
        <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-center">
          <div className="font-bold text-green-700">{lucrativos}</div>
          <div className="text-green-600">Lucrativos (≥ 1x)</div>
        </div>
        <div className="p-2 bg-orange-50 border border-orange-200 rounded-lg text-center">
          <div className="font-bold text-orange-700">{empate}</div>
          <div className="text-orange-600">Prejuízo (&lt; 1x)</div>
        </div>
        <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <div className="font-bold text-gray-700">{semVendas}</div>
          <div className="text-gray-600">Sem venda atribuída</div>
        </div>
      </div>

      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-blue-600">Gasto total</div>
            <div className="font-bold text-blue-900">{fmt(totalGasto)}</div>
          </div>
          <div>
            <div className="text-xs text-blue-600">Comissão total</div>
            <div className="font-bold text-blue-900">{fmt(totalComissao)}</div>
          </div>
          <div>
            <div className="text-xs text-blue-600">Lucro líquido</div>
            <div className={`font-bold ${totalLucro >= 0 ? "text-green-700" : "text-red-700"}`}>
              {fmt(totalLucro)}
            </div>
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table-wide min-w-[560px]">
          <thead className="text-gray-500 border-b">
            <tr>
              <th className="text-left px-2 py-2">Anúncio</th>
              <th className="text-right px-2 py-2">Gasto</th>
              <th className="text-right px-2 py-2">Comissão</th>
              <th className="text-right px-2 py-2">Lucro</th>
              <th className="text-right px-2 py-2">Vendas</th>
              <th className="text-right px-2 py-2">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {itens.slice(0, 30).map((it, idx) => {
              const roasColor = it.roas >= 2 ? "text-green-600 font-bold" : it.roas >= 1 ? "text-green-600" : it.roas > 0 ? "text-orange-600" : "text-red-600";
              const lucroColor = it.lucro >= 0 ? "text-green-600" : "text-red-600";
              return (
                <tr key={`roas-${idx}`} className="border-b hover:bg-gray-50">
                  <td className="px-2 py-2 font-medium max-w-[180px] truncate" title={it.nome}>{it.nome}</td>
                  <td className="px-2 py-2 text-right">{fmt(it.gasto)}</td>
                  <td className="px-2 py-2 text-right">{it.temAtribuicao ? fmt(it.comissao) : "—"}</td>
                  <td className={`px-2 py-2 text-right ${lucroColor}`}>{it.temAtribuicao ? fmt(it.lucro) : "—"}</td>
                  <td className="px-2 py-2 text-right">{it.temAtribuicao ? fmtNum(it.vendas) : "—"}</td>
                  <td className={`px-2 py-2 text-right ${roasColor}`}>{it.temAtribuicao ? `${it.roas.toFixed(2)}x` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {itens.length > 30 && (
        <div className="text-xs text-gray-500 mt-2 text-center">Mostrando 30 de {itens.length} anúncios.</div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Anúncios com "—" não têm vendas Shopee ligadas ao SubID. Confira se o link de afiliado usa o mesmo SubID do nome do anúncio.
      </p>
    </div>
  );
}

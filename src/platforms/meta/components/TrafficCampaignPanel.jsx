import { useMemo } from "react";
import { Layers } from "lucide-react";
import { fmt, fmtNum } from "../../../utils/formatters";
import Badge from "../../../components/cards/Badge";

function rollupCampaigns(meta) {
  const map = {};
  meta.forEach((m) => {
    const key = m.campanha || "Sem campanha";
    if (!map[key]) {
      map[key] = {
        campanha: key,
        anuncios: 0,
        ativos: 0,
        gasto: 0,
        cliques: 0,
        cliquesExternos: 0,
        impressoes: 0,
        alcance: 0,
        freqSum: 0,
        freqCount: 0,
      };
    }
    const c = map[key];
    c.anuncios += 1;
    if (String(m.status || "").toLowerCase().includes("ativo")) c.ativos += 1;
    c.gasto += m.valorUsado || 0;
    c.cliques += m.resultados || 0;
    c.cliquesExternos += m.cliquesExternos || 0;
    c.impressoes += m.impressoes || 0;
    c.alcance += m.alcance || 0;
    if (m.frequencia) {
      c.freqSum += m.frequencia;
      c.freqCount += 1;
    }
  });
  return Object.values(map)
    .map((c) => ({
      ...c,
      ctr: c.impressoes > 0 ? (c.cliques / c.impressoes) * 100 : 0,
      cpc: c.cliques > 0 ? c.gasto / c.cliques : 0,
      freqMedia: c.freqCount > 0 ? c.freqSum / c.freqCount : 0,
    }))
    .sort((a, b) => b.gasto - a.gasto);
}

export default function TrafficCampaignPanel({ meta }) {
  const campanhas = useMemo(() => rollupCampaigns(meta || []), [meta]);

  if (!campanhas.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
        Nenhuma campanha Meta encontrada. Aguarde a sincronização automática ou importe o relatório.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm mb-4">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 bg-gray-50/80">
        <Layers size={16} className="text-indigo-600 shrink-0" />
        <h3 className="text-sm font-semibold">Campanhas Meta ({campanhas.length})</h3>
        <span className="text-[11px] text-gray-500 w-full sm:w-auto sm:ml-auto">Agrupado como no Gerenciador de Anúncios · últimos 30 dias</span>
      </div>
      <div className="table-scroll">
        <table className="table-wide min-w-[720px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
              <th className="text-left px-4 py-2">Campanha</th>
              <th className="px-2 py-2">Anúncios</th>
              <th className="px-2 py-2">Gasto</th>
              <th className="px-2 py-2">Cliques link</th>
              <th className="px-2 py-2">CTR</th>
              <th className="px-2 py-2">CPC</th>
              <th className="px-2 py-2">Alcance</th>
              <th className="px-2 py-2">Freq.</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {campanhas.map((c) => (
              <tr key={c.campanha} className="hover:bg-gray-50/60">
                <td className="px-4 py-2.5 font-medium max-w-[220px] truncate" title={c.campanha}>{c.campanha}</td>
                <td className="px-2 py-2 text-center">{c.anuncios}</td>
                <td className="px-2 py-2 text-center font-semibold">{fmt(c.gasto)}</td>
                <td className="px-2 py-2 text-center">{fmtNum(c.cliquesExternos || c.cliques)}</td>
                <td className="px-2 py-2 text-center">{c.ctr.toFixed(2)}%</td>
                <td className="px-2 py-2 text-center">{c.cpc > 0 ? fmt(c.cpc) : "—"}</td>
                <td className="px-2 py-2 text-center">{fmtNum(c.alcance)}</td>
                <td className="px-2 py-2 text-center">{c.freqMedia > 0 ? c.freqMedia.toFixed(1) : "—"}</td>
                <td className="px-2 py-2 text-center">
                  <Badge text={c.ativos > 0 ? `${c.ativos} ativo(s)` : "Pausada"} variant={c.ativos > 0 ? "Escalando" : "Pausado"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[10px] text-gray-400 border-t border-gray-100">
        Cliques link = pessoas que saíram do Meta para seu link Shopee. Frequência alta (&gt;4) pode indicar público cansado.
      </p>
    </div>
  );
}

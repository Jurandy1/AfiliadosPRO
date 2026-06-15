import { useEffect, useMemo, useState } from "react";
import { BarChart2, Users, MapPin } from "lucide-react";
import { getMetaDemographics } from "../repositories/metaRepository";
import { fmt, fmtNum } from "../../../utils/formatters";
import ChartCanvas from "../../../components/charts/ChartCanvas";

const GENDER_PT = { male: "Homens", female: "Mulheres", unknown: "Outros" };

function insightDemografia(ageGender, region) {
  const tips = [];
  if (!ageGender.length) return tips;

  const byAge = {};
  ageGender.forEach((r) => {
    const age = String(r.age || "—");
    byAge[age] = (byAge[age] || 0) + (r.spend || 0);
  });
  const topAge = Object.entries(byAge).sort((a, b) => b[1] - a[1])[0];
  if (topAge) {
    tips.push(`Você gasta mais com faixa etária ${topAge[0]} (${fmt(topAge[1])}). Se suas vendas Shopee vêm de outro perfil, ajuste o público no Meta.`);
  }

  const byGender = { male: 0, female: 0, unknown: 0 };
  ageGender.forEach((r) => {
    const g = String(r.gender || "unknown");
    byGender[g] = (byGender[g] || 0) + (r.spend || 0);
  });
  const totalG = byGender.male + byGender.female + byGender.unknown;
  if (totalG > 0) {
    const pctF = Math.round((byGender.female / totalG) * 100);
    const pctM = Math.round((byGender.male / totalG) * 100);
    if (pctF >= 65) tips.push(`${pctF}% do gasto vai para mulheres — confira se seu nicho de produtos combina com esse público.`);
    else if (pctM >= 65) tips.push(`${pctM}% do gasto vai para homens — valide se é o perfil que mais compra seus links.`);
  }

  const topReg = [...region].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
  if (topReg?.region) {
    tips.push(`Região que mais recebe investimento: ${topReg.region} (${fmt(topReg.spend || 0)}).`);
  }

  return tips;
}

export default function MetaDemographicsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMetaDemographics()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const ageGender = data?.ageGender || [];
  const region = data?.region || [];

  const { ageKeys, ageIndex, genderIndex, topRegions, dicas } = useMemo(() => {
    const ai = {};
    const gi = {};
    ageGender.forEach((r) => {
      const age = String(r.age || "—");
      const gender = String(r.gender || "unknown");
      const spend = r.spend || 0;
      if (!ai[age]) ai[age] = { total: 0, male: 0, female: 0, unknown: 0 };
      ai[age].total += spend;
      if (gender === "male") ai[age].male += spend;
      else if (gender === "female") ai[age].female += spend;
      else ai[age].unknown += spend;
      gi[gender] = (gi[gender] || 0) + spend;
    });
    const keys = Object.keys(ai).sort((a, b) => {
      const na = parseInt(String(a).split("-")[0], 10);
      const nb = parseInt(String(b).split("-")[0], 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    return {
      ageKeys: keys,
      ageIndex: ai,
      genderIndex: gi,
      topRegions: [...region].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, 10),
      dicas: insightDemografia(ageGender, region),
    };
  }, [ageGender, region]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 bg-gradient-to-r from-indigo-50/50 to-white">
        <BarChart2 size={14} className="text-indigo-600" />
        <div>
          <h3 className="text-sm font-semibold">Quem vê seus anúncios</h3>
          <p className="text-[11px] text-gray-500">Idade, sexo e região — dados oficiais da Meta (últimos 30 dias)</p>
        </div>
        <div className="ml-auto text-[10px] text-gray-400">
          {data?.importadoEm?.seconds
            ? `Atualizado ${new Date(data.importadoEm.seconds * 1000).toLocaleString("pt-BR")}`
            : ""}
        </div>
      </div>

      {error && (
        <div className="p-4 text-xs text-red-700 bg-red-50 border-b border-red-100">
          {String(error?.message || error)}
        </div>
      )}

      {loading && <div className="p-6 text-center text-gray-400 text-xs">Carregando demografia...</div>}

      {!data && !loading && !error && (
        <div className="p-6 text-center text-gray-400 text-xs">
          Sem dados ainda. A sincronização automática do backend preenche esta tela.
        </div>
      )}

      {data && dicas.length > 0 && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 space-y-1">
          <div className="text-[11px] font-semibold text-blue-900">Leitura rápida para você</div>
          {dicas.map((t, i) => (
            <p key={i} className="text-xs text-blue-800">• {t}</p>
          ))}
        </div>
      )}

      {data && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
              <Users size={12} /> Idade e sexo
            </div>
            {ageGender.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-xs">Sem dados.</div>
            ) : (
              <>
                <div className="p-3">
                  <ChartCanvas
                    type="bar"
                    height={220}
                    data={{
                      labels: ageKeys.slice(0, 10),
                      datasets: [
                        { label: "Mulheres", data: ageKeys.slice(0, 10).map((k) => Math.round(ageIndex[k]?.female || 0)), backgroundColor: "#6366F1", borderRadius: 6 },
                        { label: "Homens", data: ageKeys.slice(0, 10).map((k) => Math.round(ageIndex[k]?.male || 0)), backgroundColor: "#10B981", borderRadius: 6 },
                        { label: "Outros", data: ageKeys.slice(0, 10).map((k) => Math.round(ageIndex[k]?.unknown || 0)), backgroundColor: "#CBD5E1", borderRadius: 6 },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
                      scales: {
                        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { stacked: true, grid: { color: "#F1F5F9" }, ticks: { callback: (v) => "R$" + v, font: { size: 10 } } },
                      },
                    }}
                  />
                  <div className="mt-2 text-[10px] text-gray-400">
                    Quanto você investiu por faixa etária · Mulheres {fmt(genderIndex.female || 0)} · Homens {fmt(genderIndex.male || 0)}
                  </div>
                </div>
                <div className="table-scroll">
                  <table className="table-wide min-w-[400px]">
                    <thead>
                      <tr className="bg-white text-gray-400 uppercase text-[10px]">
                        <th className="text-left px-3 py-2">Idade</th>
                        <th className="text-left px-2 py-2">Público</th>
                        <th className="px-2 py-2 text-center">Gasto</th>
                        <th className="px-2 py-2 text-center">Cliques</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ageGender.slice(0, 15).map((r) => (
                        <tr key={`${r.age}-${r.gender}`} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-medium">{r.age}</td>
                          <td className="px-2 py-2 text-gray-600">{GENDER_PT[r.gender] || r.generoLabel || r.gender}</td>
                          <td className="px-2 py-2 text-center font-semibold">{fmt(r.spend)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.clicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
              <MapPin size={12} /> Regiões do Brasil
            </div>
            {region.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-xs">Sem dados.</div>
            ) : (
              <>
                <div className="p-3">
                  <ChartCanvas
                    type="bar"
                    height={220}
                    data={{
                      labels: topRegions.map((r) => String(r.region || "—").substring(0, 18)),
                      datasets: [{ data: topRegions.map((r) => Math.round(r.spend || 0)), backgroundColor: "#2563EB", borderRadius: 6 }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { grid: { color: "#F1F5F9" }, ticks: { callback: (v) => "R$" + v, font: { size: 10 } } },
                      },
                    }}
                  />
                </div>
                <div className="table-scroll">
                  <table className="table-wide min-w-[360px]">
                    <thead>
                      <tr className="bg-white text-gray-400 uppercase text-[10px]">
                        <th className="text-left px-3 py-2">Estado/região</th>
                        <th className="px-2 py-2 text-center">Gasto</th>
                        <th className="px-2 py-2 text-center">Alcance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {region.slice(0, 15).map((r) => (
                        <tr key={r.region} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 font-medium">{r.region}</td>
                          <td className="px-2 py-2 text-center font-semibold">{fmt(r.spend)}</td>
                          <td className="px-2 py-2 text-center">{fmtNum(r.reach)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

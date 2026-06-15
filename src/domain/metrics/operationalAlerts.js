import { daysSinceFirestoreTimestamp } from "../../utils/dates";

export function buildOperationalAlerts({ produtos, metaAds, pinterest, importacoes }) {
  const alerts = [];

  produtos
    .filter((p) => (p.cliques || 0) >= 5 && (p.vendas || 0) === 0)
    .sort((a, b) => (b.cliques || 0) - (a.cliques || 0))
    .slice(0, 5)
    .forEach((p) => {
      alerts.push({
        id: `clique-sem-venda-${p.id}`,
        severidade: "media",
        titulo: "Clique sem venda",
        mensagem: `${p.nome} — ${p.cliques} cliques e nenhuma venda registrada`,
      });
    });

  metaAds
    .filter((m) => (m.valorUsado || 0) >= 30 && (m.resultados || 0) === 0)
    .sort((a, b) => (b.valorUsado || 0) - (a.valorUsado || 0))
    .slice(0, 3)
    .forEach((m) => {
      alerts.push({
        id: `meta-gasto-${m.id}`,
        severidade: "critica",
        titulo: "Campanha com gasto alto",
        mensagem: `${m.nomeAnuncio} — R$ ${(m.valorUsado || 0).toFixed(2)} gastos sem cliques/resultados`,
      });
    });

  const pinImport = importacoes.find((i) => i.tipo === "pinterest");
  const pinDaysOld = daysSinceFirestoreTimestamp(pinImport?.importadoEm);

  if (!pinImport || (pinDaysOld != null && pinDaysOld > 7)) {
    alerts.push({
      id: "pinterest-desatualizado",
      severidade: pinImport ? "media" : "critica",
      titulo: "Dados do Pinterest desatualizados",
      mensagem: pinImport
        ? `Última importação há ${Math.floor(pinDaysOld)} dias. Reimporte o CSV semanalmente.`
        : "Nenhuma importação do Pinterest encontrada.",
    });
  }

  if (pinterest.length > 0 && pinDaysOld != null && pinDaysOld <= 7) {
    const pinSpend = pinterest.reduce((s, p) => s + (p.spend || 0), 0);
    const pinClicks = pinterest.reduce((s, p) => s + (p.pinClicks || 0), 0);
    if (pinSpend >= 50 && pinClicks === 0) {
      alerts.push({
        id: "pinterest-gasto-sem-clique",
        severidade: "media",
        titulo: "Pinterest com gasto sem cliques",
        mensagem: `R$ ${pinSpend.toFixed(2)} investidos sem cliques registrados no período.`,
      });
    }
  }

  return alerts.slice(0, 8);
}

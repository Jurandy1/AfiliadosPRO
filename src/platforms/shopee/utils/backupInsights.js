import { fmt, fmtNum } from "../../../utils/formatters";

export function analisarOportunidadesGrupo(principal, backups) {
  if (!principal || !backups?.length) return null;

  const principalComissaoBRL = (principal.preco * principal.comissao_pct) / 100;
  let melhorBackupLucro = null;
  let melhorBackupConversao = null;
  let maiorDiferencaLucro = 0;
  let maiorVantagemConversao = 0;

  backups.forEach((b) => {
    if (!b) return;
    const backupComissaoBRL = (b.preco * b.comissao_pct) / 100;
    const diferencaLucro = backupComissaoBRL - principalComissaoBRL;
    if (diferencaLucro > maiorDiferencaLucro) {
      maiorDiferencaLucro = diferencaLucro;
      melhorBackupLucro = {
        item: b,
        diferenca: diferencaLucro,
        comissaoBRL: backupComissaoBRL,
        comissaoPct: b.comissao_pct,
      };
    }

    const principalVendas = principal.vendas_shopee || 0;
    const backupVendas = b.vendas_shopee || 0;
    const principalRating = Number(principal.rating) || 0;
    const backupRating = Number(b.rating) || 0;

    if (backupVendas > principalVendas * 1.5 && backupRating >= principalRating) {
      const diferencaVendas = backupVendas - principalVendas;
      if (diferencaVendas > maiorVantagemConversao) {
        maiorVantagemConversao = diferencaVendas;
        melhorBackupConversao = {
          item: b,
          vendasAMais: diferencaVendas,
          rating: backupRating,
          vendasTotal: backupVendas,
        };
      }
    }
  });

  const insights = [];

  if (principal.comissao_pct === 0) {
    insights.push({
      tipo: "critico",
      titulo: "Tráfego em perigo — comissão zerada",
      mensagem: "O produto principal está com comissão 0%. Substitua pelo backup agora para evitar perdas.",
    });
  }

  if (melhorBackupLucro && maiorDiferencaLucro > 0.5) {
    const pctAumento = principalComissaoBRL > 0
      ? ((melhorBackupLucro.comissaoBRL - principalComissaoBRL) / principalComissaoBRL) * 100
      : 100;
    const nome = melhorBackupLucro.item.apelido || melhorBackupLucro.item.nome?.substring(0, 25);
    insights.push({
      tipo: "lucro",
      titulo: "Oportunidade de maior margem",
      mensagem: `O backup "${nome}" paga ${fmt(melhorBackupLucro.comissaoBRL)} (${melhorBackupLucro.comissaoPct}%) por venda — +${pctAumento.toFixed(0)}% sobre o atual (${fmt(principalComissaoBRL)}).`,
      backupId: melhorBackupLucro.item.itemId,
    });
  }

  if (melhorBackupConversao) {
    const nome = melhorBackupConversao.item.apelido || melhorBackupConversao.item.nome?.substring(0, 25);
    insights.push({
      tipo: "conversao",
      titulo: "Maior potencial de escala",
      mensagem: `O backup "${nome}" tem ${fmtNum(melhorBackupConversao.vendasTotal)} vendas Shopee (rating ${melhorBackupConversao.rating.toFixed(1)}) vs ${fmtNum(principal.vendas_shopee || 0)} do principal.`,
      backupId: melhorBackupConversao.item.itemId,
    });
  }

  return insights.length > 0 ? insights : null;
}

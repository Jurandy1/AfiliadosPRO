import { fmt } from "../../../utils/formatters";
import { explainMetaQuality } from "./trafficGlossary";

const NIVEL_LABEL = {
  critico: { label: "Urgente", cor: "red" },
  alto: { label: "Atenção", cor: "amber" },
  medio: { label: "Observar", cor: "blue" },
  bom: { label: "Positivo", cor: "green" },
};

function avaliarAIDA(nome) {
  const n = (nome || "").toLowerCase();
  const score = { total: 0, dicas: [] };
  if (/[\?!]|como|por que|descubra|veja|não perca/.test(n)) score.total += 25;
  else score.dicas.push("Comece com pergunta ou número para chamar atenção.");
  if (/benefício|econom|grátis|frete|oferta|desconto|qualidade/.test(n)) score.total += 25;
  if (/você|seu|sua|ideal para|perfeito/.test(n)) score.total += 20;
  if (/compre|clique|garanta|peça|aproveite|link|shop/.test(n)) score.total += 30;
  else score.dicas.push("Falta um CTA claro (ex: Compre agora, Clique aqui).");
  score.total = Math.min(100, score.total);
  return score;
}

function mediaDesvio(arr) {
  if (!arr.length) return { media: 0, desvio: 0 };
  const media = arr.reduce((a, b) => a + b, 0) / arr.length;
  const desvio = Math.sqrt(arr.reduce((s, v) => s + (v - media) ** 2, 0) / arr.length);
  return { media, desvio };
}

function agentFinanceiro(meta, pins, th) {
  const alertas = [];
  const oportunidades = [];

  const cpcsValidos = meta
    .filter((m) => (m.resultados || 0) > 0 && (m.valorUsado || 0) > 0)
    .map((m) => (m.valorUsado || 0) / (m.resultados || 1));

  if (cpcsValidos.length >= 3) {
    const { media, desvio } = mediaDesvio(cpcsValidos);
    const limite = media + desvio * th.desvioAnomalias;
    meta
      .filter((m) => {
        const cpc = (m.resultados || 0) > 0 ? (m.valorUsado || 0) / (m.resultados || 1) : 0;
        return cpc > limite && (m.valorUsado || 0) > 10;
      })
      .slice(0, 3)
      .forEach((m) => {
        const cpc = (m.valorUsado || 0) / (m.resultados || 1);
        alertas.push({
          nivel: "alto",
          categoria: "dinheiro",
          titulo: "Anúncio caro demais",
          descricao: `"${m.nomeAnuncio}" está custando ${fmt(cpc)} por clique — bem acima da média da sua conta (${fmt(media)}).`,
          significado: "Cada clique está saindo caro e pode comer sua comissão da Shopee.",
          acao: "Reduza o lance, teste outro público ou pause até ajustar o criativo.",
        });
      });
  }

  meta
    .filter((m) => (m.valorUsado || 0) >= th.gastoSemClique && (m.resultados || 0) === 0)
    .slice(0, 5)
    .forEach((m) => {
      alertas.push({
        nivel: "critico",
        categoria: "dinheiro",
        titulo: "Gastando sem nenhum clique",
        descricao: `"${m.nomeAnuncio}" já gastou ${fmt(m.valorUsado)} e ninguém clicou.`,
        significado: "Dinheiro saindo da conta sem trazer visitante para o link de afiliado.",
        acao: "Pause agora. Revise imagem, texto e público antes de ligar de novo.",
      });
    });

  meta
    .filter((m) => {
      const ctr = m.ctr || 0;
      const cpc = (m.resultados || 0) > 0 ? (m.valorUsado || 0) / (m.resultados || 1) : 999;
      return (m.resultados || 0) > 5 && ctr >= th.ctrBom && cpc <= th.cpcBom;
    })
    .slice(0, 3)
    .forEach((m) => {
      oportunidades.push({
        impacto: "alto",
        titulo: "Anúncio eficiente — vale escalar",
        descricao: `"${m.nomeAnuncio}" tem bom CTR e CPC baixo.`,
        significado: "Este anúncio traz cliques baratos; aumentar budget pode trazer mais vendas.",
        acao: "Aumente o orçamento em 20–30% e observe por 2 dias.",
      });
    });

  pins
    .filter((p) => (p.spend || 0) >= th.gastoSemClique && (p.pinClicks || 0) === 0)
    .slice(0, 2)
    .forEach((p) => {
      alertas.push({
        nivel: "critico",
        categoria: "pinterest",
        titulo: "Pin gastando sem cliques",
        descricao: `"${p.adName}" gastou ${fmt(p.spend)} sem cliques.`,
        significado: "O pin não está gerando interesse.",
        acao: "Troque a imagem (vertical 1000×1500) e use texto curto na arte.",
      });
    });

  return { alertas, oportunidades };
}

function explainRanking(raw, tipo) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "_");
  if (!s || s === "–" || s === "UNKNOWN") return null;
  if (s === "BELOW_AVERAGE") {
    return {
      titulo: tipo === "engajamento" ? "Pouco engajamento" : "Poucas conversões",
      significado: tipo === "engajamento"
        ? "As pessoas veem mas não interagem (curtem, comentam, clicam)."
        : "Quem clica raramente completa a ação desejada (visitar seu link).",
      acao: tipo === "engajamento"
        ? "Teste imagem mais chamativa ou vídeo curto nos primeiros 3 segundos."
        : "Revise a landing (link Shopee), preço e oferta — o clique precisa valer a pena.",
    };
  }
  return null;
}

function agentMetaApi(meta, th) {
  const alertas = [];
  const oportunidades = [];

  meta
    .filter((m) => {
      const ext = m.cliquesExternos || 0;
      const link = m.resultados || 0;
      return (m.valorUsado || 0) > 25 && link > 10 && ext > 0 && ext < link * 0.5;
    })
    .slice(0, 2)
    .forEach((m) => {
      alertas.push({
        nivel: "medio",
        categoria: "meta_api",
        titulo: "Muitos cliques não saem do Meta",
        descricao: `"${m.nomeAnuncio}": ${m.resultados} cliques no anúncio, mas só ${m.cliquesExternos || 0} foram para seu link.`,
        significado: "Parte do tráfego fica no Facebook/Instagram e não chega na Shopee.",
        acao: "Use objetivo de tráfego/conversão para link externo e CTA direto (Compre agora).",
      });
    });

  meta
    .filter((m) => (m.cpm || 0) > 35 && (m.impressoes || 0) > 2000)
    .slice(0, 2)
    .forEach((m) => {
      alertas.push({
        nivel: "medio",
        categoria: "meta_api",
        titulo: "CPM alto — impressão cara",
        descricao: `"${m.nomeAnuncio}" paga ${fmt(m.cpm)} por mil impressões.`,
        significado: "Está caro só para aparecer; pode comer margem antes de alguém clicar.",
        acao: "Teste público mais amplo ou criativo com qualidade acima da média.",
      });
    });

  meta
    .filter((m) => (m.valorUsado || 0) > 30 && (m.alcance || 0) > 0 && (m.frequencia || 0) >= th.frequenciaFadiga)
    .slice(0, 2)
    .forEach((m) => {
      alertas.push({
        nivel: "alto",
        categoria: "meta_api",
        titulo: "Mesmas pessoas vendo de novo",
        descricao: `"${m.nomeAnuncio}": alcance ${(m.alcance || 0).toLocaleString("pt-BR")} pessoas, frequência ${(m.frequencia || 0).toFixed(1)}x.`,
        significado: "Você está gastando para repetir o anúncio para quem já viu várias vezes.",
        acao: "Amplie o público ou troque criativos para renovar o interesse.",
      });
    });

  meta
    .filter((m) => (m.valorUsado || 0) > 15)
    .sort((a, b) => (b.valorUsado || 0) - (a.valorUsado || 0))
    .slice(0, 8)
    .forEach((m) => {
      const eng = explainRanking(m.engajamento, "engajamento");
      if (eng) {
        alertas.push({
          nivel: "medio",
          categoria: "meta_api",
          titulo: `${eng.titulo} (Meta)`,
          descricao: `"${m.nomeAnuncio}" — ranking de engajamento abaixo da média.`,
          significado: eng.significado,
          acao: eng.acao,
        });
      }
      const conv = explainRanking(m.conversao, "conversao");
      if (conv) {
        alertas.push({
          nivel: "alto",
          categoria: "meta_api",
          titulo: `${conv.titulo} (Meta)`,
          descricao: `"${m.nomeAnuncio}" — ranking de conversão abaixo da média.`,
          significado: conv.significado,
          acao: conv.acao,
        });
      }
    });

  meta
    .filter((m) => {
      const q = explainMetaQuality(m.qualidade);
      return q.label === "Acima da média" && (m.resultados || 0) > 8;
    })
    .slice(0, 2)
    .forEach((m) => {
      oportunidades.push({
        impacto: "alto",
        titulo: "Meta recomenda este anúncio",
        descricao: `"${m.nomeAnuncio}" está acima da média em qualidade.`,
        significado: "O algoritmo tende a entregar mais e cobrar menos por este criativo.",
        acao: "Duplique a estrutura (formato + CTA) em novos testes.",
      });
    });

  return { alertas, oportunidades };
}

function agentCriativos(meta, th) {
  const alertas = [];
  const oportunidades = [];
  const insights = [];

  meta
    .filter((m) => (m.frequencia || 0) >= th.frequenciaFadiga && (m.valorUsado || 0) > 20)
    .slice(0, 3)
    .forEach((m) => {
      alertas.push({
        nivel: "medio",
        categoria: "criativo",
        titulo: "Público cansado do mesmo anúncio",
        descricao: `"${m.nomeAnuncio}" foi visto em média ${(m.frequencia || 0).toFixed(1)}x por pessoa.`,
        significado: "Quando a frequência passa de 3–4, as pessoas ignoram o anúncio.",
        acao: "Crie 1–2 variações de imagem/texto ou amplie o público.",
      });
    });

  meta
    .filter((m) => {
      const q = explainMetaQuality(m.qualidade);
      return q.label === "Abaixo da média" && (m.valorUsado || 0) > 15;
    })
    .slice(0, 3)
    .forEach((m) => {
      alertas.push({
        nivel: "alto",
        categoria: "criativo",
        titulo: "Meta classificou como fraco",
        descricao: `"${m.nomeAnuncio}" está abaixo da média na qualidade.`,
        significado: "O algoritmo cobra mais caro ou mostra menos anúncios assim.",
        acao: "Teste novo criativo com CTA claro e imagem diferente.",
      });
    });

  const semCTA = meta.filter((m) => avaliarAIDA(m.nomeAnuncio).total < 35 && (m.valorUsado || 0) > 10);
  if (semCTA.length) {
    alertas.push({
      nivel: "medio",
      categoria: "criativo",
      titulo: `${semCTA.length} anúncio(s) sem chamada para ação`,
      descricao: "Nomes/copy sem CTA claro (Compre, Clique, Garanta).",
      significado: "Pessoas veem o anúncio mas não sabem o que fazer.",
      acao: "Renomeie ou ajuste o texto principal com ação direta.",
    });
  }

  const comDados = meta.filter((m) => (m.valorUsado || 0) > 5);
  if (comDados.length >= 4) {
    const sorted = [...comDados].sort((a, b) => (b.resultados || 0) - (a.resultados || 0));
    const top = sorted.slice(0, Math.ceil(sorted.length / 2));
    const bottom = sorted.slice(Math.ceil(sorted.length / 2));
    const aidaTop = Math.round(top.reduce((s, m) => s + avaliarAIDA(m.nomeAnuncio).total, 0) / top.length);
    const aidaBottom = Math.round(bottom.reduce((s, m) => s + avaliarAIDA(m.nomeAnuncio).total, 0) / bottom.length);
    insights.push({
      titulo: "Melhores vs piores anúncios",
      dados: {
        aidaTop,
        aidaBottom,
        melhor: top[0]?.nomeAnuncio,
        pior: bottom[bottom.length - 1]?.nomeAnuncio,
      },
    });
  }

  return { alertas, oportunidades, insights };
}

function agentAnomalias(meta, th) {
  const alertas = [];
  const ctrs = meta.filter((m) => (m.impressoes || 0) > 500).map((m) => m.ctr || 0);
  if (ctrs.length >= 5) {
    const { media, desvio } = mediaDesvio(ctrs);
    meta
      .filter((m) => (m.impressoes || 0) > 500 && (m.ctr || 0) < media - desvio * th.desvioAnomalias)
      .slice(0, 2)
      .forEach((m) => {
        alertas.push({
          nivel: "medio",
          categoria: "desempenho",
          titulo: "CTR muito abaixo do normal",
          descricao: `"${m.nomeAnuncio}" tem CTR ${(m.ctr || 0).toFixed(2)}% (média da conta: ${media.toFixed(2)}%).`,
          significado: "Poucas pessoas clicam ao ver este anúncio.",
          acao: "Troque a imagem ou o primeiro texto — teste algo mais chamativo.",
        });
      });
  }
  return { alertas, oportunidades: [] };
}

function calcScore(val, bom, ruim, invert = false) {
  if (!val && val !== 0) return 50;
  if (invert) {
    if (val <= bom) return 90;
    if (val >= ruim) return 20;
    return 55;
  }
  if (val >= bom) return 90;
  if (val <= ruim) return 25;
  return 55;
}

export function analisarTrafego(meta, pins, thresholds) {
  const th = thresholds;
  const fin = agentFinanceiro(meta, pins, th);
  const cria = agentCriativos(meta, th);
  const anom = agentAnomalias(meta, th);
  const api = agentMetaApi(meta, th);

  const alertas = [...fin.alertas, ...cria.alertas, ...anom.alertas, ...api.alertas].slice(0, 12);
  const oportunidades = [...fin.oportunidades, ...cria.oportunidades, ...api.oportunidades].slice(0, 6);

  const totalGasto = meta.reduce((s, m) => s + (m.valorUsado || 0), 0);
  const totalCliques = meta.reduce((s, m) => s + (m.resultados || 0), 0);
  const totalCliquesExternos = meta.reduce((s, m) => s + (m.cliquesExternos || 0), 0);
  const totalImp = meta.reduce((s, m) => s + (m.impressoes || 0), 0);
  const totalAlcance = meta.reduce((s, m) => s + (m.alcance || 0), 0);
  const cpcMeta = totalCliques > 0 ? totalGasto / totalCliques : 0;
  const ctrGlobal = totalImp > 0 ? (totalCliques / totalImp) * 100 : 0;
  const comFreq = meta.filter((m) => m.frequencia);
  const freqMedia = comFreq.length
    ? comFreq.reduce((s, m) => s + (m.frequencia || 0), 0) / comFreq.length
    : 0;

  const criticos = alertas.filter((a) => a.nivel === "critico").length;
  const penalidade = Math.min(40, criticos * 12 + alertas.filter((a) => a.nivel === "alto").length * 5);

  const scoreFin = meta.length
    ? Math.max(0, Math.round(calcScore(cpcMeta, th.cpcBom, th.cpcAlto, true) * 0.6 + calcScore(ctrGlobal, th.ctrBom, th.ctrFadiga) * 0.4 - penalidade * 0.5))
    : 0;

  const scoreCria = meta.length
    ? Math.max(0, Math.round(meta.reduce((s, m) => s + avaliarAIDA(m.nomeAnuncio).total, 0) / meta.length - penalidade * 0.3))
    : 0;

  const scoreAnom = meta.length ? Math.max(0, 100 - penalidade) : 0;
  const scoreGeral = meta.length || pins.length
    ? Math.round((scoreFin * 0.45 + scoreCria * 0.35 + scoreAnom * 0.2))
    : 0;

  let veredito;
  let resumo;
  if (!meta.length && !pins.length) {
    veredito = "Sem dados";
    resumo = "Importe ou sincronize Meta Ads e Pinterest para receber recomendações automáticas.";
  } else if (criticos > 0) {
    veredito = "Ação urgente";
    resumo = `Encontramos ${criticos} problema(s) grave(s): anúncios gastando sem retorno. Resolva isso antes de aumentar budget.`;
  } else if (scoreGeral >= 70) {
    veredito = "Conta saudável";
    resumo = `Sua operação está bem (${scoreGeral}/100). ${oportunidades.length ? "Há oportunidades de escala nos anúncios eficientes." : "Continue monitorando CPC e CTR."}`;
  } else if (scoreGeral >= 45) {
    veredito = "Precisa ajustes";
    resumo = `Desempenho mediano (${scoreGeral}/100). ${alertas.length} ponto(s) de atenção — corrigir pode melhorar lucro sem gastar mais.`;
  } else {
    veredito = "Conta em risco";
    resumo = `Score ${scoreGeral}/100: muitos anúncios ineficientes. Pause os piores e foque nos que trazem cliques baratos.`;
  }

  const passos = [];
  if (criticos > 0) passos.push("Pause hoje os anúncios que gastam sem clique — isso para a 'sangria' imediata.");
  if (alertas.some((a) => a.categoria === "criativo")) passos.push("Crie 1–2 novos criativos com foto forte + CTA (Compre agora / Link na bio).");
  if (oportunidades.length) passos.push("Aumente 20% o budget dos anúncios com CPC baixo e CTR bom.");
  if (freqMedia >= th.frequenciaFadiga) passos.push("Frequência alta: troque imagens ou amplie público para não cansar quem já viu.");
  if (passos.length < 3) passos.push("Revise o dashboard 2x por semana: CPC, CTR e ROAS real (comissão ÷ gasto).");

  return {
    scoreGeral,
    scoreFin,
    scoreCria,
    scoreAnom,
    veredito,
    resumo,
    alertas,
    oportunidades,
    insights: cria.insights,
    passos,
    ctrGlobal,
    cpcMeta,
    freqMedia,
    totalAlcance,
    totalCliquesExternos,
    criticos,
    NIVEL_LABEL,
  };
}

export { avaliarAIDA, NIVEL_LABEL };

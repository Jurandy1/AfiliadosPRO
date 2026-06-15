/** Explicações em português claro para leigos */
export const TRAFFIC_GLOSSARY = {
  cpm: {
    label: "CPM",
    title: "Custo por mil impressões",
    text: "Quanto você paga para exibir seu anúncio 1.000 vezes. Quanto menor, mais barato chegar nas pessoas.",
  },
  ctr: {
    label: "CTR",
    title: "Taxa de cliques",
    text: "Porcentagem de pessoas que viram o anúncio e clicaram. CTR alto = criativo chamando atenção.",
  },
  cpc: {
    label: "CPC",
    title: "Custo por clique",
    text: "Quanto cada clique no anúncio custou. Afiliado Shopee: ideal manter baixo para sobrar margem de comissão.",
  },
  alcance: {
    label: "Alcance",
    title: "Pessoas únicas",
    text: "Quantas pessoas diferentes viram seus anúncios no período (sem contar repetição).",
  },
  frequencia: {
    label: "Frequência",
    title: "Vezes que a mesma pessoa viu",
    text: "Média de quantas vezes cada pessoa viu o anúncio. Acima de 3–4 pode cansar o público (fadiga).",
  },
  qualidade: {
    label: "Qualidade",
    title: "Nota do Meta sobre o anúncio",
    text: "Comparação com anúncios similares: Acima da média = bom; Abaixo = Meta cobra mais caro ou entrega menos.",
  },
  roas: {
    label: "ROAS",
    title: "Retorno sobre gasto",
    text: "Quanto de comissão Shopee você ganhou para cada R$ 1 gasto no anúncio. Acima de 1x = lucro.",
  },
  aida: {
    label: "AIDA",
    title: "Estrutura do texto do anúncio",
    text: "Atenção → Interesse → Desejo → Ação (CTA). Anúncios com CTA claro tendem a converter mais.",
  },
  cliquesExternos: {
    label: "Cliques link",
    title: "Saíram do Meta para seu link",
    text: "Cliques que levam para fora do Facebook/Instagram — o que importa para afiliado Shopee.",
  },
  engajamento: {
    label: "Engajamento",
    title: "Interação com o anúncio",
    text: "Meta compara curtidas, comentários e cliques com anúncios parecidos. Abaixo da média = criativo fraco.",
  },
  conversao: {
    label: "Conversão",
    title: "Quem clica e age",
    text: "Mede se quem clica realmente visita seu link ou compra. Abaixo da média = revisar oferta e página.",
  },
};

export function explainMetaQuality(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "_");
  const map = {
    ABOVE_AVERAGE: { label: "Acima da média", color: "#16A34A", hint: "Meta entrega bem este anúncio." },
    AVERAGE: { label: "Na média", color: "#D97706", hint: "Desempenho normal para o mercado." },
    BELOW_AVERAGE: { label: "Abaixo da média", color: "#DC2626", hint: "Considere trocar criativo ou público." },
    UNKNOWN: { label: "Sem dados", color: "#9CA3AF", hint: "Pouco volume ainda para o Meta avaliar." },
    "–": { label: "—", color: "#9CA3AF", hint: "" },
  };
  return map[s] || map.UNKNOWN;
}

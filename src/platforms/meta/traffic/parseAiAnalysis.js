/**
 * Parsers tolerantes para o markdown gerado pela IA em ai_daily_analysis.
 * Cada função falha silenciosamente (retorna null/array vazio) se o formato
 * mudar — o caller deve ter fallback.
 */

import { Trophy, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export function parseBrNumber(raw) {
  if (raw == null) return 0;
  // Remove tudo que não for dígito, ponto, vírgula, menos ou mais
  let s = String(raw).replace(/[^\d.,\-+]/g, "");
  if (!s) return 0;
  
  // Se tem vírgula, a vírgula é o decimal e o ponto é milhar
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Se tem ponto mas não tem vírgula (ex: cliques "1.003"), assumimos que é milhar
    s = s.replace(/\./g, "");
  }
  
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function classifyRoi(roi) {
  if (roi >= 30) return "champion";
  if (roi >= 0) return "ok";
  if (roi >= -30) return "warn";
  return "critical";
}

export function parseTotais(md) {
  if (!md) return null;
  // Aceita sinal antes ou depois de "R$" — markdown costuma gerar:
  //   "Lucro Líquido: -R$ 10,48" (sinal antes do R$)
  //   "Lucro Líquido: R$ -10,48" (sinal dentro do número)
  // Captura o trecho até próxima barra/quebra; parseBrNumber resolve o número.
  const reG = /Total\s+Gasto[*:\s]+([^|\n]+?)(?=\s*[|\n]|$)/i;
  const reC = /Total\s+Comiss[ãa]o[*:\s]+([^|\n]+?)(?=\s*[|\n]|$)/i;
  const reL = /Lucro\s+L[íi]quido[*:\s]+([^|\n]+?)(?=\s*[|\n]|$)/i;
  const reR = /ROI\s+Geral[*:\s]+([^|\n]+?)\s*%/i;

  const mG = md.match(reG);
  const mC = md.match(reC);
  const mL = md.match(reL);
  const mR = md.match(reR);
  if (!mG || !mC || !mL) return null;

  const gasto = parseBrNumber(mG[1]);
  const comissao = parseBrNumber(mC[1]);
  const lucro = parseBrNumber(mL[1]);
  const roiGeral = mR ? parseBrNumber(mR[1]) : (gasto > 0 ? (lucro / gasto) * 100 : 0);
  return { gasto, comissao, lucro, roiGeral };
}

export function parseTabelaCampanhas(md) {
  if (!md) return [];
  const lines = md.split("\n");
  const out = [];
  let inTable = false;
  let headerCols = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!inTable) {
      if (/\|/.test(line) && /campanha/i.test(line) && /roi/i.test(line)) {
        headerCols = line.split("|").map((c) => c.trim().toLowerCase()).filter(Boolean);
        inTable = true;
      }
      continue;
    }
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\|[\s\-:|]+\|?$/.test(line)) continue;

    const cells = line.split("|").map((c) => c.trim()).filter((c, i, arr) =>
      !(i === 0 && c === "") && !(i === arr.length - 1 && c === "")
    );
    if (cells.length < headerCols.length) continue;

    const get = (key) => {
      const idx = headerCols.findIndex((h) => h.includes(key));
      return idx >= 0 ? cells[idx] : "";
    };

    const roi = parseBrNumber(get("roi"));
    out.push({
      nome: get("campanha"),
      gasto: parseBrNumber(get("gasto")),
      cliques: parseBrNumber(get("clique")),
      comissao: parseBrNumber(get("comiss")),
      roi,
      status: classifyRoi(roi),
    });
  }
  return out;
}

export function parseCampanhaBlocos(md) {
  if (!md) return [];
  const re = /(?:^|\n)[^\n]*?([a-zA-Z0-9_]+)[`\s]*[—-]\s*ROI:\s*([+-]?[\d.,]+)\s*%/g;
  const matches = [];
  let m;
  while ((m = re.exec(md)) !== null) {
    matches.push({ nome: m[1], roi: parseBrNumber(m[2]), start: m.index, full: m[0] });
  }
  if (matches.length === 0) return [];

  const blocos = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : md.length;
    const trecho = md.slice(cur.start, end);

    const gMatch = trecho.match(/Gasto\s+R\$?\s*([\d.,]+)/i);
    const cMatch = trecho.match(/Comiss[ãa]o\s+R\$?\s*([\d.,]+)/i);
    const pMatch = trecho.match(/Preju[íi]zo:\s*R\$?\s*([+-]?[\d.,]+)/i);
    const lMatch = trecho.match(/Lucro:\s*R\$?\s*([+-]?[\d.,]+)/i);

    const recMatch = trecho.match(/Recomenda[çc][ãa]o:\s*([^\n]+(?:\n(?!\s*[-—•*])[^\n]+)*)/i);

    let analise = "";
    const afterHeader = trecho.replace(cur.full, "").trim();
    const recIdx = afterHeader.search(/Recomenda[çc][ãa]o:/i);
    if (recIdx > 0) analise = afterHeader.slice(0, recIdx).trim();
    else analise = afterHeader.trim();

    analise = analise
      .replace(/Gasto\s+R\$?\s*[\d.,]+[\s→\-*]*Comiss[ãa]o\s+R\$?\s*[\d.,]+[\s→\-*]*(Preju[íi]zo|Lucro):\s*R\$?\s*[+-]?[\d.,]+\s*\*?/i, "")
      .replace(/^[\s\-•*]+/gm, "")
      .trim();

    blocos.push({
      nome: cur.nome,
      roi: cur.roi,
      status: classifyRoi(cur.roi),
      gasto: gMatch ? parseBrNumber(gMatch[1]) : null,
      comissao: cMatch ? parseBrNumber(cMatch[1]) : null,
      lucro: lMatch ? parseBrNumber(lMatch[1]) : pMatch ? -parseBrNumber(pMatch[1]) : null,
      analise: analise.slice(0, 600),
      recomendacao: recMatch ? recMatch[1].trim().slice(0, 400) : "",
    });
  }
  return blocos;
}

export function parsePlanoAcao(md) {
  if (!md) return [];
  const idx = md.search(/Plano\s+de\s+A[çc][ãa]o(\s+Resumido)?|Prioridades\s+do\s+Dia/i);
  if (idx < 0) return [];
  const trecho = md.slice(idx).split("\n").slice(1).join("\n");
  const itens = [];
  for (const raw of trecho.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)/);
    if (m) {
      itens.push(m[1].trim());
      if (itens.length >= 10) break;
    } else if (itens.length === 0 && line.length > 8 && !line.startsWith("#") && !line.startsWith("|")) {
      itens.push(line);
    }
  }
  return itens;
}

export function parseResumoTextual(md) {
  if (!md) return "";
  const m = md.match(/Total\s+Gasto:[^\n]+\n+([^\n]+(?:\n(?!#)(?!\s*[-*•])[^\n]+)*)/i);
  if (!m) return "";
  return m[1].trim().slice(0, 800);
}

/**
 * Gera passos concretos de execução com base no status da campanha.
 */
export function getExecutionSteps(status, nome) {
  const safe = nome || "a campanha";
  const recipes = {
    critical: [
      "Abra o Gerenciador de Anúncios da Meta (business.facebook.com)",
      `Filtre por nome do anúncio: "${safe}"`,
      "Selecione a campanha/conjunto e clique em Desativar (não delete — preserva histórico de aprendizado)",
      "Marque o motivo no seu controle pessoal: ROI negativo após 48h",
      "Considere clonar o anúncio com público/criativo diferente antes de retomar",
    ],
    warn: [
      "Abra o Gerenciador de Anúncios da Meta",
      `Filtre por "${safe}"`,
      "Reduza o orçamento diário em 50%",
      "Acompanhe nas próximas 24h: se o ROI continuar caindo, pause",
      "Se subir, retorne ao orçamento original e mantenha em observação por +48h",
    ],
    champion: [
      "Abra o Gerenciador de Anúncios da Meta",
      `Filtre por "${safe}"`,
      "Aumente o orçamento diário em 20–30% (regra da rampa suave — nunca dobre de uma vez)",
      "Acompanhe por 48h: se o ROI cair mais de 20%, recue 10%",
      "Se mantiver, repita o aumento na semana seguinte",
    ],
    ok: [
      "Abra o Gerenciador de Anúncios da Meta",
      `Filtre por "${safe}"`,
      "Mantenha o orçamento atual",
      "Crie um teste A/B trocando 1 elemento (gancho, headline ou primeiro frame)",
      "Compare o ROI após 72h e mantenha o vencedor",
    ],
  };
  return recipes[status] || [];
}

/**
 * Estimativa de impacto financeiro da ação recomendada.
 * Conservadora — assume mesma performance do período analisado.
 */
export function getEstimatedImpact(bloco, periodoDias = 2) {
  if (bloco.lucro == null) return null;

  const lucroDiario = bloco.lucro / Math.max(1, periodoDias);

  if (bloco.status === "critical") {
    return {
      tipo: "economia",
      label: "Economia ao pausar",
      diario: Math.abs(lucroDiario),
      mensal: Math.abs(lucroDiario) * 30,
      descricao: `Pausando ${bloco.nome} agora, você para de queimar este valor por dia.`,
    };
  }
  if (bloco.status === "warn") {
    return {
      tipo: "economia",
      label: "Redução de perda (50% do budget)",
      diario: Math.abs(lucroDiario) * 0.5,
      mensal: Math.abs(lucroDiario) * 0.5 * 30,
      descricao: `Reduzindo o budget pela metade, o prejuízo cai aproximadamente pela metade enquanto você testa.`,
    };
  }
  if (bloco.status === "champion") {
    const escala = 0.25;
    return {
      tipo: "ganho",
      label: `Ganho estimado escalando ${escala * 100}%`,
      diario: lucroDiario * escala,
      mensal: lucroDiario * escala * 30,
      descricao: `Mantendo o ROI atual de +${bloco.roi.toFixed(1)}% e escalando o budget em ${escala * 100}%, o lucro extra estimado é este.`,
    };
  }
  if (bloco.status === "ok") {
    return {
      tipo: "ganho",
      label: "Potencial com otimização criativa",
      diario: lucroDiario * 0.15,
      mensal: lucroDiario * 0.15 * 30,
      descricao: "Estimativa conservadora se um teste A/B de criativo elevar o ROI em ~15%.",
    };
  }
  return null;
}

export const STATUS_CFG = {
  champion: {
    label: "Validado — Escalar",
    icon: Trophy,
    actionVerb: "Escalar",
    bg: "bg-emerald-50/60",
    bgSolid: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    textStrong: "text-emerald-800",
    chip: "bg-emerald-100 text-emerald-700 border-emerald-200",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  ok: {
    label: "Saudável",
    icon: CheckCircle2,
    actionVerb: "Manter",
    bg: "bg-green-50/40",
    bgSolid: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    textStrong: "text-green-800",
    chip: "bg-green-100 text-green-700 border-green-200",
    bar: "bg-green-500",
    dot: "bg-green-500",
  },
  warn: {
    label: "Em atenção",
    icon: AlertTriangle,
    actionVerb: "Reduzir budget",
    bg: "bg-amber-50/60",
    bgSolid: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    textStrong: "text-amber-800",
    chip: "bg-amber-100 text-amber-800 border-amber-200",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
  },
  critical: {
    label: "Crítico — Pausar",
    icon: XCircle,
    actionVerb: "Pausar",
    bg: "bg-rose-50/60",
    bgSolid: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-700",
    textStrong: "text-rose-800",
    chip: "bg-rose-100 text-rose-700 border-rose-200",
    bar: "bg-rose-500",
    dot: "bg-rose-500",
  },
};

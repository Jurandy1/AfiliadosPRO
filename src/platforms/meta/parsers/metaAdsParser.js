import { normalizeColumnName, buildColumnIndex, findColumn } from "../../../utils/columnNormalizer";
import { normalizeSubId } from "../../../utils/normalizeSubId";

export async function readMetaAdsWorkbook(arrayBuffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
}

export function parseMetaAdsRows(rows) {
  if (!rows || rows.length === 0) return [];

  const colIdx = buildColumnIndex(rows[0]);

  const COL_NOME = findColumn(colIdx, "nome_do_anuncio");
  const COL_GASTO = findColumn(colIdx, "valor_usado_brl", "valor_usado");
  const COL_CLIQUES = findColumn(colIdx, "cliques_no_link") || findColumn(colIdx, "resultados");
  const COL_CUSTO = findColumn(colIdx, "custo_por_resultados", "custo_por_resultado");
  const COL_IMPRESSOES = findColumn(colIdx, "impressoes");
  const COL_ALCANCE = findColumn(colIdx, "alcance");
  const COL_VEIC = findColumn(colIdx, "veiculacao_de_anuncio", "veiculacao");
  const COL_CONJUNTO = findColumn(colIdx, "nome_do_conjunto_de_anuncios", "conjunto_de_anuncios");
  const COL_DATA_INI = findColumn(colIdx, "inicio_dos_relatorios", "inicio");
  const COL_DATA_FIM = findColumn(colIdx, "encerramento_dos_relatorios", "encerramento");
  const COL_QUALIDADE = findColumn(colIdx, "classificacao_de_qualidade", "qualidade");
  const COL_ENGAJ = findColumn(colIdx, "classificacao_da_taxa_de_engajamento");
  const COL_CONV = findColumn(colIdx, "classificacao_da_taxa_de_conversao");

  const parsed = [];

  for (const row of rows) {
    const nomeAnuncio = COL_NOME ? String(row[COL_NOME] || "").trim() : "";
    if (!nomeAnuncio) continue;

    const veiculacao = COL_VEIC ? String(row[COL_VEIC] || "").trim() : "";
    const resultados = COL_CLIQUES
      ? parseInt(String(row[COL_CLIQUES] || "0").replace(/[^0-9]/g, ""), 10) || 0
      : 0;
    const custoResultado = COL_CUSTO
      ? parseFloat(String(row[COL_CUSTO] || "0").replace(",", ".")) || 0
      : 0;
    const valorUsado = COL_GASTO ? parseMetaValue(row[COL_GASTO]) : 0;
    const impressoes = COL_IMPRESSOES
      ? parseInt(String(row[COL_IMPRESSOES] || "0").replace(/[^0-9]/g, ""), 10) || 0
      : 0;
    const alcance = COL_ALCANCE
      ? parseInt(String(row[COL_ALCANCE] || "0").replace(/[^0-9]/g, ""), 10) || 0
      : 0;
    const ctr = impressoes > 0 ? resultados / impressoes : 0;

    const veicNorm = normalizeColumnName(veiculacao);
    let status = "Ativo";
    if (veicNorm.includes("not_delivering") || veicNorm.includes("paused") || veicNorm.includes("pausad")) {
      status = "Pausado";
    } else if (veicNorm.includes("active") || veicNorm.includes("ativo")) {
      status = "Ativo";
    }

    parsed.push({
      nomeAnuncio,
      subid: normalizeSubId(nomeAnuncio),
      conjuntoAnuncios: COL_CONJUNTO ? String(row[COL_CONJUNTO] || "").trim() : "",
      veiculacao,
      status,
      resultados,
      custoResultado: Math.round(custoResultado * 100) / 100,
      valorUsado: Math.round(valorUsado * 100) / 100,
      impressoes,
      alcance,
      ctr: Math.round(ctr * 10000) / 10000,
      qualidade: COL_QUALIDADE ? String(row[COL_QUALIDADE] || "–").trim() : "–",
      engajamento: COL_ENGAJ ? String(row[COL_ENGAJ] || "–").trim() : "–",
      conversao: COL_CONV ? String(row[COL_CONV] || "–").trim() : "–",
      dataInicio: COL_DATA_INI ? String(row[COL_DATA_INI] || "").trim() : "",
      dataFim: COL_DATA_FIM ? String(row[COL_DATA_FIM] || "").trim() : "",
    });
  }

  return parsed;
}

function parseMetaValue(val) {
  if (val == null || val === "") return 0;
  let s = String(val).trim().replace("R$", "").replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  return parseFloat(s) || 0;
}

export function parseMetaAdsRow(row) {
  const results = parseMetaAdsRows([row]);
  return results[0] || null;
}

/**
 * Replica exata da lógica do dashboard_completo.py:
 *   normalizar_coluna: lowercase + sem acentos + _ nos espaços + sem ()[]{} $
 *
 * Isso garante que "Comissão líquida do afiliado(R$)"
 * e "comissao_liquida_do_afiliado" sejam tratados igual.
 */
export function normalizeColumnName(col) {
  return String(col)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[()[\]{}\$]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Cria um índice { normalizedName → originalName } para um objeto de linha.
 */
export function buildColumnIndex(row) {
  const index = {};
  for (const key of Object.keys(row)) {
    index[normalizeColumnName(key)] = key;
  }
  return index;
}

/**
 * Encontra a coluna original cujo nome normalizado contém `substring`.
 * Retorna o nome original da coluna ou null.
 *
 * Equivalente ao Python:
 *   next((c for c in df.columns if "substring" in c), None)
 * onde df.columns já está normalizado.
 */
export function findColumn(columnIndex, ...substrings) {
  for (const substring of substrings) {
    for (const [normKey, origKey] of Object.entries(columnIndex)) {
      if (normKey.includes(substring)) return origKey;
    }
  }
  return null;
}

/**
 * Lê o valor de uma linha usando nome normalizado de coluna.
 */
export function getColValue(row, columnIndex, ...substrings) {
  const col = findColumn(columnIndex, ...substrings);
  return col != null ? row[col] : undefined;
}

/**
 * Normaliza headers de um array de objetos PapaParse.
 * Retorna novo array com colunas re-mapeadas para nomes normalizados.
 */
export function normalizeHeaders(rows) {
  if (!rows || rows.length === 0) return rows;
  return rows.map((row) => {
    const newRow = {};
    for (const [key, val] of Object.entries(row)) {
      newRow[normalizeColumnName(key)] = val;
    }
    return newRow;
  });
}

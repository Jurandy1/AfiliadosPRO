export function requireNonEmpty(rows, message = "Arquivo vazio") {
  if (!rows?.length) throw new Error(message);
  return rows;
}

export function requireNonEmptyText(text, message = "Arquivo vazio") {
  if (!text?.trim()) throw new Error(message);
  return text;
}

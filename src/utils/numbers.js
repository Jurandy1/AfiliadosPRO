export function parseBRL(val) {
  if (val == null || val === "" || val === "–") return 0;
  const s = String(val).trim().replace("R$", "").replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (s.includes(",")) return parseFloat(s.replace(",", ".")) || 0;
  return parseFloat(s) || 0;
}

export function parsePct(val) {
  if (val == null || val === "") return 0;
  const s = String(val).trim().replace("%", "").replace(",", ".");
  const n = parseFloat(s) || 0;
  return n > 1 ? n / 100 : n;
}

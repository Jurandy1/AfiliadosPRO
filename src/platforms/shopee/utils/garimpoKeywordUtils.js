/** Espelho do backend — termos de busca para exibição no UI. */

const STOP_WORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "com", "para", "por", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "ao", "aos", "à", "às", "the", "a", "o", "os", "as",
  "kit", "pack", "unidade", "un", "pcs", "pecas", "peças", "original", "novo", "nova",
  "promocao", "promoção", "frete", "gratis", "grátis", "shopee", "br", "oficial", "top",
  "mega", "super", "ultra", "premium", "linha", "modelo", "cor", "tamanho", "tam",
]);

const TIPOS_PRODUTO = new Set([
  "jeans", "calca", "calça", "calcas", "calças", "legging", "leggings", "short", "shorts",
  "bermuda", "bermudas", "saia", "saias", "vestido", "vestidos", "blusa", "blusas",
  "camisa", "camisas", "camiseta", "camisetas", "moletom", "moletons", "jaqueta", "jaquetas",
  "casaco", "casacos", "tenis", "tênis", "sapato", "sapatos", "sandalia", "sandália",
  "bota", "botas", "bolsa", "bolsas", "mochila", "mochilas", "relogio", "relógio",
  "oculos", "óculos", "bone", "boné", "chinelo", "chinelos", "cinto", "cintos",
  "estilete", "lamina", "lâmina", "faca", "panela", "frigideira", "organizador",
  "capa", "pelicula", "película", "carregador", "fone", "fones", "cabide", "cabides",
]);

const SIZE_RE = /^(pp|p|m|g|gg|xg|xxg|xxxg|xs|s|l|xl|xxl|\d+xl?|\d+)$/i;
const NOISE_RE = /^[\d.,]+(cm|mm|ml|kg|g|l|m|un|pc)?$/i;

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizarNome(nome) {
  return normalizarTexto(nome)
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !SIZE_RE.test(w) && !NOISE_RE.test(w));
}

export function extrairTermosBuscaGarimpo(nome, apelido) {
  const fonte = String(apelido || nome || "").trim();
  const tokens = tokenizarNome(fonte.length >= 3 ? fonte : nome);
  if (tokens.length === 0) {
    return { primario: "", alternativos: [], tokens: [] };
  }

  const tipoIdx = tokens.findIndex((t) => TIPOS_PRODUTO.has(t));
  const tipo = tipoIdx >= 0 ? tokens[tipoIdx] : null;
  const marcaTokens = tokens.filter((_, i) => i !== tipoIdx);

  const candidatos = [];

  if (marcaTokens.length && tipo) {
    candidatos.push(`${marcaTokens.slice(0, 2).join(" ")} ${tipo}`);
    if (marcaTokens.length >= 2) {
      candidatos.push(`${marcaTokens[0]} ${tipo}`);
    }
  }
  if (marcaTokens.length >= 2) candidatos.push(marcaTokens.slice(0, 2).join(" "));
  if (marcaTokens.length >= 1 && tipo) candidatos.push(`${marcaTokens[0]} ${tipo}`);
  if (tipo) candidatos.push(tipo);
  if (tokens.length >= 3) candidatos.push(tokens.slice(0, 3).join(" "));
  candidatos.push(tokens.slice(0, 2).join(" "));
  if (marcaTokens[0]) candidatos.push(marcaTokens[0]);

  const vistos = new Set();
  const ordenados = [];
  for (const c of candidatos) {
    const t = c.trim();
    if (t.length < 3 || vistos.has(t)) continue;
    vistos.add(t);
    ordenados.push(t);
  }

  return {
    primario: ordenados[0] || "",
    alternativos: ordenados.slice(1, 5),
    tokens,
  };
}

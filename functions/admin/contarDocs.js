const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const COLECOES_PARA_CONTAR = [
  "subid_daily",
  "shopee_daily",
  "produto_daily",
  "meta_ads_daily",
  "clique_daily",
  "log_perdas",
  "conversoes_processadas",
  "garimpo_produtos",
  "garimpo_recompra",
  "garimpo_alertas",
  "meta_ads",
  "produtos",
  "shopee_events",
  "sumarios",
  "sync_manifest",
  "backup_grupos",
  "backup_produtos",
];

exports.contarDocs = onRequest(
  {
    region: "southamerica-east1",
    timeoutSeconds: 120,
    memory: "256MiB",
    invoker: "public",
  },
  async (req, res) => {
    const TOKEN_ESPERADO = "contar-docs-2026-jurandy";
    if (req.query.token !== TOKEN_ESPERADO) {
      res.status(401).json({ erro: "token inválido" });
      return;
    }

    const inicio = Date.now();
    const resultado = {};
    const erros = {};

    for (const colecao of COLECOES_PARA_CONTAR) {
      try {
        const snap = await db.collection(colecao).count().get();
        resultado[colecao] = snap.data().count;
      } catch (err) {
        erros[colecao] = err.message;
        logger.warn(`Erro ao contar ${colecao}:`, err.message);
      }
    }

    const total = Object.values(resultado).reduce((acc, n) => acc + n, 0);
    const duracaoMs = Date.now() - inicio;

    const resposta = {
      projeto: "projetoafiliado-9ff07",
      executadoEm: new Date().toISOString(),
      duracaoMs,
      totalDocs: total,
      porColecao: resultado,
      ...(Object.keys(erros).length > 0 && { erros }),
    };

    logger.info("Contagem concluída", resposta);
    res.json(resposta);
  },
);

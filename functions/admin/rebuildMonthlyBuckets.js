const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { rebuildMonthlyBuckets, monthKeysForDates } = require("../lib/monthlyRollup");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

exports.rebuildMonthlyBuckets = onRequest(
  {
    region: "southamerica-east1",
    timeoutSeconds: 540,
    memory: "512MiB",
    invoker: "public",
  },
  async (req, res) => {
    const TOKEN_ESPERADO = "contar-docs-2026-jurandy";
    if (req.query.token !== TOKEN_ESPERADO) {
      res.status(401).json({ erro: "token inválido" });
      return;
    }

    const month = String(req.query.month || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    try {
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const r = await rebuildMonthlyBuckets(db, month);
        res.json({ ok: true, resultados: [r] });
        return;
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        const months = monthKeysForDates(iterDates(startDate, endDate));
        const resultados = [];
        for (const mk of months) {
          resultados.push(await rebuildMonthlyBuckets(db, mk));
        }
        res.json({ ok: true, resultados });
        return;
      }

      res.status(400).json({
        erro: "use ?month=YYYY-MM ou ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD",
      });
    } catch (err) {
      logger.error("rebuildMonthlyBuckets falhou", err);
      res.status(500).json({ ok: false, erro: String(err?.message || err) });
    }
  },
);

function iterDates(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

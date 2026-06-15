#!/usr/bin/env node
/**
 * Backfill one-shot: painel_resumo + subid_mensal a partir das coleções granulares.
 *
 * Uso (na raiz do projeto):
 *   set GOOGLE_APPLICATION_CREDENTIALS=caminho\serviceAccount.json
 *   node scripts/backfill-monthly-buckets.cjs
 *
 * Opcional: node scripts/backfill-monthly-buckets.cjs 2026-03 2026-06
 *
 * Requer firebase-admin (instalado em functions/): npm install --prefix functions
 */
"use strict";

const path = require("path");
const admin = require(path.join(__dirname, "../functions/node_modules/firebase-admin"));
const { rebuildMonthlyBuckets } = require("../functions/lib/monthlyRollup");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function monthKeysBetween(startMonth, endMonth) {
  const keys = [];
  let y = Number(startMonth.slice(0, 4));
  let m = Number(startMonth.slice(5, 7));
  const endY = Number(endMonth.slice(0, 4));
  const endM = Number(endMonth.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

async function detectMonthRange() {
  const shopee = await db.collection("shopee_daily").orderBy(admin.firestore.FieldPath.documentId()).limit(1).get();
  const shopeeLast = await db.collection("shopee_daily").orderBy(admin.firestore.FieldPath.documentId(), "desc").limit(1).get();
  const first = shopee.docs[0]?.id?.slice(0, 7);
  const last = shopeeLast.docs[0]?.id?.slice(0, 7);
  if (!first || !last) throw new Error("shopee_daily vazio — nada para backfill");
  return { first, last };
}

async function main() {
  const argStart = process.argv[2];
  const argEnd = process.argv[3];
  let months;
  if (argStart && argEnd) {
    months = monthKeysBetween(argStart, argEnd);
  } else {
    const { first, last } = await detectMonthRange();
    months = monthKeysBetween(first, last);
    console.log(`Detectado shopee_daily: ${first} → ${last}`);
  }

  console.log(`Backfill ${months.length} mês(es):`, months.join(", "));
  for (const mk of months) {
    const r = await rebuildMonthlyBuckets(db, mk);
    console.log(
      `  ✓ ${mk}: ${r.diasCount} dias, ${r.subidKeys} subids (${r.subidDocs} docs),`
      + ` produto_mensal=${r.produtoMensalCount ?? "?"} (${r.produtoDocs ?? "?"} produto_daily)`,
    );
  }
  console.log("Concluído.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

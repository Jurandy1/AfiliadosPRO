#!/usr/bin/env node
"use strict";

/**
 * shopee-promosapp-sync.cjs — API Shopee → Firestore (PromosApp node_once).
 *
 * Grava shopee_daily, subid_daily e produto_daily para um dia BRT.
 *
 * Uso:
 *   set GOOGLE_APPLICATION_CREDENTIALS=caminho\serviceAccount.json
 *   node scripts/shopee-promosapp-sync.cjs
 *   node scripts/shopee-promosapp-sync.cjs 2026-06-12
 *   node scripts/shopee-promosapp-sync.cjs --start 2026-06-01 --end 2026-06-12
 *   node scripts/shopee-promosapp-sync.cjs 2026-06-12 --dry-run
 *
 * Após sync em lote, salva output/shopee-pull-YYYY-MM-DD__YYYY-MM-DD.json
 * Use no audit com --nodes para validar Firestore sem novo fetch da API.
 *
 * Credenciais Shopee: SHOPEE_APP_ID + SHOPEE_APP_SECRET (ou SHOPEE_SECRET) em .env.local
 * Firebase: GOOGLE_APPLICATION_CREDENTIALS ou ADC padrão
 *
 * Requer: npm install --prefix functions  (firebase-admin)
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ENV_PATHS = [
  path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, "..", ".env.local"),
  path.join(__dirname, ".env"),
];

function loadEnvFiles() {
  for (const p of ENV_PATHS) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnvFiles()

const {
  dedupePullNodes,
  buildShopeePanelAppDayMap,
  dayEntryToFirestoreDoc,
  createEmptyDayEntry,
  finalizeSubFirestore,
  formatUnixToBRTDate,
  AGGREGATION_MODE,
} = require("../functions/lib/shopeePanelAppAgg");

if (!process.env.SHOPEE_APP_SECRET && process.env.SHOPEE_SECRET) {
  process.env.SHOPEE_APP_SECRET = process.env.SHOPEE_SECRET;
}

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const DATE_ARG = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || "";

function parseFlag(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    return argv[idx + 1];
  }
  return "";
}

const RANGE_START = parseFlag("start");
const RANGE_END = parseFlag("end") || RANGE_START;

const TIME_ZONE = process.env.SHOPEE_TZ || "America/Sao_Paulo";
const SHOPEE_BASE_URL =
  process.env.SHOPEE_BASE_URL ||
  "https://open-api.affiliate.shopee.com.br/graphql";
const SHOPEE_PAGE_LIMIT = Number(process.env.SHOPEE_PAGE_LIMIT || 200);
const BATCH_LIMIT = 450;

const APP_ID = process.env.SHOPEE_APP_ID || "";
const APP_SECRET = process.env.SHOPEE_APP_SECRET || "";
const DATE = DATE_ARG || process.env.DATE || "";

if (!APP_ID || !APP_SECRET) {
  console.error("Defina SHOPEE_APP_ID e SHOPEE_APP_SECRET (ou SHOPEE_SECRET) em .env.local.");
  process.exit(1);
}

let admin = null;
let db = null;

function getFirestore() {
  if (db) return db;

  const credPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credPath && !fs.existsSync(credPath)) {
    throw new Error(
      `Arquivo de credenciais não encontrado:\n  ${credPath}\n\n` +
        "Baixe a service account no Firebase Console (projetoafiliado-9ff07):\n" +
        "  Configurações do projeto → Contas de serviço → Gerar nova chave privada\n\n" +
        "Depois aponte para o arquivo REAL (não use o placeholder 'caminho\\' do README):\n" +
        '  set GOOGLE_APPLICATION_CREDENTIALS=C:\\Users\\PC\\Downloads\\projetoafiliado-9ff07-xxxx.json',
    );
  }
  if (!credPath) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS não definido.\n\n" +
        "Baixe a chave JSON no Firebase Console e rode:\n" +
        '  set GOOGLE_APPLICATION_CREDENTIALS=C:\\caminho\\real\\para\\chave.json',
    );
  }

  function requireFirebaseAdmin() {
    try {
      return require("firebase-admin");
    } catch {
      return require(path.join(__dirname, "../functions/node_modules/firebase-admin"));
    }
  }
  admin = requireFirebaseAdmin();
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  db = admin.firestore();
  return db;
}

const SUBID_ALIASES = {
  // "flare07": "flaire07",
};

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseNum(v) {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function parseQty(v) {
  const q = parseInt(v, 10);
  return q > 0 ? q : 1;
}

function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeSubId(raw) {
  const key = slugify(raw);
  return SUBID_ALIASES[key] || key || "missing_subid";
}

function normalizeShopeeSubId(utmContent) {
  let s = String(utmContent || "").trim();
  if (s.includes("-")) {
    const slot = s.split("-").find((p) => p.trim().length > 0);
    if (slot) s = slot.trim();
  }
  return normalizeSubId(s);
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const out = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = p.value;
  }

  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMs = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offsetMs);
}

function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Data inválida: ${ymd}. Use YYYY-MM-DD`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function getDateRange(dateKey) {
  if (dateKey) {
    const p = parseYmd(dateKey);
    const startUtc = zonedDateTimeToUtc(
      p.year,
      p.month,
      p.day,
      0,
      0,
      0,
      TIME_ZONE
    );
    const endUtc = zonedDateTimeToUtc(
      p.year,
      p.month,
      p.day,
      23,
      59,
      59,
      TIME_ZONE
    );
    return {
      dateKey,
      startTs: Math.floor(startUtc.getTime() / 1000),
      endTs: Math.floor(endUtc.getTime() / 1000),
    };
  }

  const now = new Date();
  const z = getZonedParts(now, TIME_ZONE);
  const todayStartUtc = zonedDateTimeToUtc(
    z.year,
    z.month,
    z.day,
    0,
    0,
    0,
    TIME_ZONE
  );
  const yesterdayStartUtc = new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000);
  const y = getZonedParts(yesterdayStartUtc, TIME_ZONE);

  return {
    dateKey: `${y.year}-${String(y.month).padStart(2, "0")}-${String(y.day).padStart(2, "0")}`,
    startTs: Math.floor(yesterdayStartUtc.getTime() / 1000),
    endTs: Math.floor(todayStartUtc.getTime() / 1000) - 1,
  };
}

function compareYmd(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function addUtcDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function listDateKeysInRange(startKey, endKey) {
  const start = parseYmd(startKey);
  const end = parseYmd(endKey);
  if (compareYmd(start, end) > 0) {
    throw new Error("Data inicial maior que a final.");
  }
  const out = [];
  let current = start;
  while (compareYmd(current, end) <= 0) {
    out.push(
      `${current.year}-${String(current.month).padStart(2, "0")}-${String(current.day).padStart(2, "0")}`,
    );
    current = addUtcDays(current, 1);
  }
  return out;
}

function buildShopeeQuery(startTs, endTs, scrollId = null) {
  const scroll = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";

  return `
    query {
      conversionReport(
        limit: ${SHOPEE_PAGE_LIMIT},
        purchaseTimeStart: ${startTs},
        purchaseTimeEnd: ${endTs}${scroll}
      ) {
        nodes {
          purchaseTime
          conversionId
          utmContent
          totalCommission
          netCommission
          orders {
            orderId
            orderStatus
            items {
              itemId
              itemName
              shopId
              shopName
              qty
              actualAmount
              itemTotalCommission
              attributionType
              fraudStatus
              completeTime
            }
          }
        }
        pageInfo {
          hasNextPage
          scrollId
          limit
        }
      }
    }
  `;
}

function buildAuthHeader(body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHash("sha256")
    .update(`${APP_ID}${timestamp}${body}${APP_SECRET}`)
    .digest("hex");

  return `SHA256 Credential=${APP_ID}, Timestamp=${timestamp}, Signature=${signature}`;
}

async function shopeeGraphQL(query) {
  const body = JSON.stringify({ query });
  const res = await fetch(SHOPEE_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildAuthHeader(body),
    },
    body,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Shopee retornou algo não-JSON: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`Shopee HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Shopee GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

async function fetchAllNodes(startTs, endTs) {
  const all = [];
  let scrollId = null;
  let pages = 0;

  while (true) {
    const query = buildShopeeQuery(startTs, endTs, scrollId);
    const data = await shopeeGraphQL(query);
    const report = data?.conversionReport;
    if (!report) throw new Error("Resposta sem conversionReport.");

    const nodes = Array.isArray(report.nodes) ? report.nodes : [];
    all.push(...nodes);
    pages += 1;
    process.stderr.write(`  página ${pages}: +${nodes.length} (total bruto ${all.length})\n`);

    if (!report.pageInfo?.hasNextPage || !report.pageInfo?.scrollId) break;
    scrollId = report.pageInfo.scrollId;
  }

  const deduped = dedupePullNodes(all);
  if (deduped.length !== all.length) {
    process.stderr.write(
      `  dedupe cid+orderId: ${all.length} → ${deduped.length} nodes\n`,
    );
  }

  return { nodes: deduped, rawNodes: all.length, pages };
}

function savePullSnapshot(dates, prefetched) {
  const outDir = path.join(__dirname, "..", "output");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(
    outDir,
    `shopee-pull-${dates[0]}__${dates[dates.length - 1]}.json`,
  );
  const payload = {
    startDateKey: dates[0],
    endDateKey: dates[dates.length - 1],
    pulledAt: new Date().toISOString(),
    pages: prefetched.pages,
    rawNodes: prefetched.rawNodes,
    pullUniqueNodes: prefetched.nodes.length,
    nodes: prefetched.nodes,
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function groupNodesByConversionId(nodes) {
  const map = new Map();
  for (const node of nodes) {
    const cid =
      String(node?.conversionId || "").trim() ||
      `__solo_${node?.purchaseTime || 0}_${node?.orders?.[0]?.orderId || "?"}`;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(node);
  }
  return map;
}

function mergeGroupNodes(group) {
  if (group.length === 1) return group[0];

  const merged = {
    ...group[0],
    orders: [],
  };
  const seenOrders = new Set();

  for (const node of group) {
    for (const ord of Array.isArray(node.orders) ? node.orders : []) {
      const orderId = String(ord?.orderId || "");
      if (orderId && seenOrders.has(orderId)) continue;
      if (orderId) seenOrders.add(orderId);
      merged.orders.push(ord);
    }
  }

  return merged;
}

function comissaoNodeOnceGrupo(group) {
  let sum = 0;
  for (const node of group) sum += nodeOnceCommission(node);
  return roundMoney(sum);
}

function isUnpaidStatus(status) {
  return String(status || "").toUpperCase().trim() === "UNPAID";
}

function isCancelledStatus(status) {
  const s = String(status || "").toUpperCase().trim();
  if (s === "PENDING" || s === "COMPLETED" || s === "UNPAID") return false;
  return (
    s.includes("CANCEL") ||
    s.includes("RETURN") ||
    s.includes("REFUND") ||
    s.includes("INVALID") ||
    s.includes("REJECT") ||
    s.includes("FAIL")
  );
}

function isCompletedStatus(status) {
  const s = String(status || "").toUpperCase().trim();
  return s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET");
}

function isFraudItem(item) {
  return String(item?.fraudStatus || "").toUpperCase().trim() === "FRAUD";
}

function shopeeIsDireta(attr) {
  const val = String(attr || "").toUpperCase();
  return val.includes("SAME SHOP") || val.includes("SAME_SHOP");
}

function nodeOnceCommission(node) {
  const net = parseNum(node?.netCommission);
  if (net > 0) return roundMoney(net);
  const total = parseNum(node?.totalCommission);
  if (total > 0) return roundMoney(total);

  let fallback = 0;
  for (const ord of Array.isArray(node?.orders) ? node.orders : []) {
    for (const item of Array.isArray(ord?.items) ? ord.items : []) {
      fallback += parseNum(item?.itemTotalCommission);
    }
  }
  return roundMoney(fallback);
}

function splitComissaoPorStatusItens(ordersValidados) {
  let bruto = 0;
  let validados = 0;
  let concluidos = 0;

  for (const ord of ordersValidados) {
    const items = ord.items || [];
    const soma = items.reduce(
      (acc, item) => acc + parseNum(item?.itemTotalCommission),
      0
    );
    bruto += soma;
    validados += 1;
    if (isCompletedStatus(ord.orderStatus)) concluidos += 1;
  }

  if (validados === 0) return { concluida: 0, pendente: 0, bruto: 0 };

  const conversaoConcluida = validados > 0 && concluidos === validados;
  return conversaoConcluida
    ? { concluida: bruto, pendente: 0, bruto }
    : { concluida: 0, pendente: bruto, bruto };
}

function escalaSplitComissaoConversao(split, totalAlvo) {
  const alvo = roundMoney(totalAlvo);
  const bruto = roundMoney(split?.bruto || 0);

  if (alvo <= 0) return { concluida: 0, pendente: 0 };
  if (bruto <= 0) {
    return split?.concluida > 0
      ? { concluida: alvo, pendente: 0 }
      : { concluida: 0, pendente: alvo };
  }

  const concluida = roundMoney((roundMoney(split.concluida) / bruto) * alvo);
  const pendente = roundMoney(alvo - concluida);
  return { concluida, pendente };
}

function createDayAcc(dateKey) {
  return {
    date: dateKey,
    pedidosIds: new Set(),
    pedidosCompletosIds: new Set(),
    pedidosPendentesIds: new Set(),
    pedidosCancelados: 0,
    pedidosNaoPagos: 0,
    itensVendidos: 0,
    diretas: 0,
    indiretas: 0,
    faturamentoBruto: 0,
    comissaoConcluida: 0,
    comissaoPendente: 0,
    comissaoNaoPaga: 0,
  };
}

function createSubAcc(dateKey, subid) {
  return {
    date: dateKey,
    subid,
    pedidosIds: new Set(),
    pedidosCompletosIds: new Set(),
    pedidosPendentesIds: new Set(),
    pedidosCancelados: 0,
    pedidosNaoPagos: 0,
    itensVendidos: 0,
    diretas: 0,
    indiretas: 0,
    faturamentoBruto: 0,
    comissoes: 0,
    comissaoConcluida: 0,
    comissaoPendente: 0,
    comissaoNaoPaga: 0,
  };
}

function createProductAcc(dateKey, itemId, itemName) {
  return {
    date: dateKey,
    itemId: String(itemId || ""),
    itemName: String(itemName || ""),
    itensVendidos: 0,
    faturamentoBruto: 0,
    comissoes: 0,
    comissaoConcluida: 0,
    comissaoPendente: 0,
    diretas: 0,
    indiretas: 0,
  };
}

/** Campos compatíveis com metricsRepository / shopee_daily do backend. */
function finalizeDay(day) {
  const comissaoTotal = roundMoney(day.comissaoConcluida + day.comissaoPendente);
  const fat = roundMoney(day.faturamentoBruto);

  return {
    data: day.date,
    pedidos: day.pedidosIds.size,
    pedidos_concluidos: day.pedidosCompletosIds.size,
    pedidos_pendentes: day.pedidosPendentesIds.size,
    pedidos_cancelados: day.pedidosCancelados,
    pedidos_nao_pagos: day.pedidosNaoPagos,
    vendas: day.itensVendidos,
    vendas_diretas: day.diretas,
    vendas_indiretas: day.indiretas,
    faturamento: fat,
    gmv_total: fat,
    comissao_concluida: roundMoney(day.comissaoConcluida),
    comissao_pendente: roundMoney(day.comissaoPendente),
    comissao_nao_paga: roundMoney(day.comissaoNaoPaga),
    comissao_total: comissaoTotal,
    comissao_real: comissaoTotal,
    comissao_estimada: comissaoTotal,
    aggregation_mode: "promosapp-node-once",
    splitCriterio: "conversao_promosapp",
    origem: "shopee_promosapp_sync_script",
  };
}

function finalizeSub(sub) {
  return {
    data: sub.date,
    subid: sub.subid,
    pedidos: sub.pedidosIds.size,
    qtd_itens: sub.itensVendidos,
    faturamento: roundMoney(sub.faturamentoBruto),
    comissoes: roundMoney(sub.comissoes),
    comissoes_estimadas: roundMoney(sub.comissoes),
    vendas_diretas: sub.diretas,
    vendas_indiretas: sub.indiretas,
  };
}

function finalizeProduct(prod) {
  return {
    data: prod.date,
    produto_id: prod.itemId || "desconhecido",
    nome: prod.itemName || "Produto",
    qtd_itens: prod.itensVendidos,
    faturamento: roundMoney(prod.faturamentoBruto),
    comissoes: roundMoney(prod.comissoes),
    comissoes_pendentes: roundMoney(prod.comissaoPendente),
    comissoes_concluidas: roundMoney(prod.comissaoConcluida),
  };
}

function aggregatePromosApp(nodes, dateKey) {
  const day = createDayAcc(dateKey);
  const subMap = new Map();
  const prodMap = new Map();

  function getSub(subid) {
    if (!subMap.has(subid)) subMap.set(subid, createSubAcc(dateKey, subid));
    return subMap.get(subid);
  }

  function getProd(itemId, itemName) {
    const pid = String(itemId || slugify(itemName) || "sem_item");
    const key = `${dateKey}_${pid}`;
    if (!prodMap.has(key)) {
      prodMap.set(key, createProductAcc(dateKey, pid, itemName || ""));
    }
    return prodMap.get(key);
  }

  for (const node of nodes) {
    const subid = normalizeShopeeSubId(node?.utmContent);
    const sub = getSub(subid);
    const groupCommission = node.__groupCommission;

    const validOrders = [];
    const validItemsForNode = [];

    for (const ord of Array.isArray(node?.orders) ? node.orders : []) {
      const orderId = String(ord?.orderId || "");
      const status = String(ord?.orderStatus || "");
      const cleanItems = (Array.isArray(ord?.items) ? ord.items : []).filter(
        (item) => !isFraudItem(item)
      );

      if (!cleanItems.length) continue;

      if (isUnpaidStatus(status)) {
        const unpaidCommission = roundMoney(
          cleanItems.reduce((acc, item) => acc + parseNum(item?.itemTotalCommission), 0)
        );
        if (orderId) {
          day.pedidosNaoPagos += 1;
          sub.pedidosNaoPagos += 1;
        }
        day.comissaoNaoPaga += unpaidCommission;
        sub.comissaoNaoPaga += unpaidCommission;
        continue;
      }

      if (isCancelledStatus(status)) {
        if (orderId) {
          day.pedidosCancelados += 1;
          sub.pedidosCancelados += 1;
        }
        continue;
      }

      validOrders.push({ orderId, orderStatus: status, items: cleanItems });

      if (orderId) {
        day.pedidosIds.add(orderId);
        sub.pedidosIds.add(orderId);

        if (isCompletedStatus(status)) {
          day.pedidosCompletosIds.add(orderId);
          sub.pedidosCompletosIds.add(orderId);
        } else {
          day.pedidosPendentesIds.add(orderId);
          sub.pedidosPendentesIds.add(orderId);
        }
      }

      for (const item of cleanItems) {
        const qty = parseQty(item?.qty);
        const amount = parseNum(item?.actualAmount);
        const isDireta = shopeeIsDireta(item?.attributionType);

        day.itensVendidos += qty;
        day.faturamentoBruto += amount;
        if (isDireta) day.diretas += qty;
        else day.indiretas += qty;

        sub.itensVendidos += qty;
        sub.faturamentoBruto += amount;
        if (isDireta) sub.diretas += qty;
        else sub.indiretas += qty;

        const prod = getProd(item?.itemId, item?.itemName);
        prod.itensVendidos += qty;
        prod.faturamentoBruto += amount;
        if (isDireta) prod.diretas += qty;
        else prod.indiretas += qty;

        validItemsForNode.push({ item, prod });
      }
    }

    if (!validOrders.length) continue;

    const comissaoNode =
      typeof groupCommission === "number" && groupCommission > 0
        ? groupCommission
        : nodeOnceCommission(node);
    if (comissaoNode <= 0) continue;

    const splitBase = splitComissaoPorStatusItens(validOrders);
    const split = escalaSplitComissaoConversao(splitBase, comissaoNode);

    day.comissaoConcluida += split.concluida;
    day.comissaoPendente += split.pendente;

    sub.comissoes += comissaoNode;
    sub.comissaoConcluida += split.concluida;
    sub.comissaoPendente += split.pendente;

    const baseItemCommission = roundMoney(
      validItemsForNode.reduce(
        (acc, row) => acc + parseNum(row.item?.itemTotalCommission),
        0
      )
    );
    const baseItemAmount = roundMoney(
      validItemsForNode.reduce((acc, row) => acc + parseNum(row.item?.actualAmount), 0)
    );

    let remainingTotal = roundMoney(comissaoNode);
    let remainingConcl = roundMoney(split.concluida);
    let remainingPend = roundMoney(split.pendente);

    validItemsForNode.forEach((row, index) => {
      const isLast = index === validItemsForNode.length - 1;
      const base =
        baseItemCommission > 0
          ? parseNum(row.item?.itemTotalCommission)
          : baseItemAmount > 0
          ? parseNum(row.item?.actualAmount)
          : 1;

      const denom =
        baseItemCommission > 0
          ? baseItemCommission
          : baseItemAmount > 0
          ? baseItemAmount
          : validItemsForNode.length;

      const ratio = denom > 0 ? base / denom : 0;

      const totalPart = isLast ? remainingTotal : roundMoney(comissaoNode * ratio);
      const conclPart = isLast ? remainingConcl : roundMoney(split.concluida * ratio);
      const pendPart = isLast ? remainingPend : roundMoney(split.pendente * ratio);

      row.prod.comissoes += totalPart;
      row.prod.comissaoConcluida += conclPart;
      row.prod.comissaoPendente += pendPart;

      remainingTotal = roundMoney(remainingTotal - totalPart);
      remainingConcl = roundMoney(remainingConcl - conclPart);
      remainingPend = roundMoney(remainingPend - pendPart);
    });
  }

  const MIN_COMISSAO = 1;
  const subEntries = Array.from(subMap.entries());
  const subDocs = [];
  const cauda = [];

  for (const [key, val] of subEntries) {
    if (roundMoney(val.comissoes) >= MIN_COMISSAO) {
      subDocs.push({
        id: `${dateKey}_${key}`,
        data: finalizeSub(val),
      });
    } else {
      cauda.push(val);
    }
  }

  if (cauda.length > 0) {
    const agg = createSubAcc(dateKey, "_outros_canais");
    for (const val of cauda) {
      agg.itensVendidos += val.itensVendidos;
      agg.faturamentoBruto += val.faturamentoBruto;
      agg.comissoes += val.comissoes;
      agg.diretas += val.diretas;
      agg.indiretas += val.indiretas;
      for (const oid of val.pedidosIds) agg.pedidosIds.add(oid);
    }
    subDocs.push({
      id: `${dateKey}__outros_canais`,
      data: {
        ...finalizeSub(agg),
        subids_count: cauda.length,
      },
    });
  }

  const TOP_N = 100;
  const prodSorted = Array.from(prodMap.entries()).sort(
    (a, b) => b[1].comissoes - a[1].comissoes
  );
  const productDocs = [];
  const prodTop = prodSorted.slice(0, TOP_N);
  const prodCauda = prodSorted.slice(TOP_N);

  for (const [key, val] of prodTop) {
    productDocs.push({ id: key, data: finalizeProduct(val) });
  }

  if (prodCauda.length > 0) {
    const caudaProd = createProductAcc(dateKey, "_cauda_longa", `Cauda longa (${prodCauda.length} produtos)`);
    for (const [, val] of prodCauda) {
      caudaProd.itensVendidos += val.itensVendidos;
      caudaProd.faturamentoBruto += val.faturamentoBruto;
      caudaProd.comissoes += val.comissoes;
      caudaProd.comissaoConcluida += val.comissaoConcluida;
      caudaProd.comissaoPendente += val.comissaoPendente;
    }
    productDocs.push({
      id: `${dateKey}__cauda_longa`,
      data: {
        ...finalizeProduct(caudaProd),
        produtos_count: prodCauda.length,
      },
    });
  }

  return {
    dayDoc: finalizeDay(day),
    subDocs,
    productDocs,
  };
}

function prepareNodesForAggregation(rawNodes) {
  const groups = groupNodesByConversionId(rawNodes);
  const prepared = [];

  for (const group of groups.values()) {
    const merged = mergeGroupNodes(group);
    merged.__groupCommission = comissaoNodeOnceGrupo(group);
    prepared.push(merged);
  }

  return {
    nodes: prepared,
    conversionGroups: groups.size,
  };
}

async function writeFirestore({ dateKey, dayDoc, subDocs, productDocs }) {
  const firestore = getFirestore();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const stamp = (data) => ({ ...data, updatedAt: ts });

  const writes = [
    { ref: firestore.collection("shopee_daily").doc(dateKey), data: stamp(dayDoc) },
    ...subDocs.map((s) => ({
      ref: firestore.collection("subid_daily").doc(s.id),
      data: stamp(s.data),
    })),
    ...productDocs.map((p) => ({
      ref: firestore.collection("produto_daily").doc(p.id),
      data: stamp(p.data),
    })),
  ];

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const chunk = writes.slice(i, i + BATCH_LIMIT);
    const batch = firestore.batch();
    for (const { ref, data } of chunk) {
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
    process.stderr.write(`  Firestore: ${Math.min(i + chunk.length, writes.length)}/${writes.length} docs\n`);
  }

  return writes.length;
}

function printSummary(result) {
  const d = result.shopeeDaily;
  const comissao = roundMoney(d.comissao_concluida + d.comissao_pendente);
  console.log("");
  console.log(`Sync PromosApp — ${result.dateKey}`);
  console.log("---------------------------");
  console.log(`Páginas API: ${result.pages} | nodes brutos: ${result.rawNodes} | únicos pull: ${result.pullUniqueNodes} | grupos conversão: ${result.uniqueConversions}`);
  console.log(`Pedidos: ${d.pedidos} (${d.pedidos_concluidos} concl. / ${d.pedidos_pendentes} pend.)`);
  console.log(`Itens (vendas): ${d.vendas} | GMV: R$ ${d.faturamento.toFixed(2)}`);
  console.log(`Comissão: R$ ${comissao.toFixed(2)} (concl. R$ ${d.comissao_concluida.toFixed(2)} + pend. R$ ${d.comissao_pendente.toFixed(2)})`);
  if (d.comissao_nao_paga > 0) {
    console.log(`Comissão unpaid (fora KPI): R$ ${d.comissao_nao_paga.toFixed(2)}`);
  }
  console.log(`SubIDs gravados: ${result.subids} | Produtos: ${result.produtos}`);
  if (result.dryRun) console.log("DRY-RUN — nada gravado no Firestore.");
  console.log("");
}

async function run(options = {}) {
  const dryRun = options.dryRun ?? DRY_RUN;
  const { dateKey, startTs, endTs } = getDateRange(options.date || DATE);

  let fetched = options.prefetched;
  if (!fetched) {
    process.stderr.write(`Buscando API Shopee ${dateKey} (${startTs}–${endTs})…\n`);
    fetched = await fetchAllNodes(startTs, endTs);
  } else {
    process.stderr.write(`Agregando ${dateKey} (pull único, ${fetched.nodes.length} nodes)…\n`);
  }

  const { dayMap, conversionGroups } = buildShopeePanelAppDayMap(
    fetched.nodes,
    dateKey,
    "node_once",
    { normalizeSubId: normalizeShopeeSubId, trackSubIds: true, timeZone: TIME_ZONE },
  );

  let dayEntry = dayMap[dateKey];
  if (!dayEntry) {
    process.stderr.write(
      `  aviso: API Shopee sem conversões em ${dateKey} — gravando KPIs Shopee zerados (Meta pode ter gasto)\n`,
    );
    dayEntry = createEmptyDayEntry(dateKey);
  }

  const dayDoc = {
    ...dayEntryToFirestoreDoc(dayEntry),
    origem: "shopee_promosapp_sync_script",
  };

  const subEntries = Array.from(dayEntry._subMap?.entries() || []);
  const MIN_COMISSAO = 1;
  const subDocs = [];
  const cauda = [];

  for (const [key, val] of subEntries) {
    const doc = {
      id: `${dateKey}_${key}`,
      data: finalizeSubFirestore(val, dateKey),
    };
    if (roundMoney(val.commissionProjected) >= MIN_COMISSAO) {
      subDocs.push(doc);
    } else {
      cauda.push(val);
    }
  }

  if (cauda.length > 0) {
    const agg = {
      subid: "__outros_canais",
      commissionProjected: 0,
      commissionLiquidated: 0,
      commissionPending: 0,
      itemsSold: 0,
      gmv: 0,
      directItems: 0,
      indirectItems: 0,
      validOrders: new Set(),
      conversionsCompleted: 0,
      conversionsPendingOrders: 0,
      cancelledOrders: 0,
      unpaidOrders: 0,
    };
    for (const val of cauda) {
      agg.commissionProjected += val.commissionProjected;
      agg.commissionLiquidated += val.commissionLiquidated;
      agg.commissionPending += val.commissionPending;
      agg.itemsSold += val.itemsSold;
      agg.gmv += val.gmv;
      agg.directItems += val.directItems;
      agg.indirectItems += val.indirectItems;
      for (const oid of val.validOrders) agg.validOrders.add(oid);
    }
    subDocs.push({
      id: `${dateKey}__outros_canais`,
      data: {
        ...finalizeSubFirestore(agg, dateKey),
        subids_count: cauda.length,
      },
    });
  }

  // Produtos: mantém agregação detalhada legada quando necessário
  const nodesForLegacy = fetched.nodes.filter(
    (node) => formatUnixToBRTDate(node?.purchaseTime, TIME_ZONE) === dateKey,
  );
  const { nodes: preparedNodes } = prepareNodesForAggregation(nodesForLegacy);
  const legacy = aggregatePromosApp(preparedNodes, dateKey);

  let writes = 0;
  if (!dryRun) {
    writes = await writeFirestore({
      dateKey,
      dayDoc,
      subDocs: subDocs.length ? subDocs : legacy.subDocs,
      productDocs: legacy.productDocs,
    });
  }

  const result = {
    dateKey,
    dryRun,
    pages: fetched.pages,
    rawNodes: fetched.rawNodes,
    pullUniqueNodes: fetched.nodes.length,
    uniqueConversions: conversionGroups,
    firestoreWrites: writes,
    shopeeDaily: dayDoc,
    subids: subDocs.length || legacy.subDocs.length,
    produtos: legacy.productDocs.length,
  };

  return result;
}

if (require.main === module) {
  const runMain = async () => {
    if (RANGE_START) {
      const dates = listDateKeysInRange(RANGE_START, RANGE_END);
      const rangeStart = getDateRange(dates[0]).startTs;
      const rangeEnd = getDateRange(dates[dates.length - 1]).endTs;
      console.log(
        `Sync PromosApp em lote: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} dias, pull único)`,
      );
      process.stderr.write(
        `Buscando API Shopee pull único ${dates[0]} → ${dates[dates.length - 1]}…\n`,
      );
      const prefetched = await fetchAllNodes(rangeStart, rangeEnd);
      const snapFile = savePullSnapshot(dates, prefetched);
      console.log(`Pull Shopee salvo: ${snapFile}`);
      for (const dateKey of dates) {
        const result = await run({ date: dateKey, dryRun: DRY_RUN, prefetched });
        printSummary(result);
      }
      console.log(
        `\nValidar Firestore (mesmo pull, sem drift da API):\n` +
          `  node scripts/meta-shopee-dashboard-audit-range.cjs --start ${dates[0]} --end ${dates[dates.length - 1]} --nodes ${snapFile} --firestore-compare --no-meta-api\n`,
      );
      return;
    }

    const result = await run({ dryRun: DRY_RUN });
    printSummary(result);
    console.log(JSON.stringify(result, null, 2));
  };

  runMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("");
      console.error("Erro no sync PromosApp:");
      console.error(err?.message || err);
      process.exit(1);
    });
}

module.exports = {
  run,
  aggregatePromosApp,
  normalizeShopeeSubId,
  nodeOnceCommission,
  splitComissaoPorStatusItens,
  escalaSplitComissaoConversao,
};

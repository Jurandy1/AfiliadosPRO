#!/usr/bin/env node

/**
 * shopee-conversion-report.cjs — relatório completo conversionReport (somente leitura).
 *
 * Uso:
 *   node scripts/shopee-conversion-report.cjs
 *   node scripts/shopee-conversion-report.cjs 2026-06-12
 *   node scripts/shopee-conversion-report.cjs 2026-06-01 2026-06-12
 *   START_DATE=2026-06-12 END_DATE=2026-06-12 SPEND_FILE=scripts/media_spend.json node scripts/shopee-conversion-report.cjs
 *
 * Credenciais: SHOPEE_APP_ID + SHOPEE_APP_SECRET (ou SHOPEE_SECRET) em .env.local
 */

const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const ENV_PATHS = [
  path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
  path.join(__dirname, "..", ".env"),
  path.join(__dirname, "..", ".env.local"),
  path.join(__dirname, ".env"),
];

function loadEnvFiles() {
  for (const p of ENV_PATHS) {
    if (!fsSync.existsSync(p)) continue;
    for (const line of fsSync.readFileSync(p, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnvFiles();

if (!process.env.SHOPEE_APP_SECRET && process.env.SHOPEE_SECRET) {
  process.env.SHOPEE_APP_SECRET = process.env.SHOPEE_SECRET;
}

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (argv.length === 1) {
  if (!process.env.START_DATE) process.env.START_DATE = argv[0];
  if (!process.env.END_DATE) process.env.END_DATE = argv[0];
} else if (argv.length >= 2) {
  if (!process.env.START_DATE) process.env.START_DATE = argv[0];
  if (!process.env.END_DATE) process.env.END_DATE = argv[1];
}

const defaultSpendFile = path.join(__dirname, "media_spend.json");
const CONFIG = {
  appId: process.env.SHOPEE_APP_ID || "",
  appSecret: process.env.SHOPEE_APP_SECRET || "",
  baseUrl:
    process.env.SHOPEE_BASE_URL ||
    "https://open-api.affiliate.shopee.com.br/graphql",
  timeZone: process.env.SHOPEE_TZ || "America/Sao_Paulo",
  pageLimit: Number(process.env.SHOPEE_PAGE_LIMIT || 200),
  outputDir: process.env.OUTPUT_DIR || "./output",
  spendFile:
    process.env.SPEND_FILE ||
    (fsSync.existsSync(defaultSpendFile) ? defaultSpendFile : ""),
  startDate: process.env.START_DATE || "",
  endDate: process.env.END_DATE || "",
};

if (!CONFIG.appId || !CONFIG.appSecret) {
  console.error(
    "Defina SHOPEE_APP_ID e SHOPEE_APP_SECRET (ou SHOPEE_SECRET) em .env.local antes de rodar."
  );
  console.error(`Arquivos tentados: ${ENV_PATHS.join(", ")}`);
  process.exit(1);
}

const CONVERSION_REPORT_FIELDS = `
    nodes {
      purchaseTime
      clickTime
      conversionId
      buyerType
      utmContent
      device
      totalCommission
      sellerCommission
      shopeeCommissionCapped
      orders {
        orderId
        orderStatus
        items {
          shopId
          shopName
          itemId
          itemName
          actualAmount
          qty
          itemTotalCommission
          attributionType
          fraudStatus
          completeTime
        }
      }
    }
    pageInfo {
      limit
      hasNextPage
      scrollId
    }`;

function buildConversionReportQuery(range, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  return `{
  conversionReport(
    purchaseTimeStart: ${range.purchaseTimeStart}
    purchaseTimeEnd: ${range.purchaseTimeEnd}
    limit: ${CONFIG.pageLimit}${scrollClause}
  ) {
${CONVERSION_REPORT_FIELDS}
  }
}`;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return 0;
    // API Shopee: "35.55", "9.954" (ponto decimal). CSV/pt-BR: "1.234,56"
    if (text.includes(",") && text.includes(".")) {
      const normalized = text.replace(/\./g, "").replace(",", ".");
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (text.includes(",") && !text.includes(".")) {
      const parsed = Number(text.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(date, locale = "pt-BR", timeZone = CONFIG.timeZone) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
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
  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year,
  month,
  day,
  hour,
  minute,
  second,
  timeZone
) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMs = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offsetMs);
}

function parseYmd(input) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    throw new Error(`Data inválida: ${input}. Use YYYY-MM-DD`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function buildRangeFromDates(startYmd, endYmd, timeZone) {
  const startUtc = zonedDateTimeToUtc(
    startYmd.year,
    startYmd.month,
    startYmd.day,
    0,
    0,
    0,
    timeZone
  );

  const endUtc = zonedDateTimeToUtc(
    endYmd.year,
    endYmd.month,
    endYmd.day,
    23,
    59,
    59,
    timeZone
  );

  return {
    labelStart: formatDate(startUtc, "pt-BR", timeZone),
    labelEnd: formatDate(endUtc, "pt-BR", timeZone),
    purchaseTimeStart: Math.floor(startUtc.getTime() / 1000),
    purchaseTimeEnd: Math.floor(endUtc.getTime() / 1000),
    startIsoUtc: startUtc.toISOString(),
    endIsoUtc: endUtc.toISOString(),
  };
}

function getDefaultYesterdayRange(timeZone) {
  const now = new Date();
  const zonedNow = getZonedParts(now, timeZone);

  const todayStartUtc = zonedDateTimeToUtc(
    zonedNow.year,
    zonedNow.month,
    zonedNow.day,
    0,
    0,
    0,
    timeZone
  );

  const yesterdayStartUtc = new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEndUtc = new Date(todayStartUtc.getTime() - 1000);

  return {
    labelStart: formatDate(yesterdayStartUtc, "pt-BR", timeZone),
    labelEnd: formatDate(yesterdayEndUtc, "pt-BR", timeZone),
    purchaseTimeStart: Math.floor(yesterdayStartUtc.getTime() / 1000),
    purchaseTimeEnd: Math.floor(yesterdayEndUtc.getTime() / 1000),
    startIsoUtc: yesterdayStartUtc.toISOString(),
    endIsoUtc: yesterdayEndUtc.toISOString(),
  };
}

function getRange() {
  if (CONFIG.startDate && CONFIG.endDate) {
    return buildRangeFromDates(
      parseYmd(CONFIG.startDate),
      parseYmd(CONFIG.endDate),
      CONFIG.timeZone
    );
  }

  if (CONFIG.startDate || CONFIG.endDate) {
    throw new Error("Se usar START_DATE, informe também END_DATE.");
  }

  return getDefaultYesterdayRange(CONFIG.timeZone);
}

function buildAuthorizationHeader(appId, appSecret, payload) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signatureBase = `${appId}${timestamp}${payload}${appSecret}`;
  const signature = crypto
    .createHash("sha256")
    .update(signatureBase)
    .digest("hex");

  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

async function postGraphQL(query) {
  const body = JSON.stringify({ query });

  const authorization = buildAuthorizationHeader(
    CONFIG.appId,
    CONFIG.appSecret,
    body
  );

  const response = await fetch(CONFIG.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body,
  });

  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Resposta não-JSON da Shopee: ${text}`);
  }

  if (!response.ok) {
    throw new Error(
      `Erro HTTP ${response.status}: ${JSON.stringify(json, null, 2)}`
    );
  }

  if (json.errors?.length) {
    throw new Error(`Erro GraphQL: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

async function fetchAllConversionNodes(range) {
  const allNodes = [];
  let scrollId = undefined;
  let page = 0;

  while (true) {
    const data = await postGraphQL(buildConversionReportQuery(range, scrollId));
    const report = data?.conversionReport;

    if (!report) {
      throw new Error("A resposta não trouxe conversionReport.");
    }

    const nodes = Array.isArray(report.nodes) ? report.nodes : [];
    const pageInfo = report.pageInfo ?? {};

    allNodes.push(...nodes);
    page += 1;

    if (!pageInfo.hasNextPage || !pageInfo.scrollId) {
      break;
    }

    scrollId = pageInfo.scrollId;
  }

  return {
    pageCount: page,
    nodeCount: allNodes.length,
    nodes: allNodes,
  };
}

function normalizeSubId(value) {
  const text = String(value ?? "").trim();
  return text || "_sem_subid";
}

function classifyStatus(status) {
  const text = String(status ?? "")
    .trim()
    .toUpperCase();

  if (
    text.includes("CANCEL") ||
    text.includes("RETURN") ||
    text.includes("INVALID") ||
    text.includes("REJECT") ||
    text.includes("FAIL") ||
    text.includes("LOSS")
  ) {
    return "CANCELLED";
  }

  if (text.includes("UNPAID")) {
    return "UNPAID";
  }

  if (
    text.includes("COMPLETE") ||
    text.includes("COMPLETED") ||
    text.includes("FINISH") ||
    text.includes("SETTLED")
  ) {
    return "COMPLETED";
  }

  return "PENDING";
}

function classifyAttribution(type) {
  const text = String(type ?? "")
    .trim()
    .toUpperCase();

  if (text.includes("SAME SHOP") || text.includes("SAME_SHOP")) {
    return "DIRECT";
  }
  if (
    text.includes("DIFFERENT SHOP") ||
    text.includes("DIFFERENT_SHOP") ||
    text.includes("INDIRECT")
  ) {
    return "INDIRECT";
  }
  if (text.includes("DIRECT")) return "DIRECT";
  return "UNKNOWN";
}

function createAccumulator(name) {
  return {
    name,
    orderKeys: new Set(),
    completedOrderKeys: new Set(),
    pendingOrderKeys: new Set(),
    cancelledOrderKeys: new Set(),
    unpaidOrderKeys: new Set(),
    itemsSold: 0,
    directItems: 0,
    indirectItems: 0,
    unknownAttributionItems: 0,
    grossRevenue: 0,
    commissionTotal: 0,
    commissionCompleted: 0,
    commissionPending: 0,
    commissionCancelled: 0,
    commissionUnpaid: 0,
  };
}

function addRowToAccumulator(acc, row) {
  acc.orderKeys.add(row.orderKey);
  acc.itemsSold += row.qty;
  acc.grossRevenue += row.actualAmount;
  acc.commissionTotal += row.itemCommission;

  if (row.attributionBucket === "DIRECT") {
    acc.directItems += row.qty;
  } else if (row.attributionBucket === "INDIRECT") {
    acc.indirectItems += row.qty;
  } else {
    acc.unknownAttributionItems += row.qty;
  }

  if (row.statusBucket === "COMPLETED") {
    acc.completedOrderKeys.add(row.orderKey);
    acc.commissionCompleted += row.itemCommission;
  } else if (row.statusBucket === "UNPAID") {
    acc.unpaidOrderKeys.add(row.orderKey);
    acc.commissionUnpaid += row.itemCommission;
  } else if (row.statusBucket === "CANCELLED") {
    acc.cancelledOrderKeys.add(row.orderKey);
    acc.commissionCancelled += row.itemCommission;
  } else {
    acc.pendingOrderKeys.add(row.orderKey);
    acc.commissionPending += row.itemCommission;
  }
}

function finalizeAccumulator(acc, spend = 0) {
  const orders = acc.orderKeys.size;
  const spendValue = round2(spend);
  const commissionGross = round2(acc.commissionTotal);
  const commissionReal = round2(acc.commissionCompleted + acc.commissionPending);
  const profit = round2(commissionReal - spendValue);
  const roas = spendValue > 0 ? round2(commissionReal / spendValue) : null;
  const roiPct = spendValue > 0 ? round2((profit / spendValue) * 100) : null;

  return {
    name: acc.name,
    orders,
    completedOrders: acc.completedOrderKeys.size,
    pendingOrders: acc.pendingOrderKeys.size,
    cancelledOrders: acc.cancelledOrderKeys.size,
    unpaidOrders: acc.unpaidOrderKeys.size,
    itemsSold: acc.itemsSold,
    directItems: acc.directItems,
    indirectItems: acc.indirectItems,
    unknownAttributionItems: acc.unknownAttributionItems,
    grossRevenue: round2(acc.grossRevenue),
    commissionGross,
    commissionReal,
    commissionTotal: commissionReal,
    commissionCompleted: round2(acc.commissionCompleted),
    commissionPending: round2(acc.commissionPending),
    commissionCancelled: round2(acc.commissionCancelled),
    commissionUnpaid: round2(acc.commissionUnpaid),
    avgTicketPerItem:
      acc.itemsSold > 0 ? round2(acc.grossRevenue / acc.itemsSold) : 0,
    avgTicketPerOrder: orders > 0 ? round2(acc.grossRevenue / orders) : 0,
    spend: spendValue,
    profit,
    roiPct,
    roas,
  };
}

function normalizeRows(nodes) {
  const rows = [];

  for (const conversion of nodes) {
    const subId = normalizeSubId(conversion?.utmContent);
    const conversionId = String(conversion?.conversionId ?? "");
    const buyerType = String(conversion?.buyerType ?? "");
    const device = String(conversion?.device ?? "");
    const purchaseTimeUnix = Number(conversion?.purchaseTime ?? 0);
    const purchaseDate = purchaseTimeUnix
      ? formatDate(new Date(purchaseTimeUnix * 1000), "pt-BR", CONFIG.timeZone)
      : "";

    const orders = Array.isArray(conversion?.orders) ? conversion.orders : [];

    for (const order of orders) {
      const orderId = String(order?.orderId ?? "");
      const orderStatus = String(order?.orderStatus ?? "UNKNOWN");
      const orderKey = orderId || `conversion:${conversionId}:unknown-order`;
      const statusBucket = classifyStatus(orderStatus);

      const items = Array.isArray(order?.items) ? order.items : [];

      for (const item of items) {
        const qtyRaw = toNumber(item?.qty);
        const qty = qtyRaw > 0 ? qtyRaw : 1;
        const actualAmount = toNumber(item?.actualAmount);
        const itemCommission = toNumber(item?.itemTotalCommission);
        const attributionType = String(item?.attributionType ?? "");
        const attributionBucket = classifyAttribution(attributionType);

        rows.push({
          purchaseDate,
          purchaseTimeUnix,
          conversionId,
          subId,
          buyerType,
          device,
          orderId,
          orderKey,
          orderStatus,
          statusBucket,
          shopId: item?.shopId ?? null,
          shopName: String(item?.shopName ?? ""),
          itemId: item?.itemId ?? null,
          itemName: String(item?.itemName ?? ""),
          qty,
          actualAmount,
          itemCommission,
          attributionType,
          attributionBucket,
          fraudStatus: String(item?.fraudStatus ?? ""),
          completeTime: item?.completeTime ?? null,
        });
      }
    }
  }

  return rows;
}

async function readOptionalSpendMap() {
  if (!CONFIG.spendFile) {
    return {};
  }

  try {
    const content = await fs.readFile(CONFIG.spendFile, "utf8");
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.warn(`Arquivo de gasto não encontrado: ${CONFIG.spendFile}`);
      return {};
    }
    throw error;
  }
}

function getSpendValue(spendMap, key) {
  const value = spendMap[key];

  if (typeof value === "number") return round2(value);

  if (value && typeof value === "object") {
    if (typeof value.spend === "number") return round2(value.spend);
    if (typeof value.value === "number") return round2(value.value);
  }

  return 0;
}

function buildDashboard(rows, spendMap, range) {
  const totalAcc = createAccumulator("TOTAL");
  const bySubIdMap = new Map();
  const byDayMap = new Map();

  for (const row of rows) {
    addRowToAccumulator(totalAcc, row);

    if (!bySubIdMap.has(row.subId)) {
      bySubIdMap.set(row.subId, createAccumulator(row.subId));
    }
    addRowToAccumulator(bySubIdMap.get(row.subId), row);

    const dayKey = row.purchaseDate || "sem_data";
    if (!byDayMap.has(dayKey)) {
      byDayMap.set(dayKey, createAccumulator(dayKey));
    }
    addRowToAccumulator(byDayMap.get(dayKey), row);
  }

  const bySubId = Array.from(bySubIdMap.values())
    .map((acc) => {
      const spend = getSpendValue(spendMap, acc.name);
      return finalizeAccumulator(acc, spend);
    })
    .sort((a, b) => b.commissionTotal - a.commissionTotal);

  const totalSpendFromSubIds = round2(
    bySubId.reduce((sum, item) => sum + item.spend, 0)
  );
  const totalSpend =
    typeof spendMap._total === "number"
      ? round2(spendMap._total)
      : totalSpendFromSubIds;

  const totals = {
    ...finalizeAccumulator(totalAcc, totalSpend),
    activeSubIds: bySubId.length,
    dataAvailableUntil: range.labelEnd,
  };

  const byDay = Array.from(byDayMap.values())
    .map((acc) => finalizeAccumulator(acc, 0))
    .sort((a, b) => {
      const [da, ma, aa] = a.name.split("/").map(Number);
      const [db, mb, ab] = b.name.split("/").map(Number);
      return new Date(aa, ma - 1, da) - new Date(ab, mb - 1, db);
    });

  return {
    generatedAt: new Date().toISOString(),
    source: "Shopee Affiliate API - conversionReport",
    period: {
      timeZone: CONFIG.timeZone,
      labelStart: range.labelStart,
      labelEnd: range.labelEnd,
      purchaseTimeStart: range.purchaseTimeStart,
      purchaseTimeEnd: range.purchaseTimeEnd,
      startIsoUtc: range.startIsoUtc,
      endIsoUtc: range.endIsoUtc,
    },
    totals,
    bySubId,
    byDay,
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsv(row[column])).join(",")
  );
  return [header, ...lines].join("\n");
}

async function writeOutputs(rawNodes, rows, dashboard) {
  await fs.mkdir(CONFIG.outputDir, { recursive: true });

  const dashboardPath = path.join(CONFIG.outputDir, "shopee_dashboard.json");
  const rawPath = path.join(CONFIG.outputDir, "shopee_raw_nodes.json");
  const itemsPath = path.join(CONFIG.outputDir, "shopee_items.csv");
  const subIdsPath = path.join(CONFIG.outputDir, "shopee_by_subid.csv");
  const byDayPath = path.join(CONFIG.outputDir, "shopee_by_day.csv");

  await fs.writeFile(dashboardPath, JSON.stringify(dashboard, null, 2), "utf8");
  await fs.writeFile(rawPath, JSON.stringify(rawNodes, null, 2), "utf8");

  await fs.writeFile(
    itemsPath,
    toCsv(rows, [
      "purchaseDate",
      "conversionId",
      "subId",
      "orderId",
      "orderStatus",
      "statusBucket",
      "shopId",
      "shopName",
      "itemId",
      "itemName",
      "qty",
      "actualAmount",
      "itemCommission",
      "attributionType",
      "attributionBucket",
      "fraudStatus",
      "buyerType",
      "device",
    ]),
    "utf8"
  );

  await fs.writeFile(
    subIdsPath,
    toCsv(dashboard.bySubId, [
      "name",
      "orders",
      "completedOrders",
      "pendingOrders",
      "cancelledOrders",
      "unpaidOrders",
      "itemsSold",
      "directItems",
      "indirectItems",
      "grossRevenue",
      "commissionTotal",
      "commissionCompleted",
      "commissionPending",
      "commissionCancelled",
      "commissionUnpaid",
      "avgTicketPerItem",
      "avgTicketPerOrder",
      "spend",
      "profit",
      "roiPct",
      "roas",
    ]),
    "utf8"
  );

  await fs.writeFile(
    byDayPath,
    toCsv(dashboard.byDay, [
      "name",
      "orders",
      "completedOrders",
      "pendingOrders",
      "cancelledOrders",
      "unpaidOrders",
      "itemsSold",
      "directItems",
      "indirectItems",
      "grossRevenue",
      "commissionTotal",
      "commissionCompleted",
      "commissionPending",
      "commissionCancelled",
      "commissionUnpaid",
      "avgTicketPerItem",
      "avgTicketPerOrder",
      "spend",
      "profit",
      "roiPct",
      "roas",
    ]),
    "utf8"
  );

  return {
    dashboardPath,
    rawPath,
    itemsPath,
    subIdsPath,
    byDayPath,
  };
}

function printSummary(dashboard, fetchInfo, fileInfo) {
  const totals = dashboard.totals;

  console.log("");
  console.log("Resumo do período");
  console.log("-----------------");
  console.log(
    `Período: ${dashboard.period.labelStart} até ${dashboard.period.labelEnd}`
  );
  console.log(`Timezone: ${dashboard.period.timeZone}`);
  if (CONFIG.spendFile) {
    console.log(`Gasto (arquivo): ${CONFIG.spendFile}`);
  }
  console.log(`Páginas lidas: ${fetchInfo.pageCount}`);
  console.log(`Conversões brutas: ${fetchInfo.nodeCount}`);
  console.log(`SubIDs ativos: ${totals.activeSubIds}`);
  console.log(`Pedidos: ${totals.orders}`);
  console.log(`Pedidos completos: ${totals.completedOrders}`);
  console.log(`Pedidos pendentes: ${totals.pendingOrders}`);
  console.log(`Pedidos cancelados: ${totals.cancelledOrders}`);
  console.log(`Pedidos unpaid: ${totals.unpaidOrders}`);
  console.log(`Itens vendidos: ${totals.itemsSold}`);
  console.log(`Diretas: ${totals.directItems}`);
  console.log(`Indiretas: ${totals.indirectItems}`);
  console.log(`Faturamento bruto: R$ ${totals.grossRevenue.toFixed(2)}`);
  console.log(`Comissão (concluída + pendente): R$ ${totals.commissionReal.toFixed(2)}`);
  console.log(`Comissão concluída: R$ ${totals.commissionCompleted.toFixed(2)}`);
  console.log(`Comissão pendente: R$ ${totals.commissionPending.toFixed(2)}`);
  if (totals.commissionUnpaid > 0) {
    console.log(`Comissão unpaid (fora do KPI): R$ ${totals.commissionUnpaid.toFixed(2)}`);
  }
  if (totals.commissionGross !== totals.commissionReal) {
    console.log(`Comissão bruta (todos itens): R$ ${totals.commissionGross.toFixed(2)}`);
  }
  console.log(`Ticket médio por item: R$ ${totals.avgTicketPerItem.toFixed(2)}`);
  console.log(`Ticket médio por pedido: R$ ${totals.avgTicketPerOrder.toFixed(2)}`);
  console.log(`Gasto: R$ ${totals.spend.toFixed(2)}`);
  console.log(`Lucro: R$ ${totals.profit.toFixed(2)}`);
  console.log(
    `ROI: ${totals.roiPct === null ? "—" : `${totals.roiPct.toFixed(2)}%`}`
  );
  console.log(
    `ROAS: ${totals.roas === null ? "—" : `${totals.roas.toFixed(2)}x`}`
  );

  console.log("");
  console.log("Arquivos gerados");
  console.log("----------------");
  console.log(fileInfo.dashboardPath);
  console.log(fileInfo.rawPath);
  console.log(fileInfo.itemsPath);
  console.log(fileInfo.subIdsPath);
  console.log(fileInfo.byDayPath);
  console.log("");
}

async function main() {
  const range = getRange();
  const spendMap = await readOptionalSpendMap();
  const fetchInfo = await fetchAllConversionNodes(range);
  const rows = normalizeRows(fetchInfo.nodes);
  const dashboard = buildDashboard(rows, spendMap, range);
  const fileInfo = await writeOutputs(fetchInfo.nodes, rows, dashboard);

  printSummary(dashboard, fetchInfo, fileInfo);
}

main().catch((error) => {
  console.error("");
  console.error("Erro ao gerar relatório Shopee:");
  console.error(error?.message || error);
  process.exit(1);
});

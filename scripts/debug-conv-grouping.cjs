#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const dateStr = process.argv[2] || "2026-06-11";

function loadEnv() {
  for (const p of [
    path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
    path.join(__dirname, "..", ".env"),
  ]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function fetchNodes() {
  loadEnv();
  const proxyUrl = process.env.VITE_AFFILIATE_GRAPHQL_URL;
  const secret = process.env.VITE_BACKFILL_SECRET || process.env.META_SYNC_SECRET;
  const start = Math.floor(new Date(`${dateStr}T00:00:00-03:00`).getTime() / 1000);
  const end = start + 86400 - 1;
  const all = [];
  let scrollId = "";
  for (;;) {
    const scroll = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
    const query = `{ conversionReport(limit: 500, purchaseTimeStart: ${start}, purchaseTimeEnd: ${end}${scroll}) { nodes { conversionId purchaseTime conversionStatus totalCommission netCommission orders { orderId orderStatus items { itemTotalCommission } } } pageInfo { hasNextPage scrollId } } }`;
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const conn = json.data?.conversionReport || json.conversionReport;
    all.push(...(conn.nodes || []));
    if (!conn.pageInfo?.hasNextPage) break;
    scrollId = conn.pageInfo.scrollId;
  }
  return all;
}

function stOrd(ord, node) {
  return String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
}

function stAudit(ord) {
  return String(ord.orderStatus || "").toUpperCase().trim();
}

(async () => {
  const nodes = await fetchNodes();
  const convIds = new Map();
  let multiOrderNodes = 0;
  let nodesPerConvGt1 = 0;
  const convNodeCount = new Map();

  for (const n of nodes) {
    const cid = String(n.conversionId);
    convNodeCount.set(cid, (convNodeCount.get(cid) || 0) + 1);
    if ((n.orders || []).length > 1) multiOrderNodes++;
    for (const ord of n.orders || []) {
      const oid = String(ord.orderId || "").trim();
      if (!convIds.has(cid)) convIds.set(cid, []);
      convIds.get(cid).push({ oid, stNode: stOrd(ord, n), stAudit: stAudit(ord), convStatus: n.conversionStatus });
    }
  }

  for (const [cid, c] of convNodeCount) {
    if (c > 1) nodesPerConvGt1++;
  }

  let h2Audit = 0;
  let h2Node = 0;
  let h1 = 0;
  const mismatches = [];

  for (const [cid, orders] of convIds) {
    const validatedAudit = orders.filter((o) => o.stAudit !== "UNPAID" && o.stAudit !== "CANCELLED" && o.stAudit !== "CANCELED" && o.oid);
    const validatedNode = orders.filter((o) => o.stNode !== "UNPAID" && o.stNode !== "CANCELLED" && o.stNode !== "CANCELED" && o.oid);
    const convOkAudit = validatedAudit.length > 0 && validatedAudit.every((o) => o.stAudit === "COMPLETED");
    const convOkNode = validatedNode.length > 0 && validatedNode.every((o) => o.stNode === "COMPLETED");

    for (const o of validatedAudit) {
      if (convOkAudit) h2Audit++;
      else if (o.stAudit === "COMPLETED") h1++; // not used for h1 total
    }
    for (const o of validatedAudit) {
      if (o.stAudit === "COMPLETED") h1++;
    }
    for (const o of validatedNode) {
      if (convOkNode) h2Node++;
    }

    if (convOkAudit !== convOkNode) {
      mismatches.push({ cid, convOkAudit, convOkNode, orders: validatedNode });
    }
  }

  let multiNodeSamples = 0;
  let comSumMulti = 0;
  for (const [cid, cnt] of convNodeCount) {
    if (cnt <= 1) continue;
    const group = nodes.filter((n) => String(n.conversionId) === cid);
    const coms = group.map((n) => Number(n.netCommission || n.totalCommission || 0));
    comSumMulti += coms.reduce((a, b) => a + b, 0);
    if (multiNodeSamples < 3) {
      console.log("multi-node sample", cid, "nodes=", cnt, "coms=", coms, "orders=", group.map((n) => n.orders?.[0]?.orderStatus));
      multiNodeSamples++;
    }
  }

  console.log(`nodes=${nodes.length} multiOrderNodes=${multiOrderNodes} convIdsWithMultipleNodes=${nodesPerConvGt1}`);
  console.log(`H2 audit-style=${h2Audit} H2 node-style=${h2Node} H1 completed orders=${h1}`);
  console.log(`mismatches audit vs node conv complete: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 8)) {
    console.log("---", m.cid, m.orders);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

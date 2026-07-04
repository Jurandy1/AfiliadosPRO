#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

function loadEnv() {
  for (const f of [
    path.join(__dirname, "..", "functions", ".env.projetoafiliado-9ff07"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, "..", ".env.local"),
  ]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadEnv();

async function run() {
  console.log("Triggering Meta Sync...");
  const secret = process.env.META_SYNC_SECRET;
  const res = await fetch("https://metasyncnow-ncjpjjcdya-rj.a.run.app?date_preset=last_30d", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${secret}`
    }
  });
  const data = await res.text();
  console.log("STATUS:", res.status);
  console.log("DATA:", data);
}

run().catch(console.error);

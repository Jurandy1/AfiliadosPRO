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

const { createClient } = require(path.join(__dirname, "../functions/node_modules/@supabase/supabase-js"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function fixTable() {
  console.log("Fixing meta_demographics schema...");
  
  // We can execute raw SQL using Supabase rpc or just by dropping/creating
  // But wait, Supabase JS client doesn't support raw SQL easily unless we have a custom RPC.
  // We can try calling a common RPC or just use psql / fetch to the REST API if we have to.
  // Actually, Supabase REST API doesn't support raw DDL directly.
  
  // Let's create an RPC or use another way.
  // Let's check what RPCs are available, usually `execute_sql` isn't there by default.
  
  // Let's print the current schema of the table to understand what it is.
  console.log("Checking current columns...");

  const res = await fetch(`${supabaseUrl}/rest/v1/meta_demographics?limit=1`, {
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`
    }
  });
  
  const data = await res.json();
  console.log("Data structure:", data);
  console.log("Headers:", res.headers.raw());
}

fixTable();

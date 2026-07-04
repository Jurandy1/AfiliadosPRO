#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

function loadEnv() {
  for (const f of [
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
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log("URL:", supabaseUrl ? "OK" : "MISSING");
console.log("ANON KEY:", supabaseAnonKey ? "OK" : "MISSING");

const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

async function checkRLS() {
  const { data, error } = await supabase
    .from("sync_state")
    .select("data_blob")
    .eq("key", "meta_demographics")
    .single();

  if (error) {
    console.error("ERROR FETCHING (RLS?):", error.message, error.code);
  } else {
    console.log("SUCCESS FETCHING WITH ANON KEY. Data found!");
  }
}

checkRLS();

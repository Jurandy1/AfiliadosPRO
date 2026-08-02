/**
 * Prova que o refresh corrige preço/comissão:
 * grava valor fake no Supabase → chama API → confere se voltou ao valor Shopee.
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const root = path.resolve(__dirname, "..");
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, "functions", ".env.mestreafil-53145"));

const REFRESH_URL = (process.env.VITE_REFRESH_URL || "").trim();
const SECRET = (process.env.VITE_BACKFILL_SECRET || process.env.META_SYNC_SECRET || "").trim();
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || ""
).trim();

const itemId = String(process.argv[2] || "23793329538");

async function getRow() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/backup_produtos?select=id,data_blob&id=eq.item_${itemId}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!res.ok) throw new Error(`get ${res.status}`);
  const rows = await res.json();
  return rows[0];
}

async function patchBlob(blob) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/backup_produtos?id=eq.item_${itemId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ data_blob: blob }),
    },
  );
  if (!res.ok) throw new Error(`patch ${res.status}: ${await res.text()}`);
}

async function main() {
  const row = await getRow();
  if (!row) throw new Error("item não encontrado");
  const blob = { ...(row.data_blob || {}) };
  const realPreco = Number(blob.preco || 0);
  const realCom = Number(blob.comissao_pct || 0);
  console.log("=== Teste forçado de mudança ===");
  console.log(`itemId=${itemId}`);
  console.log(`1) Valor real: R$ ${realPreco.toFixed(2)} · ${realCom.toFixed(1)}%`);

  const fakePreco = Number((realPreco * 0.85).toFixed(2));
  const fakeCom = Number(Math.max(1, realCom - 5).toFixed(1));
  blob.preco = fakePreco;
  blob.comissao_pct = fakeCom;
  await patchBlob(blob);
  console.log(`2) Gravei FAKE: R$ ${fakePreco.toFixed(2)} · ${fakeCom.toFixed(1)}%`);

  const mid = await getRow();
  console.log(
    `3) Confirmado no DB: R$ ${Number(mid.data_blob.preco).toFixed(2)} · ${Number(mid.data_blob.comissao_pct).toFixed(1)}%`,
  );

  const rr = await fetch(`${REFRESH_URL}?itemId=${encodeURIComponent(itemId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: "",
  });
  const api = await rr.json();
  console.log(
    `4) Refresh API ${rr.status}: R$ ${Number(api.produto?.preco || 0).toFixed(2)} · ${Number(api.produto?.comissao_pct || 0).toFixed(1)}%`,
  );

  await new Promise((r) => setTimeout(r, 600));
  const after = await getRow();
  const p = Number(after.data_blob.preco || 0);
  const c = Number(after.data_blob.comissao_pct || 0);
  console.log(`5) Depois no DB: R$ ${p.toFixed(2)} · ${c.toFixed(1)}%`);

  const apiP = Number(api.produto?.preco || 0);
  const apiC = Number(api.produto?.comissao_pct || 0);
  const bate = Math.abs(p - apiP) < 0.01 && Math.abs(c - apiC) < 0.05;
  const corrigiuPreco = Math.abs(p - fakePreco) > 0.01;
  const corrigiuCom = Math.abs(c - fakeCom) > 0.05;

  console.log("\n=== RESULTADO ===");
  console.log(`API → Supabase bate: ${bate ? "SIM ✅" : "NÃO ❌"}`);
  console.log(`Corrigiu preço fake: ${corrigiuPreco ? "SIM ✅" : "NÃO ❌"}`);
  console.log(`Corrigiu comissão fake: ${corrigiuCom ? "SIM ✅" : "NÃO ❌"}`);
  console.log(
    `Relatório detectaria mudança: ${corrigiuPreco || corrigiuCom ? "SIM ✅ (método que você quer)" : "não"}`,
  );
  if (corrigiuPreco) console.log(`  preço ${fakePreco.toFixed(2)} → ${p.toFixed(2)}`);
  if (corrigiuCom) console.log(`  comissão ${fakeCom.toFixed(1)}% → ${c.toFixed(1)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

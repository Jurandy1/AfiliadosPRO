/**
 * Testa se o refresh puxa preço/comissão corretamente:
 * 1) lê snapshot no Supabase
 * 2) chama shopeeBackupRefreshNow
 * 3) relê Supabase e compara com resposta da API
 *
 * Uso: node scripts/test-backup-refresh-diff.cjs [itemId] [qtd]
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
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
  || process.env.SUPABASE_ANON_KEY
  || ""
).trim();

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function sbGet(pathQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function loadBackup(itemId) {
  const rows = await sbGet(`backup_produtos?select=id,item_id,data_blob&id=eq.item_${itemId}&limit=1`);
  const row = rows?.[0];
  if (!row) return null;
  const b = row.data_blob || {};
  return {
    itemId: String(b.itemId || row.item_id || itemId),
    nome: b.apelido || b.nome || itemId,
    preco: Number(b.preco || 0),
    comissao_pct: Number(b.comissao_pct || 0),
    shopId: String(b.shopId || ""),
    ultima_verificacao: b.ultima_verificacao || null,
  };
}

async function refresh(itemId) {
  const url = `${REFRESH_URL}?itemId=${encodeURIComponent(itemId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: "",
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function delta(a, b) {
  return Math.abs(round2(a) - round2(b)) > 0.009;
}

async function pickItems(count) {
  const rows = await sbGet("backup_produtos?select=id,item_id,data_blob&limit=80");
  const list = (rows || [])
    .map((r) => {
      const b = r.data_blob || {};
      return {
        itemId: String(b.itemId || r.item_id || String(r.id || "").replace(/^item_/, "")),
        preco: Number(b.preco || 0),
        comissao_pct: Number(b.comissao_pct || 0),
        nome: b.apelido || b.nome || "",
      };
    })
    .filter((x) => x.itemId && x.preco > 0);
  // mistura: alguns com comissão alta, alguns aleatórios
  list.sort((a, b) => b.comissao_pct - a.comissao_pct);
  const picked = [];
  for (const x of list) {
    if (picked.length >= count) break;
    if (!picked.find((p) => p.itemId === x.itemId)) picked.push(x);
  }
  return picked;
}

async function testOne(itemId) {
  const antes = await loadBackup(itemId);
  if (!antes) {
    console.log(`\n❌ item_${itemId}: não encontrado no Supabase`);
    return { itemId, ok: false };
  }

  console.log(`\n── ${antes.nome}`);
  console.log(`   itemId=${antes.itemId} shopId=${antes.shopId}`);
  console.log(`   ANTES (Supabase): R$ ${antes.preco.toFixed(2)} · ${antes.comissao_pct.toFixed(1)}%`);

  const { status, json } = await refresh(itemId);
  console.log(`   API HTTP ${status} success=${json.success} status=${json.status || "ok"}`);

  if (status !== 200 || !json.success) {
    console.log(`   ❌ falha:`, json.error || json.message || json);
    return { itemId, ok: false, error: json.error || json.status };
  }

  if (json.status === "produto_nao_encontrado") {
    console.log(`   ⚠ não encontrado na API Shopee (saiu do afiliado?)`);
    return { itemId, ok: true, naoEncontrado: true };
  }

  const apiPreco = Number(json.produto?.preco || 0);
  const apiCom = Number(json.produto?.comissao_pct || 0);
  console.log(`   API resposta:     R$ ${apiPreco.toFixed(2)} · ${apiCom.toFixed(1)}%`);

  // aguarda persistência
  await new Promise((r) => setTimeout(r, 400));
  const depois = await loadBackup(itemId);
  console.log(`   DEPOIS (Supabase): R$ ${depois.preco.toFixed(2)} · ${depois.comissao_pct.toFixed(1)}%`);

  const persistOk = !delta(depois.preco, apiPreco) && !delta(depois.comissao_pct, apiCom);
  const precoMudou = delta(antes.preco, depois.preco);
  const comMudou = delta(antes.comissao_pct, depois.comissao_pct);

  console.log(`   persistência API→DB: ${persistOk ? "✅ OK" : "❌ DIVERGE"}`);
  console.log(`   mudou vs antes: preço=${precoMudou ? "SIM" : "não"} comissão=${comMudou ? "SIM" : "não"}`);
  if (precoMudou) {
    console.log(`     preço ${antes.preco.toFixed(2)} → ${depois.preco.toFixed(2)}`);
  }
  if (comMudou) {
    console.log(`     comissão ${antes.comissao_pct.toFixed(1)}% → ${depois.comissao_pct.toFixed(1)}%`);
  }

  return {
    itemId,
    ok: persistOk,
    precoMudou,
    comMudou,
    antes,
    api: { preco: apiPreco, comissao_pct: apiCom },
    depois,
  };
}

async function main() {
  const arg2 = process.argv[2];
  const argItem = arg2 && /^\d{6,}$/.test(String(arg2)) ? String(arg2) : null;
  const count = Number(argItem ? (process.argv[3] || 1) : (arg2 || 5));

  if (!REFRESH_URL || !SECRET || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltam env: VITE_REFRESH_URL / secret / SUPABASE_URL / key");
    console.error({
      hasRefresh: !!REFRESH_URL,
      hasSecret: !!SECRET,
      hasUrl: !!SUPABASE_URL,
      hasKey: !!SUPABASE_KEY,
    });
    process.exit(1);
  }

  console.log("=== Teste refresh preço/comissão ===");
  console.log(`Refresh: ${REFRESH_URL.replace(/https?:\/\//, "").slice(0, 50)}...`);
  console.log(`Supabase: ${SUPABASE_URL.replace(/https?:\/\//, "").slice(0, 40)}...`);

  let targets;
  if (argItem) {
    targets = [{ itemId: argItem }];
  } else {
    targets = await pickItems(count);
    console.log(`Testando ${targets.length} item(s)...`);
  }

  const results = [];
  for (const t of targets) {
    results.push(await testOne(t.itemId));
    await new Promise((r) => setTimeout(r, 1600));
  }

  const ok = results.filter((r) => r.ok && !r.naoEncontrado).length;
  const mudaram = results.filter((r) => r.precoMudou || r.comMudou).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n=== RESUMO ===");
  console.log(`persistência OK: ${ok}/${results.length}`);
  console.log(`com mudança real de preço/comissão nesta rodada: ${mudaram}`);
  console.log(`falhas: ${fail}`);
  if (mudaram === 0) {
    console.log("(Sem mudança agora é esperado se a Shopee não alterou nada desde o último refresh.)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

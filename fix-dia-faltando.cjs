#!/usr/bin/env node
/**
 * fix-dia-faltando.cjs
 * 
 * Roda APENAS 1 dia especifico - util pra preencher dias que falharam no backfill
 * 
 * Uso:
 *   node fix-dia-faltando.cjs 2026-04-08
 *   node fix-dia-faltando.cjs 2026-04-08 2026-04-09 2026-05-15   (varios dias)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ----- credenciais -----
function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const ROOT = process.cwd();
const supaCreds = parseEnvFile(path.join(ROOT, "supabase-credenciais.env"));
const shopeeCreds = parseEnvFile(path.join(ROOT, "functions", ".env.projetoafiliado-9ff07"));

const SUPABASE_URL = supaCreds.SUPABASE_URL;
const SUPABASE_KEY = supaCreds.SUPABASE_SERVICE_ROLE_KEY;
const SHOPEE_APP_ID = shopeeCreds.SHOPEE_APP_ID;
const SHOPEE_SECRET = shopeeCreds.SHOPEE_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !SHOPEE_APP_ID || !SHOPEE_SECRET) {
  console.error("Faltam credenciais nos .env");
  process.exit(1);
}

// ----- Supabase -----
const { createClient } = require(path.join(ROOT, "functions", "node_modules", "@supabase", "supabase-js"));
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ----- Shopee API -----
const SHOPEE_URL = "https://open-api.affiliate.shopee.com.br/graphql";

function shopeeHeaders(payload) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash("sha256").update(`${SHOPEE_APP_ID}${ts}${payload}${SHOPEE_SECRET}`).digest("hex");
  return {
    "Content-Type": "application/json",
    Authorization: `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${ts}, Signature=${sig}`,
  };
}

async function shopeeQuery(query) {
  const payload = JSON.stringify({ query });
  const res = await fetch(SHOPEE_URL, { method: "POST", headers: shopeeHeaders(payload), body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map(e => e.message).join(" | ")}`);
  return json.data;
}

function dayStart(d) {
  const [y, m, dd] = d.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, dd, 3, 0, 0) / 1000);
}
function dayEnd(d) {
  const [y, m, dd] = d.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, dd + 1, 2, 59, 59) / 1000);
}

async function pullDay(dia) {
  let scrollId = null;
  const allNodes = [];
  const startTs = dayStart(dia);
  const endTs = dayEnd(dia);
  let pages = 0;

  while (true) {
    pages++;
    const scroll = scrollId ? `, scrollId: "${scrollId}"` : "";
    const q = `{
      conversionReport(
        purchaseTimeStart: ${startTs}
        purchaseTimeEnd: ${endTs}
        limit: 500
        ${scroll}
      ) {
        nodes {
          conversionId purchaseTime totalCommission
          orders {
            orderId orderStatus
            items {
              shopId itemId actualAmount qty itemTotalCommission
              fraudStatus completeTime
            }
          }
        }
        pageInfo { hasNextPage scrollId }
      }
    }`;
    const data = await shopeeQuery(q);
    const r = data.conversionReport;
    allNodes.push(...(r.nodes || []));
    console.log(`  pagina ${pages}: +${(r.nodes || []).length} (total ${allNodes.length})`);
    if (!r.pageInfo.hasNextPage) break;
    scrollId = r.pageInfo.scrollId;
    if (!scrollId) break;
  }
  return allNodes;
}

function processar(dia, nodes) {
  const events = [];
  const produtoDaily = new Map();
  const logPerdas = [];
  let totalCom = 0, totalConc = 0, totalPend = 0, totalCanc = 0;
  let totalGmv = 0, totalItens = 0;
  const pedSet = new Set(), pedComp = new Set(), pedPend = new Set(), pedCanc = new Set();

  for (const c of nodes) {
    for (const o of c.orders || []) {
      pedSet.add(o.orderId);
      const st = (o.orderStatus || "").toUpperCase();
      if (st === "COMPLETED") pedComp.add(o.orderId);
      else if (st === "CANCELLED" || st === "UNPAID") pedCanc.add(o.orderId);
      else pedPend.add(o.orderId);
      for (const it of o.items || []) {
        const valor = Number(it.actualAmount || 0);
        const comm = Number(it.itemTotalCommission || 0);
        const qty = Number(it.qty || 1);
        totalGmv += valor; totalItens += qty; totalCom += comm;
        if (st === "COMPLETED") totalConc += comm;
        else if (st === "CANCELLED" || st === "UNPAID") totalCanc += comm;
        else totalPend += comm;

        events.push({
          event_id: `ev_${c.conversionId}_${o.orderId}_${it.itemId}`,
          product_doc_id: `item_${it.itemId}`,
          id_item: String(it.itemId),
          id_loja: it.shopId ? String(it.shopId) : null,
          plataforma: "Shopee",
          fonte: "shopee_api_backend",
          preco: valor, gmv: valor, commission: comm, qty,
          is_direta: false, is_indireta: true,
          status: st.toLowerCase(),
          importado_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        const pk = String(it.itemId);
        const pAg = produtoDaily.get(pk) || {
          data: dia, item_id: pk, shop_id: it.shopId ? String(it.shopId) : null,
          comissao: 0, comissao_concluida: 0, comissao_pendente: 0, comissao_cancelada: 0,
          vendas: 0, qtd_itens: 0, faturamento: 0,
          fraud_status: it.fraudStatus || null,
          ultima_sync: new Date().toISOString(),
        };
        pAg.vendas += 1; pAg.qtd_itens += qty; pAg.faturamento += valor; pAg.comissao += comm;
        if (st === "COMPLETED") pAg.comissao_concluida += comm;
        else if (st === "CANCELLED" || st === "UNPAID") pAg.comissao_cancelada += comm;
        else pAg.comissao_pendente += comm;
        produtoDaily.set(pk, pAg);

        if (st === "CANCELLED" || st === "UNPAID") {
          logPerdas.push({
            data: dia, order_id: o.orderId, item_id: String(it.itemId),
            conversion_id: String(c.conversionId),
            comissao_perdida: comm, valor_pedido: valor, motivo: st,
            detectado_em: new Date().toISOString(),
          });
        }
      }
    }
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    daily: {
      data: dia, pedidos: pedSet.size,
      vendas: pedComp.size + pedPend.size, qtd_itens: totalItens,
      comissao: r2(totalCom), comissao_concluida: r2(totalConc),
      comissao_pendente: r2(totalPend), comissao_cancelada: r2(totalCanc),
      fat_bruto: r2(totalGmv),
      pedidos_pendentes: pedPend.size, pedidos_cancelados: pedCanc.size,
      pedidos_completos: pedComp.size,
      agg_mode: "promosapp", ultima_sync: new Date().toISOString(),
    },
    events, produtoDaily: [...produtoDaily.values()], logPerdas,
  };
}

function chunk(arr, n) { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }

async function upsert(tabela, regs, chave) {
  if (!regs.length) return;
  for (const lote of chunk(regs, 500)) {
    const { error } = await supabase.from(tabela).upsert(lote, { onConflict: chave });
    if (error) throw error;
  }
}

(async () => {
  const dias = process.argv.slice(2).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dias.length) {
    console.error("Uso: node fix-dia-faltando.cjs 2026-04-08 [2026-04-09 ...]");
    process.exit(1);
  }
  console.log(`\nVai puxar ${dias.length} dia(s): ${dias.join(", ")}\n`);

  for (let i = 0; i < dias.length; i++) {
    const dia = dias[i];
    const t0 = Date.now();
    console.log(`[${i + 1}/${dias.length}] ${dia}`);
    try {
      const nodes = await pullDay(dia);
      const { daily, events, produtoDaily, logPerdas } = processar(dia, nodes);
      
      if (events.length) {
        const uniqueEvents = Object.values(events.reduce((acc, curr) => {
          if (!acc[curr.event_id]) acc[curr.event_id] = curr;
          else {
            acc[curr.event_id].qty += curr.qty;
            acc[curr.event_id].gmv += curr.gmv;
            acc[curr.event_id].commission += curr.commission;
          }
          return acc;
        }, {}));
        await upsert("shopee_events", uniqueEvents, "event_id");
      }
      
      await upsert("shopee_daily", [daily], "data");
      
      if (produtoDaily.length)
        await upsert("produto_daily", produtoDaily, "data,item_id");
        
      if (logPerdas.length) {
        const uniquePerdas = Object.values(logPerdas.reduce((acc, curr) => {
          const k = curr.data + '_' + curr.order_id + '_' + curr.item_id;
          if (!acc[k]) acc[k] = curr;
          else {
            acc[k].comissao_perdida += curr.comissao_perdida;
            acc[k].valor_pedido += curr.valor_pedido;
          }
          return acc;
        }, {}));
        await upsert("log_perdas", uniquePerdas, "data,order_id,item_id");
      }
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ✅ conv=${nodes.length} events=${events.length} (${dt}s)\n`);
    } catch (err) {
      console.error(`  ❌ ${err.message}\n`);
    }
    if (i < dias.length - 1) {
      console.log(`  aguardando 31s (rate limit)...\n`);
      await new Promise(r => setTimeout(r, 31000));
    }
  }
  console.log("\n🎉 Concluido!");
})().catch(err => { console.error("FATAL:", err.message); process.exit(1); });

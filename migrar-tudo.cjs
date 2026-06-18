#!/usr/bin/env node
/**
 * migrar-tudo.cjs
 * ========================================================================
 * Script master de migracao Firebase -> Supabase
 *
 * 3 etapas:
 *   A) Custom: migra 5 collections do Firestore pro Supabase (~30s)
 *   B) Backfill Shopee: puxa 90 dias da API Shopee pro Supabase (~30-60min)
 *   C) Backfill Meta: puxa 90 dias da API Meta pro Supabase (~10-20min)
 *
 * Como usar (na raiz da pasta Afiliadoteste-Superbase):
 *
 *   node migrar-tudo.cjs --etapa A        # so custom
 *   node migrar-tudo.cjs --etapa B        # so Shopee (90 dias)
 *   node migrar-tudo.cjs --etapa B --dias 7   # so Shopee, ultimos 7 dias
 *   node migrar-tudo.cjs --etapa C        # so Meta
 *   node migrar-tudo.cjs --tudo           # tudo em sequencia
 *
 * Pre-requisitos (ja prontos no seu setup):
 *   - supabase-credenciais.env na raiz
 *   - functions/serviceAccountKey.json
 *   - functions/.env.projetoafiliado-9ff07 (Shopee + Meta)
 *   - functions/node_modules/@supabase
 * ========================================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ----------------------------------------------------------------------------
// 1) CARREGA CREDENCIAIS
// ----------------------------------------------------------------------------

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
const shopeeCreds = parseEnvFile(
  path.join(ROOT, "functions", ".env.projetoafiliado-9ff07"),
);

const SUPABASE_URL = supaCreds.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = supaCreds.SUPABASE_SERVICE_ROLE_KEY;
const SHOPEE_APP_ID = shopeeCreds.SHOPEE_APP_ID;
const SHOPEE_SECRET = shopeeCreds.SHOPEE_SECRET;
const META_TOKEN = shopeeCreds.META_ACCESS_TOKEN;
const META_ACCOUNTS_RAW = shopeeCreds.META_AD_ACCOUNT_IDS;

function checkRequired(varName, value, etapa) {
  if (!value) {
    console.error(`\n❌ FALTA CREDENCIAL: ${varName}`);
    console.error(`   Necessaria pra etapa ${etapa}.`);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// 2) CLIENTES (Firebase Admin + Supabase)
// ----------------------------------------------------------------------------

let admin, db, supabase;

function initFirebase() {
  if (admin) return;
  admin = require(path.join(ROOT, "functions", "node_modules", "firebase-admin"));
  const credPath = path.join(ROOT, "functions", "serviceAccountKey.json");
  if (!fs.existsSync(credPath)) {
    console.error("❌ serviceAccountKey.json nao encontrado em functions/");
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(require(credPath)) });
  db = admin.firestore();
  console.log("✅ Firebase conectado");
}

function initSupabase() {
  if (supabase) return;
  checkRequired("SUPABASE_URL", SUPABASE_URL, "A/B/C");
  checkRequired("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_KEY, "A/B/C");
  const { createClient } = require(path.join(
    ROOT,
    "functions",
    "node_modules",
    "@supabase",
    "supabase-js",
  ));
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  console.log("✅ Supabase conectado");
}

// ----------------------------------------------------------------------------
// 3) HELPERS
// ----------------------------------------------------------------------------

function asISO(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return new Date(ts).toISOString();
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toISOString();
  if (ts.seconds != null) return new Date(ts.seconds * 1000).toISOString();
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return null;
}

function asDate(s) {
  if (!s) return null;
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const iso = asISO(s);
  return iso ? iso.slice(0, 10) : null;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsertBatch(tabela, registros, chave) {
  if (!registros.length) return 0;
  let total = 0;
  for (const lote of chunk(registros, 500)) {
    const { error, count } = await supabase
      .from(tabela)
      .upsert(lote, { onConflict: chave, count: "exact" });
    if (error) {
      console.error(`  ❌ Erro em ${tabela}:`, error.message);
      console.error(`     Primeiro registro do lote:`, JSON.stringify(lote[0]).slice(0, 200));
      throw error;
    }
    total += lote.length;
    process.stdout.write(`\r  ${tabela}: ${total}/${registros.length}`);
  }
  process.stdout.write("\n");
  return total;
}

// ----------------------------------------------------------------------------
// 4) ETAPA A — MIGRA COLLECTIONS CUSTOM
// ----------------------------------------------------------------------------

async function etapaA() {
  console.log("\n" + "=".repeat(60));
  console.log("ETAPA A — Migrar collections custom Firebase -> Supabase");
  console.log("=".repeat(60));

  initFirebase();
  initSupabase();

  // ---- meta_ads ----
  console.log("\n[meta_ads]");
  const snapMA = await db.collection("meta_ads").get();
  const regsMA = snapMA.docs.map((d) => {
    const x = d.data();
    return {
      ad_id: d.id,
      nome_anuncio: x.nomeAnuncio ?? x.nome_anuncio ?? null,
      campaign_id: x.campaignId ?? x.campaign_id ?? null,
      campaign_name: x.campaignName ?? x.campaign_name ?? null,
      adset_id: x.adsetId ?? x.adset_id ?? null,
      adset_name: x.adsetName ?? x.adset_name ?? null,
      account_id: x.accountId ?? x.account_id ?? null,
      status: x.status ?? null,
      subid_vinculado: x.subId ?? x.subid ?? x.subid_vinculado ?? null,
      link_destino: x.linkDestino ?? x.link_destino ?? null,
      data_blob: x,
    };
  });
  await upsertBatch("meta_ads", regsMA, "ad_id");

  // ---- pinterest_ads ----
  console.log("\n[pinterest_ads]");
  const snapPA = await db.collection("pinterest_ads").get();
  const regsPA = snapPA.docs.map((d) => {
    const x = d.data();
    return {
      ad_id: d.id,
      ad_name: x.adName ?? x.ad_name ?? null,
      campaign_id: x.campaignId ?? null,
      campaign_name: x.campaignName ?? null,
      subid_vinculado: x.subId ?? x.subid ?? null,
      link_destino: x.linkDestino ?? null,
      data_blob: x,
    };
  });
  await upsertBatch("pinterest_ads", regsPA, "ad_id");

  // ---- backup_produtos ----
  console.log("\n[backup_produtos]");
  const snapBP = await db.collection("backup_produtos").get();
  const regsBP = snapBP.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      item_id: String(x.itemId ?? x.item_id ?? d.id),
      shop_id: x.shopId ? String(x.shopId) : null,
      nome: x.nome ?? null,
      data_blob: x,
      criado_em: asISO(x.criadoEm) || new Date().toISOString(),
    };
  });
  await upsertBatch("backup_produtos", regsBP, "id");

  // ---- backup_grupos ----
  console.log("\n[backup_grupos]");
  const snapBG = await db.collection("backup_grupos").get();
  const regsBG = snapBG.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      nome: x.nome ?? "(sem nome)",
      principal_item_id: x.principalItemId ? String(x.principalItemId) : null,
      data_blob: x,
      criado_em: asISO(x.criadoEm) || new Date().toISOString(),
    };
  });
  await upsertBatch("backup_grupos", regsBG, "id");

  // ---- garimpo_produtos ----
  console.log("\n[garimpo_produtos]");
  const snapGP = await db.collection("garimpo_produtos").get();
  const regsGP = snapGP.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      data_garimpo: x.data_garimpo,
      item_id: String(x.itemId ?? x.id_item ?? ""),
      shop_id: x.shopId ? String(x.shopId) : null,
      nome: x.nome ?? null,
      link_produto: x.link_produto ?? null,
      link_afiliado: x.link_afiliado ?? null,
      imagem: x.imagem ?? null,
      preco_min: x.preco_min ?? null,
      preco_max: x.preco_max ?? null,
      desconto_pct: x.desconto_pct ?? null,
      vendas_shopee: x.vendas_shopee ?? null,
      rating: x.rating ?? null,
      comissao_pct: x.comissao_pct ?? null,
      comissao_pct_seller: x.comissao_pct_seller ?? null,
      comissao_pct_shopee: x.comissao_pct_shopee ?? null,
      comissao_valor: x.comissao_valor ?? null,
      shop_name: x.shop_name ?? null,
      shop_type: Array.isArray(x.shop_type) ? x.shop_type : null,
      periodo_inicio: x.periodo_inicio ?? null,
      periodo_fim: x.periodo_fim ?? null,
      ja_vendi: !!x.ja_vendi,
      score_oportunidade: x.score_oportunidade ?? null,
      motivos: Array.isArray(x.motivos) ? x.motivos : null,
      timestamp: asISO(x.timestamp) || new Date().toISOString(),
    };
  });
  await upsertBatch("garimpo_produtos", regsGP, "id");

  // ---- garimpo_recompra ----
  console.log("\n[garimpo_recompra]");
  const snapGR = await db.collection("garimpo_recompra").get();
  const regsGR = snapGR.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      data_garimpo: x.data_garimpo,
      item_id: String(x.itemId ?? ""),
      shop_id: x.shopId ? String(x.shopId) : null,
      nome: x.nome ?? null,
      preco: x.preco ?? null,
      preco_min: x.precoMin ?? null,
      preco_max: x.precoMax ?? null,
      comissao_pct: x.comissao_pct ?? null,
      vendas_shopee: x.vendas_shopee ?? null,
      imagem: x.imagem ?? null,
      rating: x.rating ?? null,
      loja: x.loja ?? null,
      shop_type: Array.isArray(x.shopType) ? x.shopType : null,
      categoria_ids: Array.isArray(x.categoriaIds) ? x.categoriaIds.map(String) : null,
      link_produto: x.linkProduto ?? null,
      link_afiliado: x.linkAfiliado ?? null,
      periodo_inicio: x.periodoInicio ?? null,
      periodo_fim: x.periodoFim ?? null,
      minhas_vendas: x.minhas_vendas ?? null,
      minha_comissao_historica: x.minha_comissao_historica ?? null,
      ja_vendi: !!x.ja_vendi,
      timestamp: asISO(x.timestamp) || new Date().toISOString(),
    };
  });
  await upsertBatch("garimpo_recompra", regsGR, "id");

  console.log("\n✅ ETAPA A CONCLUIDA");
}

// ----------------------------------------------------------------------------
// 5) ETAPA B — BACKFILL SHOPEE API
// ----------------------------------------------------------------------------

const SHOPEE_URL = "https://open-api.affiliate.shopee.com.br/graphql";

function shopeeAuthHeaders(payload) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHash("sha256")
    .update(`${SHOPEE_APP_ID}${ts}${payload}${SHOPEE_SECRET}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    Authorization: `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${ts}, Signature=${sig}`,
  };
}

async function shopeeQuery(query) {
  const payload = JSON.stringify({ query });
  const res = await fetch(SHOPEE_URL, {
    method: "POST",
    headers: shopeeAuthHeaders(payload),
    body: payload,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.errors?.length) {
    throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join(" | ")}`);
  }
  return json.data;
}

function dayStartUnixBRT(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 3, 0, 0) / 1000);
}
function dayEndUnixBRT(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d + 1, 2, 59, 59) / 1000);
}
function rangeDates(daysBack) {
  const out = [];
  const now = new Date();
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function pullShopeeDay(dia) {
  let scrollId = null;
  const allNodes = [];
  const startTs = dayStartUnixBRT(dia);
  const endTs = dayEndUnixBRT(dia);

  while (true) {
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
    if (!r.pageInfo.hasNextPage) break;
    scrollId = r.pageInfo.scrollId;
    if (!scrollId) break;
  }
  return allNodes;
}

function processarNodesDoDia(dia, nodes) {
  // Agrega tudo necessario pras 5 tabelas: shopee_events, shopee_daily,
  // subid_daily, produto_daily, log_perdas
  const events = [];
  const subidDaily = new Map(); // subid -> agregado
  const produtoDaily = new Map(); // item_id -> agregado
  const logPerdas = [];

  let totalComissao = 0;
  let totalComissaoConcluida = 0;
  let totalComissaoPendente = 0;
  let totalComissaoCancelada = 0;
  let totalGmv = 0;
  let totalItens = 0;
  const pedidosSet = new Set();
  const pedidosCompletos = new Set();
  const pedidosPendentes = new Set();
  const pedidosCancelados = new Set();

  for (const c of nodes) {
    for (const o of c.orders || []) {
      pedidosSet.add(o.orderId);
      const status = (o.orderStatus || "").toUpperCase();
      if (status === "COMPLETED") pedidosCompletos.add(o.orderId);
      else if (status === "CANCELLED" || status === "UNPAID") pedidosCancelados.add(o.orderId);
      else pedidosPendentes.add(o.orderId);

      for (const it of o.items || []) {
        const valor = Number(it.actualAmount || 0);
        const comm = Number(it.itemTotalCommission || 0);
        const qty = Number(it.qty || 1);

        totalGmv += valor;
        totalItens += qty;
        totalComissao += comm;
        if (status === "COMPLETED") totalComissaoConcluida += comm;
        else if (status === "CANCELLED" || status === "UNPAID") totalComissaoCancelada += comm;
        else totalComissaoPendente += comm;

        // shopee_events (linha granular)
        events.push({
          event_id: `ev_${c.conversionId}_${o.orderId}_${it.itemId}`,
          product_doc_id: `item_${it.itemId}`,
          id_item: String(it.itemId),
          id_loja: it.shopId ? String(it.shopId) : null,
          loja: null,
          link_shopee: null,
          link_afiliado: null,
          nome: null,
          categoria: null,
          plataforma: "Shopee",
          fonte: "shopee_api_backend",
          canal: null,
          preco: valor,
          gmv: valor,
          commission: comm,
          qty,
          subid: null,
          sub_raw: null,
          sub_key: null,
          is_direta: false,
          is_indireta: true,
          status: status.toLowerCase(),
          importacao_id: null,
          importado_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // produto_daily agregado
        const pk = String(it.itemId);
        const pAg = produtoDaily.get(pk) || {
          data: dia,
          item_id: pk,
          shop_id: it.shopId ? String(it.shopId) : null,
          nome: null,
          comissao: 0,
          comissao_concluida: 0,
          comissao_pendente: 0,
          comissao_cancelada: 0,
          vendas: 0,
          qtd_itens: 0,
          faturamento: 0,
          fraud_status: it.fraudStatus || null,
          ultima_sync: new Date().toISOString(),
        };
        pAg.vendas += 1;
        pAg.qtd_itens += qty;
        pAg.faturamento += valor;
        pAg.comissao += comm;
        if (status === "COMPLETED") pAg.comissao_concluida += comm;
        else if (status === "CANCELLED" || status === "UNPAID") pAg.comissao_cancelada += comm;
        else pAg.comissao_pendente += comm;
        produtoDaily.set(pk, pAg);

        // log_perdas pra cancelados
        if (status === "CANCELLED" || status === "UNPAID") {
          logPerdas.push({
            data: dia,
            order_id: o.orderId,
            item_id: String(it.itemId),
            conversion_id: String(c.conversionId),
            subid: null,
            comissao_perdida: comm,
            valor_pedido: valor,
            motivo: status,
            item_notes: null,
            detectado_em: new Date().toISOString(),
          });
        }
      }
    }
  }

  const shopeeDailyRow = {
    data: dia,
    pedidos: pedidosSet.size,
    vendas: pedidosCompletos.size + pedidosPendentes.size,
    qtd_itens: totalItens,
    comissao: Math.round(totalComissao * 100) / 100,
    comissao_concluida: Math.round(totalComissaoConcluida * 100) / 100,
    comissao_pendente: Math.round(totalComissaoPendente * 100) / 100,
    comissao_cancelada: Math.round(totalComissaoCancelada * 100) / 100,
    fat_bruto: Math.round(totalGmv * 100) / 100,
    pedidos_pendentes: pedidosPendentes.size,
    pedidos_cancelados: pedidosCancelados.size,
    pedidos_completos: pedidosCompletos.size,
    agg_mode: "promosapp",
    ultima_sync: new Date().toISOString(),
  };

  return {
    shopeeDailyRow,
    events,
    produtoDaily: [...produtoDaily.values()],
    logPerdas,
  };
}

async function etapaB(diasBack) {
  console.log("\n" + "=".repeat(60));
  console.log(`ETAPA B — Backfill Shopee (${diasBack} dias)`);
  console.log("=".repeat(60));

  checkRequired("SHOPEE_APP_ID", SHOPEE_APP_ID, "B");
  checkRequired("SHOPEE_SECRET", SHOPEE_SECRET, "B");
  initSupabase();

  const dias = rangeDates(diasBack);
  console.log(`Processando ${dias.length} dias: ${dias[0]} -> ${dias[dias.length - 1]}\n`);

  let totalConv = 0;
  let totalEvents = 0;

  for (let i = 0; i < dias.length; i++) {
    const dia = dias[i];
    const t0 = Date.now();
    console.log(`[${i + 1}/${dias.length}] ${dia} ...`);

    let nodes;
    try {
      nodes = await pullShopeeDay(dia);
    } catch (err) {
      console.error(`  ✗ erro Shopee: ${err.message}`);
      continue;
    }

    totalConv += nodes.length;
    const { shopeeDailyRow, events, produtoDaily, logPerdas } =
      processarNodesDoDia(dia, nodes);
    totalEvents += events.length;

    // grava no Supabase
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
      await upsertBatch("shopee_events", uniqueEvents, "event_id");
    }
    
    await upsertBatch("shopee_daily", [shopeeDailyRow], "data");
    
    if (produtoDaily.length)
      await upsertBatch("produto_daily", produtoDaily, "data,item_id");
      
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
      await upsertBatch("log_perdas", uniquePerdas, "data,order_id,item_id");
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `  conv=${nodes.length} events=${events.length} produtos=${produtoDaily.length} perdas=${logPerdas.length} (${dt}s)`,
    );

    // Rate limit Shopee: 30s entre queries SEM scrollId
    if (i < dias.length - 1) {
      const wait = 31000 - (Date.now() - t0);
      if (wait > 0) {
        console.log(`  aguardando ${(wait / 1000).toFixed(0)}s (rate limit)...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  console.log(`\n✅ ETAPA B CONCLUIDA: ${totalConv} conversoes, ${totalEvents} events`);
}

// ----------------------------------------------------------------------------
// 6) ETAPA C — BACKFILL META ADS
// ----------------------------------------------------------------------------

async function etapaC(diasBack) {
  console.log("\n" + "=".repeat(60));
  console.log(`ETAPA C — Backfill Meta Ads (${diasBack} dias)`);
  console.log("=".repeat(60));

  checkRequired("META_ACCESS_TOKEN", META_TOKEN, "C");
  checkRequired("META_AD_ACCOUNT_IDS", META_ACCOUNTS_RAW, "C");
  initSupabase();

  const contas = META_ACCOUNTS_RAW.split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`Contas Meta: ${contas.length}`);

  const dataFim = new Date().toISOString().slice(0, 10);
  const dataIni = new Date(Date.now() - diasBack * 86400000)
    .toISOString()
    .slice(0, 10);
  console.log(`Periodo: ${dataIni} -> ${dataFim}`);

  let totalRows = 0;

  for (const conta of contas) {
    const contaId = conta.replace(/^act_/, "");
    console.log(`\n[conta ${contaId}]`);

    const fields = [
      "date_start",
      "ad_id",
      "ad_name",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "cpc",
    ].join(",");

    let url =
      `https://graph.facebook.com/v18.0/act_${contaId}/insights` +
      `?fields=${fields}` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since: dataIni, until: dataFim }))}` +
      `&time_increment=1` +
      `&level=ad` +
      `&limit=200` +
      `&access_token=${META_TOKEN}`;

    const todasLinhas = [];

    while (url) {
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) {
        console.error(`  ✗ Meta error: ${json.error.message}`);
        break;
      }
      todasLinhas.push(...(json.data || []));
      url = json.paging?.next || null;
    }

    console.log(`  ${todasLinhas.length} linhas brutas Meta`);

    // Resolve SubID por ad_id (usa meta_ads que ja foi migrada na etapa A)
    const adIds = [...new Set(todasLinhas.map((r) => r.ad_id))];
    const subidByAd = {};
    if (adIds.length) {
      const lotes = chunk(adIds, 200);
      for (const lote of lotes) {
        const { data } = await supabase
          .from("meta_ads")
          .select("ad_id, subid_vinculado")
          .in("ad_id", lote);
        for (const r of data || []) {
          if (r.subid_vinculado) subidByAd[r.ad_id] = r.subid_vinculado;
        }
      }
    }

    const registros = todasLinhas.map((r) => ({
      data: r.date_start,
      subid: subidByAd[r.ad_id] || "(sem_subid)",
      account_id: contaId,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name,
      adset_id: r.adset_id,
      ad_id: r.ad_id,
      gasto: Number(r.spend || 0),
      impressoes: Number(r.impressions || 0),
      cliques: Number(r.clicks || 0),
      ctr: r.ctr != null ? Number(r.ctr) : null,
      cpc: r.cpc != null ? Number(r.cpc) : null,
      ultima_sync: new Date().toISOString(),
    }));

    if (registros.length) {
      await upsertBatch("meta_ads_daily", registros, "data,subid,ad_id");
      totalRows += registros.length;
    }
  }

  console.log(`\n✅ ETAPA C CONCLUIDA: ${totalRows} linhas Meta gravadas`);
}

// ----------------------------------------------------------------------------
// 7) MAIN
// ----------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { etapa: null, dias: 90, tudo: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--etapa") out.etapa = (args[++i] || "").toUpperCase();
    else if (args[i] === "--dias") out.dias = parseInt(args[++i], 10);
    else if (args[i] === "--tudo") out.tudo = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(fs.readFileSync(__filename, "utf-8").split("\n").slice(1, 27).join("\n"));
      process.exit(0);
    }
  }
  return out;
}

(async () => {
  const args = parseArgs();
  if (!args.etapa && !args.tudo) {
    console.error("Uso: node migrar-tudo.cjs --etapa A|B|C [--dias N] | --tudo");
    process.exit(1);
  }

  console.log("\n🚀 MIGRACAO FIREBASE -> SUPABASE\n");
  console.log(`Supabase: ${SUPABASE_URL || "(nao configurado)"}\n`);

  try {
    if (args.tudo || args.etapa === "A") await etapaA();
    if (args.tudo || args.etapa === "B") await etapaB(args.dias);
    if (args.tudo || args.etapa === "C") await etapaC(args.dias);
    console.log("\n🎉 MIGRACAO COMPLETA");
  } catch (err) {
    console.error("\n💥 FALHOU:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();

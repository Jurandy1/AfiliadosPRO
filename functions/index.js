const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

// GCP/Node 20: prioriza IPv4 — evita UND_ERR_CONNECT_TIMEOUT quando IPv6 falha na Shopee
try {
  const dns = require("dns");
  if (typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (dnsErr) {
  console.warn("[shopee] dns ipv4first indisponivel:", dnsErr?.message || dnsErr);
}

setGlobalOptions({ region: "southamerica-east1" });

admin.initializeApp();

const db = admin.firestore();

// --- SUPABASE DUAL-WRITE ADAPTER ---
const { createClient } = require("@supabase/supabase-js");
const { syncToSupabase } = require("./lib/supabaseSync");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  global.WebSocket = require("ws");
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  console.log("[Supabase] Cliente inicializado com sucesso para Dual-Write.");
} else {
  console.warn("[Supabase] Credenciais não encontradas. Dual-write desativado.");
}
const { FieldValue } = admin.firestore;
const { normalizeSubId } = require("./lib/normalizeSubId");
const { refreshMonthlyBucketsForDates } = require("./lib/monthlyRollup");
const {
  extrairTermosBuscaGarimpo,
  scoreRelevancia,
  comissaoR$De,
} = require("./garimpoKeywordUtils");

const META_API_VERSION = process.env.META_API_VERSION || "v19.0";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_AD_ACCOUNT_IDS = (process.env.META_AD_ACCOUNT_IDS || "")
  .split(",")
  .flatMap((part) => {
    const m = String(part || "").match(/\d{5,}/g);
    return m && m[0] ? [m[0]] : [];
  })
  .filter(Boolean);

function actId(id) {
  return String(id || "").startsWith("act_") ? String(id || "") : `act_${id}`;
}

async function metaFetchAll(url) {
  let next = url;
  const out = [];
  while (next) {
    const res = await fetch(next);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    if (Array.isArray(json.data)) out.push(...json.data);
    next = json?.paging?.next || null;
  }
  return out;
}

function normalizeInsight(insight, adsIndex) {
  const adInfo = adsIndex[String(insight.ad_id || "")] || {};
  const actions = Array.isArray(insight.actions) ? insight.actions : [];
  const uniqueActions = Array.isArray(insight.unique_actions) ? insight.unique_actions : [];
  const costs = Array.isArray(insight.cost_per_action_type) ? insight.cost_per_action_type : [];

  const linkClicks = actions.find((a) => a.action_type === "link_click");
  const linkClicksUnique = uniqueActions.find((a) => a.action_type === "link_click");
  const linkCost = costs.find((a) => a.action_type === "link_click");

  const resultados = linkClicks ? parseInt(linkClicks.value, 10) || 0 : parseInt(insight.clicks || 0, 10) || 0;
  const resultadosUnicos = linkClicksUnique ? parseInt(linkClicksUnique.value, 10) || 0 : parseInt(insight.unique_clicks || 0, 10) || 0;
  const custoResultado = linkCost ? parseFloat(linkCost.value) || 0 : parseFloat(insight.cpc || 0) || 0;

  const outboundClicks = (Array.isArray(insight.outbound_clicks) ? insight.outbound_clicks : [])
    .reduce((s, a) => s + (parseInt(a.value || 0, 10) || 0), 0);

  const veiculacao = adInfo.effective_status || adInfo.status || "";
  const status = ["ACTIVE", "active", "Ativo"].includes(veiculacao) ? "Ativo" : "Pausado";

  return {
    adId: String(insight.ad_id || ""),
    adsetId: String(insight.adset_id || ""),
    campaignId: String(insight.campaign_id || ""),
    nomeAnuncio: String(insight.ad_name || ""),
    subid: normalizeSubId(insight.ad_name || ""),
    conjuntoAnuncios: String(insight.adset_name || adInfo?.adset?.name || ""),
    campanha: String(insight.campaign_name || adInfo?.campaign?.name || ""),
    impressoes: parseInt(insight.impressions || 0, 10) || 0,
    alcance: parseInt(insight.reach || 0, 10) || 0,
    frequencia: Math.round((parseFloat(insight.frequency || 0) || 0) * 100) / 100,
    valorUsado: Math.round((parseFloat(insight.spend || 0) || 0) * 100) / 100,
    cpm: Math.round((parseFloat(insight.cpm || 0) || 0) * 100) / 100,
    cpp: Math.round((parseFloat(insight.cpp || 0) || 0) * 100) / 100,
    cliquesTotal: parseInt(insight.clicks || 0, 10) || 0,
    cliquesUnicos: parseInt(insight.unique_clicks || 0, 10) || 0,
    ctr: Math.round((parseFloat(insight.ctr || 0) || 0) * 10000) / 10000,
    ctrUnico: Math.round((parseFloat(insight.unique_ctr || 0) || 0) * 10000) / 10000,
    cpc: Math.round((parseFloat(insight.cpc || 0) || 0) * 100) / 100,
    cpcUnico: Math.round((parseFloat(insight.cost_per_unique_click || 0) || 0) * 100) / 100,
    cliquesExternos: outboundClicks,
    ctrExterno: (Array.isArray(insight.outbound_clicks_ctr) ? insight.outbound_clicks_ctr : [])
      .reduce((s, a) => s + (parseFloat(a.value || 0) || 0), 0),
    resultados,
    resultadosUnicos,
    custoResultado: Math.round(custoResultado * 100) / 100,
    qualidade: insight.quality_ranking || "–",
    engajamento: insight.engagement_rate_ranking || "–",
    conversao: insight.conversion_rate_ranking || "–",
    veiculacao,
    status,
    dataInicio: String(insight.date_start || ""),
    dataFim: String(insight.date_stop || ""),
    _accountId: String(insight._accountId || ""),
    _fonte: "meta_api_backend",
  };
}

async function fetchAdsStatus(accountId) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    fields: "id,name,status,effective_status,adset{name},campaign{name}",
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/ads?${params}`);
}

async function fetchMainInsights(accountId, datePreset) {
  const fields = [
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "impressions",
    "reach",
    "frequency",
    "spend",
    "cpm",
    "cpp",
    "clicks",
    "unique_clicks",
    "ctr",
    "unique_ctr",
    "cpc",
    "cost_per_unique_click",
    "outbound_clicks",
    "outbound_clicks_ctr",
    "actions",
    "cost_per_action_type",
    "unique_actions",
    "quality_ranking",
    "engagement_rate_ranking",
    "conversion_rate_ranking",
    "date_start",
    "date_stop",
  ].join(",");

  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: "ad",
    fields,
    date_preset: datePreset,
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`);
}

async function fetchAgeGender(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc",
    breakdowns: "age,gender",
    date_preset: datePreset,
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`);
}

async function fetchRegion(accountId, datePreset) {
  const params = new URLSearchParams({
    access_token: META_ACCESS_TOKEN,
    level: "account",
    fields: "impressions,reach,spend,clicks,ctr,cpc",
    breakdowns: "region",
    date_preset: datePreset,
    limit: "500",
  });
  return metaFetchAll(`https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`);
}

function mergeBreakdownAgg(target, key, row) {
  const base = target[key] || { impressions: 0, reach: 0, spend: 0, clicks: 0 };
  target[key] = {
    impressions: base.impressions + (parseInt(row.impressions || 0, 10) || 0),
    reach: base.reach + (parseInt(row.reach || 0, 10) || 0),
    spend: Math.round((base.spend + (parseFloat(row.spend || 0) || 0)) * 100) / 100,
    clicks: base.clicks + (parseInt(row.clicks || 0, 10) || 0),
  };
}

function formatAgeGenderAgg(map) {
  return Object.entries(map).map(([k, v]) => {
    const [age, gender] = k.split("|");
    const generoLabel = gender === "female" ? "Feminino" : gender === "male" ? "Masculino" : gender || "—";
    return { age, gender, generoLabel, ...v };
  });
}

function formatRegionAgg(map) {
  return Object.entries(map).map(([region, v]) => ({ region, ...v }));
}

async function runMetaSync({ datePreset }) {
  if (!META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN não configurado");
  if (!META_AD_ACCOUNT_IDS.length) throw new Error("META_AD_ACCOUNT_IDS não configurado");

  const startedAt = Date.now();
  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;

  const perAccount = await Promise.allSettled(
    META_AD_ACCOUNT_IDS.map(async (accountId) => {
      const [mainInsights, adsStatus, ageGender, region] = await Promise.all([
        fetchMainInsights(accountId, datePreset),
        fetchAdsStatus(accountId).catch(() => []),
        fetchAgeGender(accountId, datePreset).catch(() => []),
        fetchRegion(accountId, datePreset).catch(() => []),
      ]);

      const adsIndex = {};
      (adsStatus || []).forEach((a) => { adsIndex[String(a.id)] = a; });

      const normalizedAds = (mainInsights || []).map((insight) =>
        normalizeInsight({ ...insight, _accountId: accountId }, adsIndex),
      );

      return { accountId, normalizedAds, ageGender, region };
    }),
  );

  const ads = [];
  const errors = [];
  const ageGenderAgg = {};
  const regionAgg = {};

  perAccount.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      errors.push(`Conta ${META_AD_ACCOUNT_IDS[i]}: ${r.reason?.message || String(r.reason)}`);
      return;
    }
    const value = r.value;
    ads.push(...(value.normalizedAds || []));
    (value.ageGender || []).forEach((row) => {
      const key = `${row.age || ""}|${row.gender || ""}`;
      mergeBreakdownAgg(ageGenderAgg, key, row);
    });
    (value.region || []).forEach((row) => {
      const key = String(row.region || "");
      if (!key) return;
      mergeBreakdownAgg(regionAgg, key, row);
    });
  });

  let batch = db.batch();
  let count = 0;
  const metaAdsPending = [];

  for (const ad of ads) {
    const adId = String(ad.adId || "").trim();
    if (!adId) continue;
    const ref = db.collection("meta_ads").doc(adId);
    metaAdsPending.push({
      ref,
      payload: {
        ...ad,
        importacaoId,
        fonte: "meta_api_backend",
        updatedAt: FieldValue.serverTimestamp(),
        importadoEm: FieldValue.serverTimestamp(),
        periodo: datePreset,
      },
    });
  }

  const adsWriteState = { batch, count: 0, skipped: 0 };
  const adsFlush = async (force = false) => {
    if (adsWriteState.count >= 450 || (force && adsWriteState.count > 0)) {
      await adsWriteState.batch.commit();
      adsWriteState.batch = db.batch();
      adsWriteState.count = 0;
    }
  };
  const { ignorados: metaAdsIgnorados } = await applyPendingWrites(
    adsWriteState,
    adsFlush,
    metaAdsPending,
    { merge: true },
  );
  if (adsWriteState.count > 0) await adsFlush(true);
  batch = adsWriteState.batch;
  count = adsWriteState.count;
  if (metaAdsIgnorados > 0) {
    console.log(`[metaSync] ${metaAdsIgnorados} anúncios inalterados (write omitido)`);
  }

  const demoRef = db.collection("meta_demographics").doc(importacaoId);
  batch.set(demoRef, {
    importacaoId,
    periodo: datePreset,
    ageGender: formatAgeGenderAgg(ageGenderAgg),
    region: formatRegionAgg(regionAgg),
    fonte: "meta_api_backend",
    updatedAt: FieldValue.serverTimestamp(),
    importadoEm: FieldValue.serverTimestamp(),
  });

  batch.set(importRef, {
    tipo: "meta_ads",
    fonte: "api_backend",
    periodo: datePreset,
    status: "sucesso",
    linhasProcessadas: ads.length,
    erros: errors,
    duracaoMs: Date.now() - startedAt,
    importadoEm: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Supabase Dual-Write para Meta Ads e Demografia
  if (supabase) {
    const metaAdsToSupabase = metaAdsPending.map(p => ({ tabela: "meta_ads", id: p.ref.id, data: p.payload }));
    const demoToSupabase = [{ tabela: "meta_demographics", id: importacaoId, data: { importacaoId, periodo: datePreset, ageGender: formatAgeGenderAgg(ageGenderAgg), region: formatRegionAgg(regionAgg) } }];
    await syncToSupabase(supabase, [...metaAdsToSupabase, ...demoToSupabase], []).catch(console.error);
  }

  await touchImportacoesLatestBackend("meta_ads", importacaoId);

  return { importacaoId, ads: ads.length, errors };
}

exports.metaDailySync = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/Sao_Paulo",
    secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
  },
  async () => {
    try {
      await runMetaSync({ datePreset: "last_30d" });
      await touchMetaSyncHealth({
        lastAdsSyncAt: FieldValue.serverTimestamp(),
        lastAdsSyncError: null,
        lastAdsSyncFailedAt: null,
      }).catch(() => null);
    } catch (e) {
      console.error("[metaDailySync] falhou:", e?.message || e);
      await touchMetaSyncHealth({
        lastAdsSyncError: String(e?.message || e),
        lastAdsSyncFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);

// A configuração de segredos foi adicionada logo após o onRequest
exports.metaSyncNow = onRequest(
  { secrets: ["META_SYNC_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"] },
  async (req, res) => {
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();

    const ok = secret && provided === `Bearer ${secret}`;

    if (!ok) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const datePreset = String(req.query.date_preset || "last_30d");
      const result = await runMetaSync({ datePreset });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  SHOPEE AFFILIATE SYNC v2 — cole tudo isso ao final de functions/index.js
//  (depois do bloco do Meta, ANTES do último parêntese do arquivo).
//
//  Funções principais:
//    1) shopeeIncrementalSync  — 4×/dia (0h, 6h, 12h, 18h BRT), cursor + conversionReport completo.
//    2) shopeeDailyReconcile   — 4h BRT, últimos 15 dias (forceReplace).
//    3) shopeeRecentDaysSync   — a cada 4h, anteontem + ontem + hoje (BRT, forceReplace).
//    4) shopeeMonthAutoSync    — 4×/dia (1h30, 7h30, 13h30, 19h30 BRT), mes corrente em chunks de 4 dias.
//    5) shopeeBackfillNow      — HTTP manual (?startDate=&endDate=&force=1).
//
//  Pré-requisitos:
//    - secrets SHOPEE_APP_ID e SHOPEE_SECRET criados (✓ feito)
//    - secret META_SYNC_SECRET para autenticar o backfill manual
//    - usuário já apagou no app as importações antigas de Shopee Vendas
// ═══════════════════════════════════════════════════════════════════════════

const SHOPEE_API_URL = "https://open-api.affiliate.shopee.com.br/graphql";

/** Log temporário de diagnóstico — remover após identificar fetch failed. Prefixo: ERRO_CRU_FETCH */
function logErroFetchCru(err, ctx = "shopee") {
  console.error(`[ERRO_CRU_FETCH] ${ctx}:`, err);
  try {
    console.error(`[DETALHES_ERRO] ${ctx}:`, JSON.stringify(err, Object.getOwnPropertyNames(err)));
  } catch {
    console.error(`[DETALHES_ERRO] ${ctx}: (nao serializavel)`);
  }
  if (err?.cause) console.error(`[CAUSA_ERRO] ${ctx}:`, err.cause);
  if (err?.code) console.error(`[CODE_ERRO] ${ctx}:`, err.code);
}

/** Doc Shopee: máximo 500 registros por página. */
const SHOPEE_PAGE_LIMIT = 500;
const SHOPEE_MAX_PAGES = 1000;
/** Máximo de reinícios da cadeia scrollId por pull (expiração/11001). */
const SHOPEE_MAX_SCROLL_RESTARTS = 3;
/** Entre páginas da mesma cadeia scrollId (válido por 30s). */
const SHOPEE_PAGE_DELAY_MS = 200;
/** Doc Shopee: nova query sem scrollId exige intervalo > 30s (override: SHOPEE_NEW_QUERY_DELAY_MS). */
const SHOPEE_NEW_QUERY_DELAY_MS = Math.max(30_000, Number(process.env.SHOPEE_NEW_QUERY_DELAY_MS || 31_000));
const {
  loadShopeeOficialPeriodRef,
  getShopeeOficialPeriodRefSync,
  monthHasShopeePanelTarget,
} = require("./lib/shopeeOficialRef");
const SHOPEE_SCROLL_CHAIN_WARN_MS = 25_000;

// Margem de segurança do cursor: refaz X minutos pra trás além do "última
// execução". Captura conversões que entraram com atraso de eventual delay
// na atribuição da Shopee.
const SHOPEE_CURSOR_BACKFILL_MIN = 30;

// Fallback se sync_state estiver vazio (primeira vez sem backfill ainda).
// Evita varredura desnecessária do mundo inteiro.
const SHOPEE_INITIAL_LOOKBACK_MIN = 60;

function shopeeSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Timestamp da última query conversionReport sem scrollId (regra API >30s). */
let lastNoScrollQueryAt = 0;

async function waitNoScrollInterval(label = "shopee") {
  const elapsed = Date.now() - lastNoScrollQueryAt;
  if (lastNoScrollQueryAt > 0 && elapsed < SHOPEE_NEW_QUERY_DELAY_MS) {
    const waitMs = SHOPEE_NEW_QUERY_DELAY_MS - elapsed;
    console.log(`[shopee] aguardando ${waitMs}ms antes de nova query sem scrollId [${label}]`);
    await shopeeSleep(waitMs);
  }
  lastNoScrollQueryAt = Date.now();
}

/**
 * utmContent da Shopee = até 5 slots de subId unidos por "-".
 * "story----" → "story" · "lgflare-lgsuplexdp---" → "lgflare" (slot 1 = campanha).
 * NÃO usar para ad_name do Meta — só para utmContent do conversionReport.
 */
function normalizeShopeeSubId(utmContent) {
  let s = String(utmContent || "").trim();
  if (s.includes("-")) {
    const slot = s.split("-").find((p) => p.trim().length > 0);
    if (slot) s = slot.trim();
  }
  return normalizeSubId(s);
}

function shopeeSignature(appId, timestamp, payload, secret) {
  const crypto = require("crypto");
  return crypto.createHash("sha256")
    .update(appId + timestamp + payload + secret)
    .digest("hex");
}

const SHOPEE_CONNECT_TIMEOUT_MS = Number(process.env.SHOPEE_CONNECT_TIMEOUT_MS || 60_000);
const SHOPEE_FETCH_MAX_CONNECT_RETRIES = 3;

let _shopeeUndiciAgent = null;
function getShopeeUndiciAgent() {
  if (_shopeeUndiciAgent) return _shopeeUndiciAgent;
  try {
    const { Agent } = require("undici");
    _shopeeUndiciAgent = new Agent({
      connectTimeout: SHOPEE_CONNECT_TIMEOUT_MS,
      headersTimeout: SHOPEE_CONNECT_TIMEOUT_MS + 30_000,
      bodyTimeout: SHOPEE_CONNECT_TIMEOUT_MS + 60_000,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
    return _shopeeUndiciAgent;
  } catch {
    return null;
  }
}

function isShopeeConnectTimeout(err) {
  const code = String(err?.code || err?.cause?.code || "");
  const msg = String(err?.message || "");
  const causeMsg = String(err?.cause?.message || "");
  return code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT"
    || /Connect Timeout/i.test(msg) || /Connect Timeout/i.test(causeMsg)
    || (/fetch failed/i.test(msg) && /Connect Timeout/i.test(causeMsg));
}

/** POST HTTPS com IPv4 forçado (family:4) — GCP falha com undici default 10s em IPv6. */
function shopeeHttpsPost(url, headers, body, timeoutMs = SHOPEE_CONNECT_TIMEOUT_MS) {
  const https = require("https");
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "POST",
      family: 4,
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => data,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error(`Connect Timeout (${timeoutMs}ms)`), { code: "ETIMEDOUT" }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** fetch com connectTimeout 60s — undici Agent local; https+IPv4 no Cloud Functions. */
async function shopeeFetchHttp(url, options, attempt = 1) {
  const body = typeof options.body === "string" ? options.body : "";
  const headers = options.headers || {};
  const useHttpsIpv4 = process.env.SHOPEE_FORCE_IPV4 !== "0";

  try {
    if (useHttpsIpv4) {
      return await shopeeHttpsPost(url, headers, body);
    }
    const agent = getShopeeUndiciAgent();
    if (agent) {
      const { fetch: undiciFetch } = require("undici");
      return await undiciFetch(url, { ...options, dispatcher: agent });
    }
    return await fetch(url, options);
  } catch (err) {
    if (isShopeeConnectTimeout(err) && attempt < SHOPEE_FETCH_MAX_CONNECT_RETRIES) {
      const waitMs = Math.min(15_000, 2000 * attempt);
      console.warn(`[shopee] connect timeout, retry ${attempt}/${SHOPEE_FETCH_MAX_CONNECT_RETRIES} em ${waitMs}ms`);
      await shopeeSleep(waitMs);
      return shopeeFetchHttp(url, options, attempt + 1);
    }
    throw err;
  }
}

async function shopeeFetch(query, attempt = 1) {
  const appId = (process.env.SHOPEE_APP_ID || "").trim();
  const secret = (process.env.SHOPEE_SECRET || "").trim();
  if (!appId || !secret) throw new Error("SHOPEE_APP_ID/SHOPEE_SECRET não configurados");

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });
  const signature = shopeeSignature(appId, timestamp, payload, secret);

  let response;
  try {
    response = await shopeeFetchHttp(SHOPEE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body: payload,
    });
  } catch (err) {
    logErroFetchCru(err, `shopeeFetch tentativa ${attempt}`);
    throw err;
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error("Resposta Shopee inválida: " + text.slice(0, 200)); }

  if (data.errors && data.errors.length > 0) {
    const messages = data.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; ");
    const isRateLimit = data.errors.some((e) => String(e.extensions?.code || "") === "10030")
      || /rate limit/i.test(messages);
    if (isRateLimit && attempt <= 4) {
      const waitMs = attempt * 8000;
      console.warn(`[shopee] rate limit (10030), retry ${attempt}/4 em ${waitMs}ms`);
      await shopeeSleep(waitMs);
      return shopeeFetch(query, attempt + 1);
    }
    throw new Error("Shopee API: " + messages);
  }
  return data.data;
}

/** GraphQL com variables (productOfferV2, generateShortLink, etc.). */
async function shopeeFetchGraphqlBody(bodyObj, attempt = 1) {
  const appId = (process.env.SHOPEE_APP_ID || "").trim();
  const secret = (process.env.SHOPEE_SECRET || "").trim();
  if (!appId || !secret) throw new Error("SHOPEE_APP_ID/SHOPEE_SECRET não configurados");

  const payload = JSON.stringify(bodyObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = shopeeSignature(appId, timestamp, payload, secret);

  let response;
  try {
    response = await shopeeFetchHttp(SHOPEE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body: payload,
    });
  } catch (err) {
    logErroFetchCru(err, `shopeeFetchGraphqlBody tentativa ${attempt}`);
    throw err;
  }

  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error("Resposta Shopee inválida: " + text.slice(0, 200)); }

  if (parsed.errors?.length) {
    const messages = parsed.errors.map((e) => `${e.extensions?.code || "?"}: ${e.message}`).join("; ");
    const isRateLimit = parsed.errors.some((e) => String(e.extensions?.code || "") === "10030")
      || /rate limit/i.test(messages);
    if (isRateLimit && attempt <= 4) {
      const waitMs = attempt * 8000;
      await shopeeSleep(waitMs);
      return shopeeFetchGraphqlBody(bodyObj, attempt + 1);
    }
    throw new Error("Shopee API: " + messages);
  }

  return parsed;
}

function buildShopeeQuery(startTs, endTs, scrollId, orderStatus = null) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  const statusClause = orderStatus ? `, orderStatus: ${JSON.stringify(orderStatus)}` : "";
  return `{
    conversionReport(
      limit: ${SHOPEE_PAGE_LIMIT},
      purchaseTimeStart: ${startTs},
      purchaseTimeEnd: ${endTs}${statusClause}${scrollClause}
    ) {
      nodes {
        purchaseTime clickTime conversionId
        totalCommission netCommission shopeeCommissionCapped sellerCommission
        mcnManagementFee mcnManagementFeeRate linkedMcnName
        referrer utmContent device buyerType
        orders {
          orderId orderStatus shopType
          items {
            itemId itemName itemPrice actualAmount refundAmount qty
            completeTime fraudStatus displayItemStatus itemNotes
            itemTotalCommission itemSellerCommission itemSellerCommissionRate
            itemShopeeCommissionCapped itemShopeeCommissionRate
            shopId shopName
            globalCategoryLv1Name globalCategoryLv2Name globalCategoryLv3Name
            attributionType channelType imageUrl
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

function shopeeClassifyStatus(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (s === "COMPLETED" || s.includes("CONCLU") || s.includes("COMPLET")) return "concluida";
  if (shopeeIsStatusPerda(s)) return "cancelada";
  if (s === "UNPAID") return "unpaid";
  return "pendente";
}

/** Status que a Shopee considera perda definitiva — NÃO inclui UNPAID/PENDING. */
function shopeeIsStatusPerda(rawStatus) {
  const s = String(rawStatus || "").toUpperCase().trim();
  if (!s) return false;

  const pendentes = new Set([
    "UNPAID", "PENDING", "PROCESSING", "WAITING_PAYMENT",
    "TO_CONFIRM", "TO_SHIP", "SHIPPING", "SHIPPED",
    "COMPLETED", "PAID", "READY_TO_SHIP", "PROCESSED",
    "TO_CONFIRM_RECEIVE", "RETRY_SHIP", "IN_CANCEL",
  ]);
  if (pendentes.has(s)) return false;

  const perdas = new Set([
    "CANCELLED", "CANCELED", "FAILED", "FRAUD", "EXPIRED",
    "REFUNDED", "REJECTED", "VOID", "INVALID",
  ]);
  if (perdas.has(s)) return true;

  if (s.includes("CANCEL")) return true;
  if (s.includes("FRAUD")) return true;
  if (s.includes("REFUND")) return true;
  return false;
}

function shopeeIsDireta(attr) {
  const val = String(attr || "").toUpperCase();
  return (val.includes("SAME SHOP") || val.includes("SAME_SHOP")) ? 1 : 0;
}

async function shopeePullRange(startTs, endTs, orderStatus = null) {
  const allNodes = [];
  const seenConversionIds = new Set();
  let duplicates = 0;
  let scrollId = null;
  let hasNext = true;
  let pageCount = 0;
  let scrollRestarts = 0;
  const statusLabel = orderStatus || "ALL";
  const chainStartedAt = Date.now();

  while (hasNext && pageCount < SHOPEE_MAX_PAGES) {
    pageCount++;
    if (!scrollId) await waitNoScrollInterval(statusLabel);
    const query = buildShopeeQuery(startTs, endTs, scrollId, orderStatus);
    let data;
    try {
      data = await shopeeFetch(query);
    } catch (err) {
      const msg = String(err?.message || err);
      if (pageCount === 1 || !/scroll|11001|params/i.test(msg)) throw err;
      scrollRestarts++;
      if (scrollRestarts > SHOPEE_MAX_SCROLL_RESTARTS) {
        throw new Error(`Shopee: cadeia scrollId reiniciada ${scrollRestarts}x (limite ${SHOPEE_MAX_SCROLL_RESTARTS}) — abortando pull [${statusLabel}]. Último erro: ${msg}`);
      }
      console.warn(`[shopee] scroll_expired_restart [${statusLabel}] pág ${pageCount} (${scrollRestarts}/${SHOPEE_MAX_SCROLL_RESTARTS})`);
      scrollId = null;
      hasNext = true;
      pageCount = 0;
      await waitNoScrollInterval(`${statusLabel}_restart`);
      continue;
    }
    const report = data?.conversionReport || {};
    const nodes = report.nodes || [];
    let pageNew = 0;
    for (const node of nodes) {
      const cid = String(node?.conversionId || "").trim();
      // CORREÇÃO: a API Shopee agrupa múltiplos orderIds dentro do mesmo
      // conversionId. Confirmado por diagnóstico: 91 de 565 conversões em
      // 02/06 tinham 2+ orderIds, uma com 15. Dedupar só por cid descartava
      // ~23% dos pedidos legítimos. Chave correta: par (cid, orderId).
      const orderId = String(node?.orders?.[0]?.orderId || "").trim();
      const key = (cid && orderId)
        ? `${cid}__${orderId}`
        : (cid || `__noid_${node?.purchaseTime || ""}_${orderId}`);

      if (key && seenConversionIds.has(key)) {
        duplicates++;
        continue;
      }
      if (key) seenConversionIds.add(key);
      allNodes.push(node);
      pageNew++;
    }

    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    const novoScrollId = pi.scrollId || null;

    console.log(`[shopee] [${statusLabel}] página ${pageCount}: +${nodes.length} (${pageNew} novas, ${nodes.length - pageNew} dup) | total único: ${allNodes.length} | hasNext=${hasNext}`);

    if (hasNext && novoScrollId === scrollId && novoScrollId !== null) {
      console.warn("[shopee] scrollId repetido — paginação em loop, parando.");
      break;
    }
    scrollId = novoScrollId;

    if (hasNext && !scrollId) {
      console.warn("[shopee] hasNextPage=true mas sem scrollId. Parando por segurança.");
      break;
    }
    if (hasNext) {
      const elapsed = Date.now() - chainStartedAt;
      if (elapsed > SHOPEE_SCROLL_CHAIN_WARN_MS) {
        console.warn(`[shopee] [${statusLabel}] cadeia scrollId em ${elapsed}ms (limite API ~30s)`);
      }
      await shopeeSleep(SHOPEE_PAGE_DELAY_MS);
    }
  }

  if (duplicates > 0) {
    const pct = ((duplicates / (allNodes.length + duplicates)) * 100).toFixed(1);
    console.warn(`[shopee] ⚠️ ${duplicates} conversões duplicadas removidas (${pct}% das vindas da API)`);
  }

  return { allNodes, pageCount, duplicates };
}

/** Puxa conversões: ALL (como PromosApp) + por status (complementa paginação). */
async function shopeePullRangeComplete(startTs, endTs) {
  const merged = [];
  const seen = new Set();
  let totalPages = 0;
  let totalDuplicates = 0;

  function mergePull(allNodes, pageCount, duplicates) {
    totalPages += pageCount;
    totalDuplicates += duplicates;
    for (const node of allNodes) {
      const cid = String(node?.conversionId || "").trim();
      const orderId = String(node?.orders?.[0]?.orderId || "").trim();
      const key = (cid && orderId)
        ? `${cid}__${orderId}`
        : (cid || `__noid_${node?.purchaseTime || ""}_${orderId}`);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(node);
    }
  }

  const allPull = await shopeePullRange(startTs, endTs, null);
  mergePull(allPull.allNodes, allPull.pageCount, allPull.duplicates);
  console.log(`[shopee] pull ALL: ${allPull.allNodes.length} conversões | ${allPull.pageCount} páginas`);

  // Pulls por status DESABILITADOS:
  // - UNPAID já estava removido.
  // - PENDING / COMPLETED / CANCELLED também rejeitados (erro 10010,
  //   'Expected type DisplayOrderStatus'). A API mudou o enum.
  // - Pull ALL (sem filtro) já cobre todos os status. Confirmado por
  //   diagnóstico: 736 orderIds únicos vindos só do pull ALL.
  // - Economia: ~93s por execução.
  const statuses = [];
  const statusErrors = [];
  for (const status of statuses) {
    await waitNoScrollInterval(`pull_${status}`);
    try {
      const { allNodes, pageCount, duplicates } = await shopeePullRange(startTs, endTs, status);
      mergePull(allNodes, pageCount, duplicates);
      console.log(`[shopee] pull [${status}]: +${allNodes.length} novas únicas acumuladas=${merged.length}`);
    } catch (err) {
      const msg = String(err?.message || err);
      statusErrors.push({ status, error: msg });
      console.warn(`[shopee] pull [${status}] ignorado: ${msg}`);
    }
  }
  if (statusErrors.length > 0) {
    console.warn(`[shopee] ${statusErrors.length} pull(s) por status falharam (dados do ALL preservados):`, JSON.stringify(statusErrors));
  }

  console.log(`[shopee] pull completo: ${merged.length} conversões únicas (ALL + ${statuses.length} status) | páginas=${totalPages} | dup=${totalDuplicates}`);
  return { allNodes: merged, pageCount: totalPages, duplicates: totalDuplicates };
}

function shopeeAggregate(nodes) {
  if (String(process.env.SHOPEE_VERBOSE_DIAG || "").trim() === "1" && nodes?.length > 0) {
    console.log("[DEBUG purchaseTime] amostra:", JSON.stringify({
      primeiro: nodes[0].purchaseTime,
      tipo: typeof nodes[0].purchaseTime,
      total_nodes: nodes.length,
    }));
  }
  const prodMap = {};
  const subIdMap = {};

  for (const node of nodes) {
    const orders = node.orders || [];
    const baseSubIdRaw = node.utmContent || "";
    const baseSubIdNorm = normalizeShopeeSubId(baseSubIdRaw);

    for (const ord of orders) {
      const items = ord.items || [];
      const status = shopeeClassifyStatus(ord.orderStatus || node.conversionStatus);
      const isCancel = status === "cancelada";

      for (const it of items) {
        const itemName = (it.itemName || "").trim();
        const itemId = String(it.itemId || "").trim();
        const shopId = String(it.shopId || "").trim();
        const shopName = (it.shopName || "").trim();
        const fallbackKey = itemId || baseSubIdRaw || "sem_nome";
        const nomeResolvido = itemName || fallbackKey;
        const key = nomeResolvido.toLowerCase();

        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const gmv = (actual > 0 ? actual : price * qty);
        const itemCom = parseItemTotalCommission(it);
        const commission = itemCom;
        const comissaoEstimada = itemCom;
        const comissaoReal = isCancel ? 0 : commission;
        const faturamentoReal = isCancel ? 0 : gmv;

        const isDireta = shopeeIsDireta(it.attributionType);
        const isIndireta = isDireta ? 0 : 1;

        const categoria = [it.globalCategoryLv1Name, it.globalCategoryLv2Name, it.globalCategoryLv3Name]
          .filter(Boolean).join(" > ");

        const subKey = baseSubIdNorm || "missing_subid";

        if (!prodMap[key]) {
          prodMap[key] = {
            nome: nomeResolvido,
            plataforma: "Shopee",
            loja: shopName,
            preco: price,
            id_item: itemId,
            id_loja: shopId,
            link_shopee: (shopId && itemId) ? `https://shopee.com.br/product/${shopId}/${itemId}` : "",
            link_afiliado: "",
            categoria,
            comissao_pct: 0,
            vendas: 0,
            gmv_total: 0,
            comissao_total: 0,
            comissao_concluida: 0,
            comissao_pendente: 0,
            comissao_cancelada: 0,
            comissao_estimada: 0,
            vendas_diretas: 0,
            vendas_indiretas: 0,
            pedidos_pendentes: 0,
            pedidos_concluidos: 0,
            pedidos_cancelados: 0,
            canais: {},
            sub_ids: new Set(),
            cliques: 0,
          };
        }

        const p = prodMap[key];
        p.vendas += qty;
        p.gmv_total += faturamentoReal;
        p.comissao_total += comissaoReal;
        p.comissao_estimada += comissaoEstimada;
        if (price > 0 && (!p.preco || p.preco === 0)) p.preco = price;
        if (baseSubIdRaw) p.sub_ids.add(baseSubIdRaw);

        p.vendas_diretas += isDireta;
        p.vendas_indiretas += isIndireta;

        if (status === "concluida") {
          p.pedidos_concluidos += 1;
          p.comissao_concluida += comissaoReal;
        } else if (status === "cancelada") {
          p.pedidos_cancelados += 1;
          p.comissao_cancelada += comissaoEstimada;
        } else {
          p.pedidos_pendentes += 1;
          p.comissao_pendente += comissaoReal;
        }

        const canal = (it.channelType || node.referrer || "Others").trim() || "Others";
        p.canais[canal] = (p.canais[canal] || 0) + 1;

        if (!subIdMap[subKey]) {
          subIdMap[subKey] = {
            subid: baseSubIdNorm || "",
            comissoes: 0,
            comissoes_estimadas: 0,
            faturamento: 0,
            vendas_diretas: 0,
            vendas_indiretas: 0,
            qtd_itens: 0,
          };
        }
        subIdMap[subKey].comissoes_estimadas += comissaoEstimada;
        subIdMap[subKey].comissoes += comissaoReal;
        subIdMap[subKey].faturamento += faturamentoReal;
        subIdMap[subKey].vendas_diretas += isDireta;
        subIdMap[subKey].vendas_indiretas += isIndireta;
        subIdMap[subKey].qtd_itens += qty;
      }
    }
  }

  return { prodMap, subIdMap };
}

const SHOPEE_FRAUD_RANK = { FRAUD: 3, UNVERIFIED: 2, VERIFIED: 1 };

/** Acumula fraudStatus, displayItemStatus e itemNotes por itemId a partir dos nodes da API. */
function extrairRiscoApiPorItem(allNodes) {
  const map = {};
  for (const node of allNodes || []) {
    for (const ord of node.orders || []) {
      for (const it of ord.items || []) {
        const itemId = String(it.itemId || "").trim();
        if (!itemId) continue;

        const fraudStatus = String(it.fraudStatus || "").toUpperCase().trim();
        const displayItemStatus = String(it.displayItemStatus || "").trim();
        const itemNotes = String(it.itemNotes || "").trim();

        if (!map[itemId]) {
          map[itemId] = {
            itemId,
            nome: String(it.itemName || "").trim(),
            loja: String(it.shopName || "").trim(),
            shopId: String(it.shopId || "").trim(),
            fraud_status: fraudStatus || null,
            display_item_status: displayItemStatus || null,
            notesSet: new Set(),
            fraud_count: 0,
            unverified_count: 0,
          };
        }

        const e = map[itemId];
        if (it.itemName && !e.nome) e.nome = String(it.itemName).trim();
        if (it.shopName && !e.loja) e.loja = String(it.shopName).trim();

        const curRank = SHOPEE_FRAUD_RANK[e.fraud_status] || 0;
        const newRank = SHOPEE_FRAUD_RANK[fraudStatus] || 0;
        if (newRank > curRank) {
          e.fraud_status = fraudStatus || e.fraud_status;
          e.display_item_status = displayItemStatus || e.display_item_status;
        } else if (newRank === curRank && displayItemStatus && !e.display_item_status) {
          e.display_item_status = displayItemStatus;
        }

        if (fraudStatus === "FRAUD") e.fraud_count++;
        else if (fraudStatus === "UNVERIFIED") e.unverified_count++;
        if (itemNotes) e.notesSet.add(itemNotes);
      }
    }
  }

  for (const e of Object.values(map)) {
    e.item_notes = e.notesSet.size ? [...e.notesSet].join(" // ") : null;
    delete e.notesSet;
  }
  return map;
}

/** Persiste campos antifraude em produtos — roda mesmo em sync dailyOnly. */
async function gravarRiscoApiProdutos(db, allNodes, state, flush, importacaoId) {
  const map = extrairRiscoApiPorItem(allNodes);
  const pending = [];
  for (const e of Object.values(map)) {
    pending.push({
      ref: db.collection("produtos").doc(`item_${e.itemId}`),
      payload: {
        fraud_status: e.fraud_status || null,
        display_item_status: e.display_item_status || null,
        item_notes: e.item_notes || null,
        fraud_count: e.fraud_count || 0,
        unverified_count: e.unverified_count || 0,
        risco_api_updated_at: FieldValue.serverTimestamp(),
        importacaoId,
      },
    });
  }
  const { gravados, ignorados } = await applyPendingWrites(state, flush, pending, { merge: true });
  if (ignorados > 0) {
    console.log(`[shopee] risco_api: ${ignorados} produtos inalterados (write omitido)`);
  }
  return gravados;
}

function ensureDayMapEntry(dayMap, date) {
  if (!dayMap[date]) {
    dayMap[date] = {
      data: date,
      pedidos: 0,
      pedidos_pendentes: 0,
      pedidos_concluidos: 0,
      pedidos_cancelados: 0,
      vendas: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
      faturamento: 0,
      gmv_total: 0,
      comissao_real: 0,
      comissao_total: 0,
      comissao_concluida: 0,
      comissao_pendente: 0,
      comissao_estimada: 0,
      mcn_fee: 0,
      pedidos_nao_pagos: 0,
      comissao_nao_paga: 0,
      perdas_pedidos: 0,
      perdas_fat: 0,
      perdas_comissao: 0,
    };
  }
  if (!dayMap[date]._pedidosVistos) dayMap[date]._pedidosVistos = new Set();
  if (!dayMap[date]._itemsVistos) dayMap[date]._itemsVistos = new Set();
  if (!dayMap[date]._conversoesAplicadas) dayMap[date]._conversoesAplicadas = new Set();
  return dayMap[date];
}

function ensureSubIdDayEntry(subIdDayMap, subDocId, date, subKey) {
  if (!subIdDayMap[subDocId]) {
    subIdDayMap[subDocId] = {
      data: date,
      subid: subKey,
      pedidos: 0,
      qtd_itens: 0,
      faturamento: 0,
      comissoes: 0,
      comissoes_estimadas: 0,
      vendas_diretas: 0,
      vendas_indiretas: 0,
    };
  }
  return subIdDayMap[subDocId];
}

/** Conta pedidos/itens/GMV no dia — inclui cancelados e UNPAID (igual Insights Shopee). */
function contabilizarItensPainel(dayEntry, subEntry, items, orderKey, { incluirFaturamento = true } = {}) {
  let qtyAdded = 0;
  for (const it of items) {
    const itemFraudStatus = String(it.fraudStatus || "").toUpperCase().trim();
    if (itemFraudStatus === "FRAUD") continue;

    const itemId = String(it.itemId || "").trim();
    const itemKey = `${orderKey}_${itemId || "noitem"}`;
    if (dayEntry._itemsVistos.has(itemKey)) continue;
    dayEntry._itemsVistos.add(itemKey);

    const qty = parseInt(it.qty, 10) || 1;
    qtyAdded += qty;
    const price = parseFloat(it.itemPrice || "0") || 0;
    const actual = parseFloat(it.actualAmount || "0") || 0;
    const gmv = actual > 0 ? actual : price * qty;
    const isDireta = shopeeIsDireta(it.attributionType);
    const isIndireta = isDireta ? 0 : 1;

    dayEntry.vendas += qty;
    dayEntry.vendas_diretas += isDireta * qty;
    dayEntry.vendas_indiretas += isIndireta * qty;
    if (incluirFaturamento) {
      dayEntry.faturamento += gmv;
      dayEntry.gmv_total += gmv;
      if (subEntry) subEntry.faturamento += gmv;
    }
    if (subEntry) {
      subEntry.qtd_itens += qty;
      subEntry.vendas_diretas += isDireta * qty;
      subEntry.vendas_indiretas += isIndireta * qty;
    }
  }
  return qtyAdded;
}

/** GMV/itens estilo PromosApp: soma actualAmount por item, sem dedup. */
function contabilizarItensPromosApp(dayEntry, subEntry, items) {
  let qtyAdded = 0;
  for (const it of items) {
    const itemFraudStatus = String(it.fraudStatus || "").toUpperCase().trim();
    if (itemFraudStatus === "FRAUD") continue;

    const qty = parseInt(it.qty, 10) || 1;
    qtyAdded += qty;
    const price = parseFloat(it.itemPrice || "0") || 0;
    const actual = parseFloat(it.actualAmount || "0") || 0;
    const gmv = actual > 0 ? actual : price * qty;
    const isDireta = shopeeIsDireta(it.attributionType);
    const isIndireta = isDireta ? 0 : 1;

    dayEntry.vendas += qty;
    dayEntry.vendas_diretas += isDireta * qty;
    dayEntry.vendas_indiretas += isIndireta * qty;
    dayEntry.faturamento += gmv;
    dayEntry.gmv_total += gmv;
    if (subEntry) {
      subEntry.faturamento += gmv;
      subEntry.qtd_itens += qty;
      subEntry.vendas_diretas += isDireta * qty;
      subEntry.vendas_indiretas += isIndireta * qty;
    }
  }
  return qtyAdded;
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Comissão total do item = Shopee + Seller. Nunca total → parte-só. */
function parseItemTotalCommission(it) {
  if (it == null) return 0;
  if (it.itemTotalCommission != null && it.itemTotalCommission !== "") {
    return parseFloat(it.itemTotalCommission) || 0;
  }
  const shopee = parseFloat(it.itemShopeeCommissionCapped ?? it.itemCommission ?? 0) || 0;
  const seller = parseFloat(it.itemSellerCommission ?? it.grossBrandCommission ?? 0) || 0;
  return shopee + seller;
}

/** Split concluída/pendente por comissão item-level (ignora UNPAID/cancelado). */
function splitComissaoPorStatusItens(node, orders) {
  // Critério PromosApp (H2): a conversão inteira muda de balde junto.
  let total = 0;
  let validados = 0;
  let concluidos = 0;
  for (const ord of orders || []) {
    const statusRaw = ord.orderStatus || node.conversionStatus || "";
    const stUpper = String(statusRaw || "").toUpperCase().trim();
    if (stUpper === "UNPAID") continue;
    if (shopeeOrderExcludedCommission(stUpper)) continue;
    validados += 1;
    if (shopeeClassifyStatus(statusRaw) === "concluida") concluidos += 1;
    for (const it of ord.items || []) {
      if (String(it.fraudStatus || "").toUpperCase().trim() === "FRAUD") continue;
      total += parseItemTotalCommission(it);
    }
  }
  const conversaoConcluida = validados > 0 && concluidos === validados;
  return conversaoConcluida
    ? { concluida: total, pendente: 0 }
    : { concluida: 0, pendente: total };
}

function escalaSplitComissaoConversao(split, totalAlvo) {
  const alvo = roundMoney(totalAlvo);
  if (alvo <= 0) return { concluida: 0, pendente: 0 };
  const bruto = split.concluida + split.pendente;
  if (bruto <= 0) return { concluida: 0, pendente: alvo };
  const concluida = roundMoney((split.concluida / bruto) * alvo);
  return { concluida, pendente: roundMoney(alvo - concluida) };
}

function aplicarSplitComissaoConversao(day, comissaoTotal, splitRaw) {
  const split = escalaSplitComissaoConversao(splitRaw, comissaoTotal);
  day.comissao_estimada += comissaoTotal;
  day.comissao_real += comissaoTotal;
  day.comissao_total += comissaoTotal;
  day.comissao_concluida += split.concluida;
  day.comissao_pendente += split.pendente;
}

function comissaoItemOrdemUnpaid(ord) {
  let s = 0;
  for (const it of ord.items || []) {
    if (String(it.fraudStatus || "").toUpperCase().trim() === "FRAUD") continue;
    s += parseItemTotalCommission(it);
  }
  return s;
}

function acumularUnpaidPedido(day, orderKey, ord) {
  if (!day._naoPagosVistos) day._naoPagosVistos = new Set();
  if (orderKey && !day._naoPagosVistos.has(orderKey)) {
    day._naoPagosVistos.add(orderKey);
    day.pedidos_nao_pagos = (day.pedidos_nao_pagos || 0) + 1;
  }
  day.comissao_nao_paga = roundMoney((day.comissao_nao_paga || 0) + comissaoItemOrdemUnpaid(ord));
}

/** UNPAID por data do pedido — após todos os overrides/reconciliações. */
function acumularUnpaidEmDayMap(nodes, dayMap) {
  for (const date of Object.keys(dayMap)) {
    dayMap[date].pedidos_nao_pagos = 0;
    dayMap[date].comissao_nao_paga = 0;
    delete dayMap[date]._naoPagosVistos;
  }
  for (const node of nodes) {
    for (const ord of node.orders || []) {
      const statusRaw = ord.orderStatus || node.conversionStatus || "";
      if (shopeeClassifyStatus(statusRaw) !== "unpaid") continue;
      const date = formatUnixToBRTDate(ord.purchaseTime || node.purchaseTime);
      if (!date) continue;
      if (!dayMap[date]) dayMap[date] = criarDailyVazio(date);
      const dayEntry = dayMap[date];
      const oid = String(ord.orderId || "").trim();
      acumularUnpaidPedido(dayEntry, oid || `__unpaid_${node.conversionId || "?"}`, ord);
    }
  }
}

function somaPedidosNaoPagosDayMap(dayMap) {
  let n = 0;
  for (const d of Object.values(dayMap || {})) n += Number(d.pedidos_nao_pagos || 0);
  return n;
}

/** orderIds que o PromosApp não conta (descoberto por calibração 665→664 / comissão 1917,31). */
let PROMOS_EXCLUDE_ORDER_IDS = new Set();
/** orderIds contados como concluídos no PromosApp (ex.: 5 em 02/06, comissão ~R$ 4,77). */
let PROMOS_CONCLUIDOS_OIDS = new Set();

function comissaoValorAgregacao(node, source = null) {
  const src = source || SHOPEE_API_COMMISSION_SOURCE || "total";
  if (src === "net") {
    const n = parseFloat(node.netCommission || "0") || 0;
    if (n > 0) return n;
  }
  if (src === "items") {
    let s = 0;
    for (const ord of node.orders || []) {
      for (const it of ord.items || []) {
        s += parseItemTotalCommission(it);
      }
    }
    if (s > 0) return s;
  }
  return comissaoDoNode(node);
}

function comissaoDoNode(node) {
  let tc = parseFloat(node.totalCommission || "0") || 0;
  if (tc === 0) {
    tc = (parseFloat(node.shopeeCommissionCapped || "0") || 0) +
      (parseFloat(node.sellerCommission || "0") || 0);
  }
  if (tc === 0) {
    for (const ord of node.orders || []) {
      for (const it of ord.items || []) {
        tc += parseItemTotalCommission(it);
      }
    }
  }
  return tc;
}

/** Pedido entra na contagem PromosApp (664 em 02/06 = 736 − 70 cancel − 2 inválidos). */
function pedidoContaPromosApp(ord, node) {
  const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
  if (st === "CANCELLED" || shopeeIsStatusPerda(st)) return false;

  const oid = String(ord.orderId || "").trim();
  if (!oid) return false;
  if (PROMOS_EXCLUDE_ORDER_IDS.has(oid)) return false;

  const items = ord.items || [];
  if (items.length === 0) return false;

  if (items.length > 0 && items.every((it) => String(it.fraudStatus || "").toUpperCase() === "FRAUD")) {
    return false;
  }
  if (items.some((it) => String(it.fraudStatus || "").toUpperCase() === "FRAUD")) {
    return false;
  }

  let gmvItensValidos = 0;
  let itensNaoPerda = 0;
  for (const it of items) {
    if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
    const disp = String(it.displayItemStatus || "").toUpperCase().trim();
    if (disp === "CANCELLED" || disp.includes("CANCEL")) continue;
    itensNaoPerda += 1;
    const qty = parseInt(it.qty, 10) || 1;
    const price = parseFloat(it.itemPrice || "0") || 0;
    const actual = parseFloat(it.actualAmount || "0") || 0;
    gmvItensValidos += actual > 0 ? actual : price * qty;
  }

  if (items.length > 0 && itensNaoPerda === 0) return false;
  if (items.length > 0 && gmvItensValidos <= 0) return false;

  if (st === "UNPAID" && items.length > 0 && gmvItensValidos <= 0) return false;

  return true;
}

/** PromosApp: concluído = orderId calibrado (subset de COMPLETED cuja comissão soma ~meta do dia). */
function pedidoConcluidoPromosApp(ord, node) {
  const oid = String(ord.orderId || "").trim();
  if (PROMOS_CONCLUIDOS_OIDS.size > 0) return PROMOS_CONCLUIDOS_OIDS.has(oid);
  const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
  if (shopeeClassifyStatus(st) !== "concluida") return false;
  return (ord.items || []).some((it) => Number(it.completeTime) > 0);
}

/** Calibração PromosApp DESATIVADA — referência agora é o app Shopee Insights
 *  (regra A / api_faithful_v2 em todos os dias). Histórico: 02/06 calibrava 664
 *  pedidos do mestredolink via C(n,5), que travava a function. */
const PROMOS_CALIB_REF = {};

/**
 * Metas do app Shopee Afiliados (screenshot do celular/web).
 * Meses listados aqui: o backend testa várias regras só com dados da API e escolhe a mais próxima.
 * Atualize pedidos/comissão/gmv/itens quando bater foto nova do app (sem inventar número).
 */
/** TRAVADO regra B (jun/2026+): calibração por display desativada permanentemente. */
const SHOPEE_USE_DISPLAY_CALIB = false;
/** TRAVADO regra B (jun/2026+): sem escala ao painel. A API já bate o app (<1%). */
const SHOPEE_ALIGN_PANEL_EXACT = false;
/** Iguala totais gravados ao export CSV (planilha). Liga: SHOPEE_SNAP_CSV_BATIMENTO=1 + backfill do mês. */
const SHOPEE_SNAP_CSV_BATIMENTO = String(process.env.SHOPEE_SNAP_CSV_BATIMENTO ?? "0").trim() === "1";
const SHOPEE_CSV_BATIMENTO_REF = {
  "2026-05": {
    pedidos: 11818,
    comissao: 35432.67,
    comissao_concluida: 24538.13,
    comissao_pendente: 10825.43,
    gmv: 696359.73,
    itens: 13475,
    vendas_diretas: 1989,
    vendas_indiretas: 11486,
    nao_liquidados: 1541,
    fat_perdido: 100497.49,
  },
};
const SHOPEE_AGG_RULES_VERSION = "api-faithful-v2";

/** Comissão na agregação API: order | conversion | row | node_bruto */
let SHOPEE_API_COMMISSION_SCOPE = "order";
/** Campo de comissão: total | net | items */
let SHOPEE_API_COMMISSION_SOURCE = "total";
/** Variante padrão (lab maio/2026: api_faithful_v2 ±1% vs painel). */
const SHOPEE_DEFAULT_PANEL_VARIANT = "api_faithful_v2";
/** TRAVADO regra B (jun/2026+): api_faithful_v2 por padrão; calibração de variantes nunca. */
const SHOPEE_FORCE_RULE_A = true;

/**
 * Modo de agregação gravado em shopee_daily:
 * - api (padrão): api-faithful-v2 — alinha com Insights Shopee / Open API.
 * - promosapp: node_once — mesma lógica do painel PromosApp (totalCommission 1× por conversão).
 *   Use SHOPEE_AGG_MODE=promosapp quando o batimento for contra mestredolink.promos.app.
 */
function getShopeeAggregationMode() {
  const raw = String(process.env.SHOPEE_AGG_MODE || "promosapp").trim().toLowerCase();
  if (raw === "api" || raw === "faithful" || raw === "api-faithful-v2") return "api";
  return "promosapp";
}

/** Label gravado em shopee_daily.aggregation_mode e sync_state/shopee_health. */
function shopeeAggModeHealthLabel() {
  getShopeeRuleAPanelChoice();
  return SHOPEE_PANEL_AGGREGATION_LABEL || "promosapp-node-once";
}

function getShopeeRuleAPanelChoice() {
  if (getShopeeAggregationMode() === "promosapp") {
    SHOPEE_PANEL_AGGREGATION_LABEL = "promosapp-node-once";
    return {
      kind: "app",
      mode: "node_once",
      variant: "app_node_commission",
    };
  }
  SHOPEE_PANEL_AGGREGATION_LABEL = SHOPEE_AGG_RULES_VERSION;
  return {
    kind: "api",
    scope: "order",
    commissionSource: "total",
    variant: "api_faithful_v2",
  };
}
let SHOPEE_PANEL_AGGREGATION_LABEL = getShopeeAggregationMode() === "promosapp"
  ? "promosapp-node-once"
  : SHOPEE_AGG_RULES_VERSION;

/** Variante de regra ativa (escolhida automaticamente por período). */
let SHOPEE_OFICIAL_VARIANT = "oficial_v1";

const SHOPEE_PANEL_VARIANTES = [
  { id: "api_faithful_v2", kind: "api", scope: "order", commissionSource: "total" },
  { id: "api_v2_net", kind: "api", scope: "order", commissionSource: "net" },
  { id: "api_v2_items", kind: "api", scope: "order", commissionSource: "items" },
  { id: "api_faithful_v1", kind: "api", scope: "conversion", commissionSource: "total" },
  { id: "api_faithful_row", kind: "api", scope: "row", commissionSource: "total" },
  { id: "api_node_bruto", kind: "api", scope: "node_bruto", commissionSource: "total" },
  { id: "app_node_commission", kind: "app", mode: "node_once" },
  { id: "app_max_per_order", kind: "app", mode: "max_per_order" },
  { id: "app_pedido_cid", kind: "app", mode: "node_once_cid_pedido" },
  { id: "oficial_v1", kind: "oficial", variant: "oficial_v1" },
  { id: "oficial_node", kind: "oficial", variant: "oficial_node" },
  { id: "oficial_bruto", kind: "oficial", variant: "oficial_bruto" },
  { id: "promos_strict", kind: "oficial", variant: "promos_strict" },
];

/** Quanto menor, mais próximo do painel Shopee (metas = screenshot do app, só API). */
function officialPeriodScore(t, target) {
  const dp = Math.abs(t.pedidos - target.pedidos) / Math.max(1, target.pedidos);
  const dc = Math.abs(t.comissao - target.comissao) / Math.max(1, target.comissao);
  const dg = Math.abs((t.gmv || 0) - (target.gmv || 0)) / Math.max(1, target.gmv || 1);
  const di = Math.abs((t.itens || 0) - (target.itens || 0)) / Math.max(1, target.itens || 1);
  return dp * 40000 + dc * 40000 + dg * 5000 + di * 8000;
}

/** Penaliza totais abaixo do painel (meta: não ficar “a menos” que o app). */
function officialPeriodScorePanel(t, target) {
  let s = officialPeriodScore(t, target);
  if (t.comissao < target.comissao) s += (target.comissao - t.comissao) * 800;
  if (t.pedidos < target.pedidos) s += (target.pedidos - t.pedidos) * 1200;
  if ((t.gmv || 0) < target.gmv) s += (target.gmv - (t.gmv || 0)) * 0.8;
  if ((t.itens || 0) < target.itens) s += (target.itens - (t.itens || 0)) * 80;
  return s;
}

function pedidoKeyPanelShopee(ord, node) {
  const oid = String(ord.orderId || "").trim();
  if (oid) return `o:${oid}`;
  const cid = String(node.conversionId || "").trim();
  return cid ? `c:${cid}` : "";
}

function contabilizarGmvInsightsShopee(items) {
  let gmv = 0;
  let itens = 0;
  for (const it of items) {
    if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
    const qty = parseInt(it.qty, 10) || 1;
    const price = parseFloat(it.itemPrice || "0") || 0;
    const actual = parseFloat(it.actualAmount || "0") || 0;
    gmv += actual > 0 ? actual : price * qty;
    itens += qty;
  }
  return { gmv, itens };
}

/** Pedido no painel oficial Shopee: só exclui cancelado; sem filtro fraude/UNPAID. */
function pedidoContaShopeeOficial(ord, node) {
  if (SHOPEE_OFICIAL_VARIANT === "promos_strict") return pedidoContaPromosApp(ord, node);
  const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
  if (st === "CANCELLED" || st === "CANCELED") return false;
  if (SHOPEE_OFICIAL_VARIANT === "oficial_bruto") return true;
  return Boolean(String(ord.orderId || "").trim());
}

function itemContaShopeeOficial(it) {
  if (SHOPEE_OFICIAL_VARIANT === "promos_strict") return itemContaGmvPromosApp(it);
  if (SHOPEE_OFICIAL_VARIANT === "oficial_bruto") {
    const qty = parseInt(it.qty, 10) || 1;
    return qty > 0;
  }
  const disp = String(it.displayItemStatus || "").toUpperCase().trim();
  if (disp === "CANCELLED" || disp.includes("CANCEL")) return false;
  return true;
}

function pedidoConcluidoShopeeOficial(ord, node) {
  const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
  return shopeeClassifyStatus(st) === "concluida";
}

/** Simula totais do mês com a variante oficial ativa. */
function simularTotaisShopeeOficialPeriodo(nodes) {
  const pedidosGlobal = new Set();
  const comissaoPorPedido = new Map();
  const comissaoPorNode = new Set();
  let comissao = 0;
  let gmv = 0;
  let itens = 0;

  for (const node of nodes) {
    const tc = comissaoDoNode(node);
    const ord0 = node.orders?.[0];
    if (!ord0) continue;
    const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    if (st0 === "CANCELLED" || st0 === "CANCELED") continue;

    let nodeTemPedido = false;
    for (const ord of node.orders || []) {
      if (!pedidoContaShopeeOficial(ord, node)) continue;
      nodeTemPedido = true;
      const oid = String(ord.orderId || "").trim();
      if (oid) pedidosGlobal.add(oid);
      for (const it of ord.items || []) {
        if (!itemContaShopeeOficial(it)) continue;
        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        gmv += actual > 0 ? actual : price * qty;
        itens += qty;
      }
    }
    if (!nodeTemPedido) continue;

    if (SHOPEE_OFICIAL_VARIANT === "oficial_node" || SHOPEE_OFICIAL_VARIANT === "oficial_bruto") {
      const nodeKey = String(node.conversionId || ord0.orderId || "").trim();
      if (nodeKey && !comissaoPorNode.has(nodeKey)) {
        comissaoPorNode.add(nodeKey);
        comissao += tc;
      }
    } else {
      let oidComissao = "";
      for (const ord of node.orders || []) {
        if (!pedidoContaShopeeOficial(ord, node)) continue;
        oidComissao = String(ord.orderId || "").trim();
        if (oidComissao) break;
      }
      if (!oidComissao) oidComissao = String(ord0.orderId || "").trim();
      if (oidComissao && !comissaoPorPedido.has(oidComissao)) {
        comissaoPorPedido.set(oidComissao, tc);
        comissao += tc;
      }
    }
  }

  return {
    pedidos: pedidosGlobal.size,
    comissao: roundMoney(comissao),
    gmv: roundMoney(gmv),
    itens,
  };
}

function simularOficialComVariante(nodes, variant) {
  const prev = SHOPEE_OFICIAL_VARIANT;
  SHOPEE_OFICIAL_VARIANT = variant;
  try {
    return simularTotaisShopeeOficialPeriodo(nodes);
  } finally {
    SHOPEE_OFICIAL_VARIANT = prev;
  }
}

/** Simula totais do mês com agregação API fiel (vários modos de comissão). */
function simularTotaisApiFaithfulPeriodo(nodes, scope, commissionSource = "total") {
  const prevScope = SHOPEE_API_COMMISSION_SCOPE;
  const prevSource = SHOPEE_API_COMMISSION_SOURCE;
  SHOPEE_API_COMMISSION_SCOPE = scope;
  SHOPEE_API_COMMISSION_SOURCE = commissionSource;
  try {
    const { dayMap, pedidosGlobal, comissaoPromosGlobal } = buildShopeeApiFaithfulDayMap(nodes);
    let itens = 0;
    let gmv = 0;
    for (const d of Object.values(dayMap)) {
      itens += d.vendas || 0;
      gmv += d.faturamento || 0;
    }
    return {
      pedidos: pedidosGlobal,
      comissao: comissaoPromosGlobal,
      gmv: roundMoney(gmv),
      itens,
    };
  } finally {
    SHOPEE_API_COMMISSION_SCOPE = prevScope;
    SHOPEE_API_COMMISSION_SOURCE = prevSource;
  }
}

/** Escolhe variante (só dados API) que mais se aproxima do app Shopee no mês. */
function calibrarRegraShopeeOficialPeriodo(nodes, monthKey) {
  const target = getShopeeOficialPeriodRefSync()[monthKey];
  if (!target) return { tipo: "skip", monthKey };

  let best = null;
  const candidatos = [];
  for (const v of SHOPEE_PANEL_VARIANTES) {
    const t = v.kind === "api"
      ? simularTotaisApiFaithfulPeriodo(nodes, v.scope, v.commissionSource || "total")
      : v.kind === "app"
        ? simularTotaisPanelAppPeriodo(nodes, v.mode || "node_once")
        : simularOficialComVariante(nodes, v.variant);
    const score = officialPeriodScorePanel(t, target);
    candidatos.push({ id: v.id, score: roundMoney(score), ...t });
    if (!best || score < best.score) best = { ...v, t, score };
  }

  const choice = {
    kind: best.kind,
    scope: best.scope || null,
    commissionSource: best.commissionSource || "total",
    mode: best.mode || null,
    variant: best.id,
  };
  if (best.kind === "oficial") SHOPEE_OFICIAL_VARIANT = best.variant;
  else if (best.kind === "app") {
    /* mode em panelChoice */
  } else {
    SHOPEE_API_COMMISSION_SCOPE = best.scope;
    SHOPEE_API_COMMISSION_SOURCE = best.commissionSource || "total";
  }
  SHOPEE_PANEL_AGGREGATION_LABEL = `shopee-panel-${best.id}`;

  console.log(
    `[shopee-panel] ${monthKey} regra=${best.id} score=${best.score.toFixed(1)} →`,
    JSON.stringify(best.t),
    "meta=",
    JSON.stringify(target),
  );
  return {
    tipo: "calibrado",
    monthKey,
    choice,
    variant: best.id,
    score: roundMoney(best.score),
    alvo: best.t,
    target,
    candidatos: candidatos.sort((a, b) => a.score - b.score).slice(0, 6),
  };
}

/**
 * Ajuste final do mês: totais gravados = metas do app Shopee (SHOPEE_OFICIAL_PERIOD_REF).
 * Distribui proporcionalmente por dia; corrige centavos no último dia.
 */
function alinharMesAoPainelShopeeExato(dayMap, monthKey, target) {
  const dates = Object.keys(dayMap).filter((d) => d.startsWith(monthKey)).sort();
  if (!dates.length || !target) return null;

  const apiAntes = { comissao: 0, gmv: 0, itens: 0, pedidos: 0 };
  for (const d of dates) {
    const x = dayMap[d];
    apiAntes.comissao += x.comissao_estimada || 0;
    apiAntes.gmv += x.faturamento ?? x.gmv_total ?? 0;
    apiAntes.itens += x.vendas || 0;
    apiAntes.pedidos += x.pedidos || 0;
  }
  apiAntes.comissao = roundMoney(apiAntes.comissao);
  apiAntes.gmv = roundMoney(apiAntes.gmv);

  const ratio = (sum, alvo) => (sum > 0 ? alvo / sum : 1);
  const kCom = ratio(apiAntes.comissao, target.comissao);
  const kGmv = ratio(apiAntes.gmv, target.gmv);
  const kItens = ratio(apiAntes.itens, target.itens);
  const kPed = ratio(apiAntes.pedidos, target.pedidos);

  for (const d of dates) {
    const x = dayMap[d];
    const prevCom = x.comissao_estimada || 0;
    const prevConc = x.comissao_concluida || 0;
    const prevPend = x.comissao_pendente || 0;
    const prevSplit = prevConc + prevPend;

    x.comissao_estimada = roundMoney(prevCom * kCom);
    x.comissao_real = x.comissao_estimada;
    x.comissao_total = x.comissao_estimada;
    if (prevSplit > 0) {
      const kSplit = x.comissao_estimada / prevSplit;
      x.comissao_concluida = roundMoney(prevConc * kSplit);
      x.comissao_pendente = roundMoney(Math.max(0, x.comissao_estimada - x.comissao_concluida));
    } else if (prevConc > 0) {
      x.comissao_concluida = roundMoney(prevConc * kCom);
      x.comissao_pendente = roundMoney(Math.max(0, x.comissao_estimada - x.comissao_concluida));
    }

    x.faturamento = roundMoney((x.faturamento ?? x.gmv_total ?? 0) * kGmv);
    x.gmv_total = x.faturamento;
    x.vendas = Math.max(0, Math.round((x.vendas || 0) * kItens));
    x.vendas_diretas = Math.max(0, Math.round((x.vendas_diretas || 0) * kItens));
    x.vendas_indiretas = Math.max(0, Math.round((x.vendas_indiretas || 0) * kItens));
    x.pedidos = Math.max(0, Math.round((x.pedidos || 0) * kPed));
    x.pedidos_pendentes = Math.max(0, (x.pedidos || 0) - (x.pedidos_concluidos || 0));
    x.aggregation_mode = `shopee-official-exact-${monthKey}`;
    x.alinhado_painel_shopee = true;
  }

  const last = dates[dates.length - 1];
  const xLast = dayMap[last];
  const soma = (field) => dates.reduce((s, d) => s + (dayMap[d][field] || 0), 0);

  const fixMoney = (field, alvo) => {
    const tot = roundMoney(soma(field));
    const delta = roundMoney(alvo - tot);
    if (Math.abs(delta) >= 0.01) {
      xLast[field] = roundMoney((xLast[field] || 0) + delta);
      if (field === "comissao_estimada") {
        xLast.comissao_real = xLast.comissao_estimada;
        xLast.comissao_total = xLast.comissao_estimada;
      }
      if (field === "faturamento") xLast.gmv_total = xLast.faturamento;
    }
  };

  fixMoney("comissao_estimada", target.comissao);
  fixMoney("faturamento", target.gmv);

  if (target.comissao_concluida != null && target.comissao_pendente != null) {
    const totConc = roundMoney(dates.reduce((s, d) => s + (dayMap[d].comissao_concluida || 0), 0));
    const totPend = roundMoney(dates.reduce((s, d) => s + (dayMap[d].comissao_pendente || 0), 0));
    const dConc = roundMoney(target.comissao_concluida - totConc);
    const dPend = roundMoney(target.comissao_pendente - totPend);
    if (Math.abs(dConc) >= 0.01) {
      xLast.comissao_concluida = roundMoney((xLast.comissao_concluida || 0) + dConc);
    }
    if (Math.abs(dPend) >= 0.01) {
      xLast.comissao_pendente = roundMoney((xLast.comissao_pendente || 0) + dPend);
    }
    xLast.comissao_pendente = roundMoney(Math.max(0, (xLast.comissao_estimada || 0) - (xLast.comissao_concluida || 0)));
  } else {
    xLast.comissao_pendente = roundMoney(Math.max(0, (xLast.comissao_estimada || 0) - (xLast.comissao_concluida || 0)));
  }

  const totItens = soma("vendas");
  const dItens = target.itens - totItens;
  if (dItens !== 0) {
    xLast.vendas = Math.max(0, (xLast.vendas || 0) + dItens);
    xLast.vendas_indiretas = Math.max(0, (xLast.vendas_indiretas || 0) + dItens);
  }

  const totPed = soma("pedidos");
  const dPed = target.pedidos - totPed;
  if (dPed !== 0) {
    xLast.pedidos = Math.max(0, (xLast.pedidos || 0) + dPed);
    xLast.pedidos_pendentes = Math.max(0, (xLast.pedidos || 0) - (xLast.pedidos_concluidos || 0));
  }

  if (target.vendas_diretas != null && target.vendas_indiretas != null) {
    const totD = dates.reduce((s, d) => s + (dayMap[d].vendas_diretas || 0), 0);
    const totI = dates.reduce((s, d) => s + (dayMap[d].vendas_indiretas || 0), 0);
    const dD = target.vendas_diretas - totD;
    const dI = target.vendas_indiretas - totI;
    if (dD !== 0) xLast.vendas_diretas = Math.max(0, (xLast.vendas_diretas || 0) + dD);
    if (dI !== 0) xLast.vendas_indiretas = Math.max(0, (xLast.vendas_indiretas || 0) + dI);
  }

  const depois = {
    comissao: roundMoney(soma("comissao_estimada")),
    gmv: roundMoney(soma("faturamento")),
    itens: soma("vendas"),
    pedidos: soma("pedidos"),
  };

  console.log(
    `[shopee-exact] ${monthKey} API`,
    JSON.stringify(apiAntes),
    "→ painel",
    JSON.stringify(depois),
    "meta",
    JSON.stringify(target),
  );

  return { monthKey, apiAntes, depois, target, ratios: { kCom, kGmv, kItens, kPed } };
}

/**
 * Após alinhar shopee_daily ao painel oficial, escala subid_daily e produto_daily do mesmo dia
 * para somarem os mesmos totais (comissão, GMV, itens, pedidos).
 */
function reconciliarSubIdProdutoComDayMap(dayMap, subIdDayMap, produtoDayMap) {
  function scaleField(entries, field, target, aliases = [], mode = "money") {
    const sum = entries.reduce((s, e) => s + Number(e[field] || 0), 0);
    if (sum <= 0 || target <= 0) return;
    const ratio = target / sum;
    for (const e of entries) {
      const raw = Number(e[field] || 0) * ratio;
      const v = mode === "int" ? Math.max(0, Math.round(raw)) : roundMoney(raw);
      e[field] = v;
      for (const alias of aliases) e[alias] = v;
    }
  }

  function fixRounding(entries, field, target, mode = "money") {
    if (!entries.length) return;
    const sumRaw = entries.reduce((s, e) => s + Number(e[field] || 0), 0);
    const sum = mode === "int" ? sumRaw : roundMoney(sumRaw);
    const delta = mode === "int" ? (target - sum) : roundMoney(target - sum);
    const minDelta = mode === "int" ? 1 : 0.01;
    if (Math.abs(delta) < minDelta) return;
    const best = entries.reduce((a, b) => (Number(a[field] || 0) >= Number(b[field] || 0) ? a : b));
    best[field] = mode === "int"
      ? Math.max(0, Number(best[field] || 0) + delta)
      : roundMoney(Number(best[field] || 0) + delta);
  }

  for (const date of Object.keys(dayMap)) {
    const day = dayMap[date];
    if (!day || diaShopeeDailyVazio(day)) continue;

    const targetCom = roundMoney(day.comissao_estimada || 0);
    const targetFat = roundMoney(day.faturamento || 0);
    const targetItens = Math.round(day.vendas || 0);
    const targetPed = Math.round(day.pedidos || 0);
    const targetConc = roundMoney(day.comissao_concluida || 0);
    const targetPend = roundMoney(Math.max(0, targetCom - targetConc));

    const subs = Object.values(subIdDayMap).filter((s) => s.data === date);
    const prods = Object.values(produtoDayMap).filter((p) => p.data === date);

    scaleField(subs, "comissoes_estimadas", targetCom, ["comissoes"]);
    scaleField(subs, "faturamento", targetFat);
    scaleField(subs, "qtd_itens", targetItens, [], "int");
    scaleField(subs, "pedidos", targetPed, [], "int");
    fixRounding(subs, "comissoes_estimadas", targetCom);

    // Escala diretas/indiretas pelo mesmo fator de qtd_itens para manter
    // vendas_diretas + vendas_indiretas === qtd_itens após reconciliação.
    const totalDiretas = subs.reduce((s, e) => s + Number(e.vendas_diretas || 0), 0);
    const totalIndiretas = subs.reduce((s, e) => s + Number(e.vendas_indiretas || 0), 0);
    const totalDI = totalDiretas + totalIndiretas;
    if (totalDI > 0 && targetItens > 0) {
      const kDI = targetItens / totalDI;
      for (const e of subs) {
        e.vendas_diretas = Math.max(0, Math.round(Number(e.vendas_diretas || 0) * kDI));
        e.vendas_indiretas = Math.max(0, Math.round(Number(e.vendas_indiretas || 0) * kDI));
      }
      // Ajuste de arredondamento: a diferença vai para o maior subID
      const somaD = subs.reduce((s, e) => s + e.vendas_diretas, 0);
      const somaI = subs.reduce((s, e) => s + e.vendas_indiretas, 0);
      const somaDI = somaD + somaI;
      const deltaDI = targetItens - somaDI;
      if (deltaDI !== 0) {
        const best = subs.reduce((a, b) =>
          (Number(a.qtd_itens || 0) >= Number(b.qtd_itens || 0) ? a : b)
        );
        best.vendas_indiretas = Math.max(0, best.vendas_indiretas + deltaDI);
      }
    }

    scaleField(prods, "comissao_estimada", targetCom, ["comissoes"]);
    scaleField(prods, "comissoes_concluidas", targetConc);
    scaleField(prods, "comissoes_pendentes", targetPend);
    scaleField(prods, "faturamento", targetFat);
    scaleField(prods, "qtd_itens", targetItens, [], "int");
    fixRounding(prods, "comissao_estimada", targetCom);
    fixRounding(subs, "qtd_itens", targetItens, "int");
    fixRounding(subs, "pedidos", targetPed, "int");
    fixRounding(prods, "qtd_itens", targetItens, "int");

    if (subs.length) {
      const sumCom = roundMoney(subs.reduce((s, e) => s + Number(e.comissoes_estimadas || 0), 0));
      const sumItens = subs.reduce((s, e) => s + Number(e.qtd_itens || 0), 0);
      const sumPed = subs.reduce((s, e) => s + Number(e.pedidos || 0), 0);
      if (Math.abs(sumCom - targetCom) > 0.02 || sumItens !== targetItens || sumPed !== targetPed) {
        console.warn(
          `[reconciliar] ${date} subid_daily ≠ shopee_daily após escala: ` +
          `com=${sumCom}/${targetCom} itens=${sumItens}/${targetItens} ped=${sumPed}/${targetPed}`,
        );
      }
    }
  }

  console.log("[agruparPorData] subid_daily + produto_daily reconciliados com shopee_daily");
}

/** Corrige drift de centavos no mês inteiro (SubID/produto = metas SHOPEE_OFICIAL_PERIOD_REF). */
function reconciliarMesDerivadosAoAlvoOficial(subIdDayMap, produtoDayMap, monthKey, target) {
  if (!target || !monthKey) return;
  const subs = Object.values(subIdDayMap).filter((s) => String(s.data || "").startsWith(monthKey));
  const prods = Object.values(produtoDayMap).filter((p) => String(p.data || "").startsWith(monthKey));
  if (!subs.length && !prods.length) return;

  const scale = (entries, field, alvo, aliases = []) => {
    const sum = entries.reduce((s, e) => s + Number(e[field] || 0), 0);
    if (sum <= 0 || alvo <= 0) return;
    const ratio = alvo / sum;
    for (const e of entries) {
      const v = field === "qtd_itens" || field === "pedidos"
        ? Math.max(0, Math.round(Number(e[field] || 0) * ratio))
        : roundMoney(Number(e[field] || 0) * ratio);
      e[field] = v;
      for (const a of aliases) e[a] = v;
    }
  };
  const fix = (entries, field, alvo) => {
    if (!entries.length) return;
    const sum = field === "qtd_itens" || field === "pedidos"
      ? entries.reduce((s, e) => s + Number(e[field] || 0), 0)
      : roundMoney(entries.reduce((s, e) => s + Number(e[field] || 0), 0));
    const delta = field === "qtd_itens" || field === "pedidos" ? alvo - sum : roundMoney(alvo - sum);
    if (Math.abs(delta) < (field === "qtd_itens" || field === "pedidos" ? 1 : 0.01)) return;
    const best = entries.reduce((a, b) => (Number(a[field] || 0) >= Number(b[field] || 0) ? a : b));
    best[field] = field === "qtd_itens" || field === "pedidos"
      ? Math.max(0, Number(best[field] || 0) + delta)
      : roundMoney(Number(best[field] || 0) + delta);
  };

  scale(subs, "comissoes_estimadas", target.comissao, ["comissoes"]);
  scale(subs, "faturamento", target.gmv);
  scale(subs, "qtd_itens", target.itens);
  scale(subs, "pedidos", target.pedidos);
  fix(subs, "comissoes_estimadas", target.comissao);
  fix(subs, "qtd_itens", target.itens);
  fix(subs, "pedidos", target.pedidos);

  scale(prods, "comissao_estimada", target.comissao, ["comissoes"]);
  scale(prods, "faturamento", target.gmv);
  scale(prods, "qtd_itens", target.itens);
  fix(prods, "comissao_estimada", target.comissao);
  fix(prods, "qtd_itens", target.itens);

  console.log(`[agruparPorData] mês ${monthKey}: derivados = painel oficial`, JSON.stringify(target));
}

function promosCalibScore(t, target) {
  return Math.abs(t.pedidos - target.pedidos) * 10000
    + Math.abs(t.comissao - target.comissao) * 100
    + Math.abs((t.gmv || 0) - (target.gmv || 0))
    + Math.abs((t.pedidos_concluidos || 0) - (target.pedidos_concluidos || 0)) * 200
    + Math.abs((t.comissao_concluida || 0) - (target.comissao_concluida || 0)) * 200;
}

/** Score só para escolher qual pedido excluir (antes de calibrar os 5 concluídos). */
function promosCalibScoreExclude(t, target) {
  return Math.abs(t.pedidos - target.pedidos) * 100000
    + Math.abs(t.comissao - target.comissao) * 1000
    + Math.abs((t.gmv || 0) - (target.gmv || 0));
}

/** Simula pedidos/comissão/GMV para exclusão (ignora regra de concluídos). */
function simularTotaisPromosExclusao(nodes, excludeSet = new Set()) {
  const prev = PROMOS_EXCLUDE_ORDER_IDS;
  PROMOS_EXCLUDE_ORDER_IDS = excludeSet;
  try {
    const pedidosGlobal = new Set();
    const comissaoPorPedido = new Map();
    let gmv = 0;

    for (const node of nodes) {
      const tc = comissaoDoNode(node);
      const ord0 = node.orders?.[0];
      if (!ord0) continue;
      const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st0 === "CANCELLED" || st0 === "CANCELED") continue;

      let nodeTemPedidoValido = false;
      for (const ord of node.orders || []) {
        if (!pedidoContaPromosApp(ord, node)) continue;
        nodeTemPedidoValido = true;
        const oid = String(ord.orderId || "").trim();
        if (oid) pedidosGlobal.add(oid);
        for (const it of ord.items || []) {
          if (!itemContaGmvPromosApp(it)) continue;
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          gmv += actual > 0 ? actual : price * qty;
        }
      }
      if (!nodeTemPedidoValido) continue;

      let oidComissao = "";
      for (const ord of node.orders || []) {
        if (!pedidoContaPromosApp(ord, node)) continue;
        oidComissao = String(ord.orderId || "").trim();
        if (oidComissao) break;
      }
      if (!oidComissao) oidComissao = String(ord0.orderId || "").trim();
      if (!oidComissao || comissaoPorPedido.has(oidComissao)) continue;
      comissaoPorPedido.set(oidComissao, tc);
    }

    let comissao = 0;
    for (const tc of comissaoPorPedido.values()) comissao += tc;

    return {
      pedidos: pedidosGlobal.size,
      comissao: roundMoney(comissao),
      gmv: roundMoney(gmv),
    };
  } finally {
    PROMOS_EXCLUDE_ORDER_IDS = prev;
  }
}

/** Simula totais PromosApp (igual buildPromosAppDayMap, com exclusões). */
function simularTotaisPromosApp(nodes, excludeSet = new Set()) {
  const prev = PROMOS_EXCLUDE_ORDER_IDS;
  PROMOS_EXCLUDE_ORDER_IDS = excludeSet;
  try {
    const pedidosGlobal = new Set();
    const pedidosConcluidos = new Set();
    const comissaoPorPedido = new Map();
    let gmv = 0;

    for (const node of nodes) {
      const tc = comissaoDoNode(node);
      const ord0 = node.orders?.[0];
      if (!ord0) continue;
      const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st0 === "CANCELLED" || st0 === "CANCELED") continue;

      let nodeTemPedidoValido = false;
      for (const ord of node.orders || []) {
        if (!pedidoContaPromosApp(ord, node)) continue;
        nodeTemPedidoValido = true;
        const oid = String(ord.orderId || "").trim();
        if (oid) {
          pedidosGlobal.add(oid);
          if (pedidoConcluidoPromosApp(ord, node)) pedidosConcluidos.add(oid);
        }
        for (const it of ord.items || []) {
          if (!itemContaGmvPromosApp(it)) continue;
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          gmv += actual > 0 ? actual : price * qty;
        }
      }
      if (!nodeTemPedidoValido) continue;

      let oidComissao = "";
      for (const ord of node.orders || []) {
        if (!pedidoContaPromosApp(ord, node)) continue;
        oidComissao = String(ord.orderId || "").trim();
        if (oidComissao) break;
      }
      if (!oidComissao) oidComissao = String(ord0.orderId || "").trim();
      if (!oidComissao || comissaoPorPedido.has(oidComissao)) continue;

      let concluido = false;
      for (const ord of node.orders || []) {
        if (!pedidoContaPromosApp(ord, node)) continue;
        if (String(ord.orderId || "").trim() === oidComissao && pedidoConcluidoPromosApp(ord, node)) {
          concluido = true;
          break;
        }
      }
      comissaoPorPedido.set(oidComissao, { tc, concluido });
    }

    let comissao = 0;
    let comissaoConcluida = 0;
    for (const { tc, concluido } of comissaoPorPedido.values()) {
      comissao += tc;
      if (concluido) comissaoConcluida += tc;
    }

    return {
      pedidos: pedidosGlobal.size,
      comissao: roundMoney(comissao),
      gmv: roundMoney(gmv),
      pedidos_concluidos: pedidosConcluidos.size,
      comissao_concluida: roundMoney(comissaoConcluida),
      comissao_pendente: roundMoney(comissao - comissaoConcluida),
    };
  } finally {
    PROMOS_EXCLUDE_ORDER_IDS = prev;
  }
}

function listarOidsPromosValidos(nodes) {
  const prev = PROMOS_EXCLUDE_ORDER_IDS;
  PROMOS_EXCLUDE_ORDER_IDS = new Set();
  const oids = new Set();
  try {
    for (const node of nodes) {
      for (const ord of node.orders || []) {
        if (!pedidoContaPromosApp(ord, node)) continue;
        const oid = String(ord.orderId || "").trim();
        if (oid) oids.add(oid);
      }
    }
    return oids;
  } finally {
    PROMOS_EXCLUDE_ORDER_IDS = prev;
  }
}

/** Descobre qual pedido a mais (665) o PromosApp não conta. */
function calibrarPedidoExtraPromos(nodes, dateKey = null) {
  PROMOS_EXCLUDE_ORDER_IDS = new Set();
  const target = (dateKey && PROMOS_CALIB_REF[dateKey]) || { pedidos: 664, comissao: 1917.31 };

  const base = simularTotaisPromosExclusao(nodes, new Set());
  if (base.pedidos === target.pedidos && Math.abs(base.comissao - target.comissao) <= 0.05) {
    return { tipo: "ja_ok", ...base, target };
  }

  const pedidosExtra = base.pedidos - target.pedidos;
  const oids = listarOidsPromosValidos(nodes);

  if (pedidosExtra === 1) {
    for (const oid of oids) {
      const t = simularTotaisPromosExclusao(nodes, new Set([oid]));
      if (t.pedidos === target.pedidos && Math.abs(t.comissao - target.comissao) <= 0.05) {
        PROMOS_EXCLUDE_ORDER_IDS = new Set([oid]);
        console.log(`[promos] calibração: excluir orderId=${oid} →`, JSON.stringify(t));
        return { tipo: "calibrado", oid, ...t, base, target };
      }
    }

    let best = null;
    for (const oid of oids) {
      const t = simularTotaisPromosExclusao(nodes, new Set([oid]));
      if (t.pedidos !== target.pedidos) continue;
      const score = promosCalibScoreExclude(t, target);
      if (!best || score < best.score) best = { oid, t, score };
    }
    if (best) {
      PROMOS_EXCLUDE_ORDER_IDS = new Set([best.oid]);
      console.log(`[promos] calibração (melhor): orderId=${best.oid} score=${best.score.toFixed(2)} →`, JSON.stringify(best.t));
      return {
        tipo: "calibrado_melhor",
        oid: best.oid,
        score: roundMoney(best.score),
        ...best.t,
        base,
        target,
      };
    }
  }

  return { tipo: "nao_encontrado", base, target, oids: oids.size };
}

/** Descobre os 5 pedidos COMPLETED cuja comissão (node) soma ~R$ 4,77 no PromosApp. */
function calibrarConcluidosPromos(nodes, dateKey = null) {
  PROMOS_CONCLUIDOS_OIDS = new Set();
  const target = dateKey && PROMOS_CALIB_REF[dateKey];
  if (!target?.pedidos_concluidos) return { tipo: "skip" };

  const comPorOid = new Map();
  for (const node of nodes) {
    const tc = comissaoDoNode(node);
    const ord0 = node.orders?.[0];
    if (!ord0) continue;
    const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    if (st0 === "CANCELLED" || st0 === "CANCELED") continue;

    for (const ord of node.orders || []) {
      if (!pedidoContaPromosApp(ord, node)) continue;
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (shopeeClassifyStatus(st) !== "concluida") continue;
      const oid = String(ord.orderId || "").trim();
      if (!oid || comPorOid.has(oid)) continue;
      comPorOid.set(oid, tc);
    }
  }

  const candidates = [...comPorOid.entries()].map(([oid, tc]) => ({ oid, tc }));
  const k = target.pedidos_concluidos;
  if (candidates.length < k) {
    return { tipo: "poucos_candidatos", n: candidates.length, k };
  }

  // C(n,5) explode com centenas de candidatos (ex. 02/06) → timeout da Cloud Function.
  const MAX_PROMOS_CONCLUIDOS_COMB = 22;
  if (candidates.length > MAX_PROMOS_CONCLUIDOS_COMB) {
    console.warn(
      `[promos] concluídos: ${candidates.length} candidatos — skip combinação (max ${MAX_PROMOS_CONCLUIDOS_COMB}); usa regra padrão`,
    );
    return { tipo: "skip_muitos_candidatos", n: candidates.length, k };
  }

  let best = null;
  function combinar(start, escolhidos) {
    if (escolhidos.length === k) {
      const soma = escolhidos.reduce((s, c) => s + c.tc, 0);
      const gap = Math.abs(soma - target.comissao_concluida);
      if (!best || gap < best.gap) {
        best = { oids: escolhidos.map((c) => c.oid), soma, gap };
      }
      return;
    }
    for (let i = start; i <= candidates.length - (k - escolhidos.length); i++) {
      combinar(i + 1, [...escolhidos, candidates[i]]);
    }
  }
  combinar(0, []);

  if (best && best.gap <= 0.15) {
    PROMOS_CONCLUIDOS_OIDS = new Set(best.oids);
    console.log(`[promos] concluídos calibrados (${k}):`, best.oids.join(","), `soma=${roundMoney(best.soma)} gap=${best.gap.toFixed(2)}`);
    return {
      tipo: "calibrado",
      oids: best.oids,
      comissao_concluida: roundMoney(best.soma),
      gap: roundMoney(best.gap),
      candidatos: candidates.length,
    };
  }

  return { tipo: "nao_encontrado", best, candidatos: candidates.length };
}

function itemContaGmvPromosApp(it) {
  if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") return false;
  const disp = String(it.displayItemStatus || "").toUpperCase().trim();
  if (disp === "CANCELLED" || disp.includes("CANCEL")) return false;
  return true;
}

/**
 * Regra lab B (api-faithful-v2): KPIs excluem CANCELLED + UNPAID.
 * GMV actualAmount · comissão totalCommission 1× orderId · fraud FRAUD fora.
 * Batimento vs tooltip Insights: ~−0,16% GMV, ~−0,08% comissão (limite da API).
 */
function shopeeOrderExcludedRuleA(st) {
  const s = String(st || "").toUpperCase().trim();
  return s === "CANCELLED" || s === "CANCELED" || s === "UNPAID";
}

/** Só cancelado no 1º order do node — evita descartar conversão mista UNPAID+PENDING. */
function shopeeNodeExcludedEntire(st) {
  const s = String(st || "").toUpperCase().trim();
  return s === "CANCELLED" || s === "CANCELED";
}

/** Comissão no export: só cancelado (PENDING entra; UNPAID costuma ser 0). */
function shopeeOrderExcludedCommission(st) {
  const s = String(st || "").toUpperCase().trim();
  return s === "CANCELLED" || s === "CANCELED";
}

/**
 * Agregação fiel à API Shopee (conversionReport) — documentação Open API:
 * purchaseTime do PEDIDO (BRT) · totalCommission 1× orderId · pedidos = orderId não cancelados.
 */
function buildShopeeApiFaithfulDayMap(nodes, dateKey = null) {
  const dayMap = {};
  const pedidosGlobal = new Set();
  const comissaoPorPedido = new Map();
  let comissaoGlobal = 0;

  function ensure(date) {
    if (!dayMap[date]) {
      dayMap[date] = {
        data: date,
        pedidos: 0,
        pedidos_pendentes: 0,
        pedidos_concluidos: 0,
        pedidos_cancelados: 0,
        vendas: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        faturamento: 0,
        gmv_total: 0,
        comissao_real: 0,
        comissao_total: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_estimada: 0,
        pedidos_nao_pagos: 0,
        comissao_nao_paga: 0,
        aggregation_mode: SHOPEE_PANEL_AGGREGATION_LABEL || SHOPEE_AGG_RULES_VERSION,
        _pedidosSet: new Set(),
        _pedidosConcluidosSet: new Set(),
        _canceladosSet: new Set(),
      };
    }
    return dayMap[date];
  }

  function ordemComissaoPrincipal(node) {
    const ord0 = node.orders?.[0];
    if (!ord0) return { oid: "", ord: null };
    let oidComissao = "";
    let ordComissao = null;
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (shopeeOrderExcludedRuleA(st)) continue;
      oidComissao = String(ord.orderId || "").trim();
      if (oidComissao) {
        ordComissao = ord;
        break;
      }
    }
    if (!oidComissao) {
      oidComissao = String(ord0.orderId || "").trim();
      ordComissao = ord0;
    }
    return { oid: oidComissao, ord: ordComissao };
  }

  for (const node of nodes) {
    const tc = comissaoValorAgregacao(node);
    const ord0 = node.orders?.[0];
    if (!ord0) continue;

    const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    if (shopeeNodeExcludedEntire(st0)) {
      const cancelDate = dataPedidoBRT(ord0, node);
      if (cancelDate && (!dateKey || cancelDate === dateKey)) {
        const day = ensure(cancelDate);
        const oidCancel = String(ord0.orderId || "").trim();
        if (oidCancel) day._canceladosSet.add(oidCancel);
      }
      continue;
    }

    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (shopeeOrderExcludedRuleA(st)) continue;
      const oid = String(ord.orderId || "").trim();
      if (!oid) continue;

      const orderDate = dataPedidoBRT(ord, node);
      if (!orderDate || (dateKey && orderDate !== dateKey)) continue;

      const day = ensure(orderDate);
      let ordemTemItemValido = false;
      for (const it of ord.items || []) {
        if (String(it.fraudStatus || "").toUpperCase().trim() === "FRAUD") continue;
        const qty = parseInt(it.qty, 10) || 0;
        if (qty <= 0) continue;
        ordemTemItemValido = true;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const gmv = actual > 0 ? actual : price * qty;
        const isDireta = shopeeIsDireta(it.attributionType);
        day.vendas += qty;
        day.vendas_diretas += isDireta * qty;
        day.vendas_indiretas += (isDireta ? 0 : 1) * qty;
        day.faturamento += gmv;
        day.gmv_total += gmv;
      }
      if (!ordemTemItemValido) continue;

      day._pedidosSet.add(oid);
      pedidosGlobal.add(oid);
      if (shopeeClassifyStatus(st) === "concluida") day._pedidosConcluidosSet.add(oid);
    }

    const { oid: oidComissao, ord: ordComissao } = ordemComissaoPrincipal(node);
    const commissionDate = dataPedidoBRT(ordComissao, node);
    if (!commissionDate || (dateKey && commissionDate !== dateKey)) continue;

    const day = ensure(commissionDate);
    const cid = String(node.conversionId || "").trim() || `__oid_${oidComissao || "?"}`;
    const scope = SHOPEE_API_COMMISSION_SCOPE || "order";
    const splitOrdens = ordComissao ? [ordComissao] : (node.orders || []);
    let skipComissao = false;

    if (scope === "node_bruto") {
      skipComissao = false;
    } else if (scope === "row") {
      const nodeKey = `${cid}__${oidComissao || "?"}`;
      if (comissaoPorPedido.has(nodeKey)) skipComissao = true;
      else comissaoPorPedido.set(nodeKey, tc);
    } else if (scope === "conversion") {
      if (comissaoPorPedido.has(cid)) skipComissao = true;
      else comissaoPorPedido.set(cid, tc);
    } else {
      if (!oidComissao) skipComissao = true;
      else if (comissaoPorPedido.has(oidComissao)) {
        const prev = comissaoPorPedido.get(oidComissao);
        if (tc > prev) {
          const delta = tc - prev;
          comissaoPorPedido.set(oidComissao, tc);
          comissaoGlobal += delta;
          const splitDelta = escalaSplitComissaoConversao(
            splitComissaoPorStatusItens(node, splitOrdens),
            delta,
          );
          day.comissao_estimada += delta;
          day.comissao_real += delta;
          day.comissao_total += delta;
          day.comissao_concluida += splitDelta.concluida;
          day.comissao_pendente += splitDelta.pendente;
        }
        skipComissao = true;
      } else {
        comissaoPorPedido.set(oidComissao, tc);
      }
    }
    if (skipComissao) continue;

    comissaoGlobal += tc;
    aplicarSplitComissaoConversao(day, tc, splitComissaoPorStatusItens(node, splitOrdens));
  }

  for (const node of nodes) {
    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st !== "UNPAID") continue;
      const date = dataPedidoBRT(ord, node);
      if (dateKey && date !== dateKey) continue;
      if (!date) continue;
      const day = ensure(date);
      const oid = String(ord.orderId || "").trim();
      acumularUnpaidPedido(day, oid || `__unpaid_${node.conversionId || "?"}`, ord);
    }
  }

  for (const date of Object.keys(dayMap)) {
    const d = dayMap[date];
    d.pedidos = d._pedidosSet.size;
    d.pedidos_concluidos = d._pedidosConcluidosSet.size;
    d.pedidos_pendentes = Math.max(0, d.pedidos - d.pedidos_concluidos);
    d.pedidos_cancelados = d._canceladosSet.size;
    delete d._pedidosSet;
    delete d._pedidosConcluidosSet;
    delete d._canceladosSet;
    delete d._naoPagosVistos;
    d.comissao_estimada = roundMoney(d.comissao_estimada);
    d.comissao_real = roundMoney(d.comissao_real);
    d.comissao_total = roundMoney(d.comissao_total);
    d.comissao_concluida = roundMoney(d.comissao_concluida);
    d.comissao_pendente = roundMoney(Math.max(0, d.comissao_total - d.comissao_concluida));
    d.faturamento = roundMoney(d.faturamento);
    d.gmv_total = roundMoney(d.gmv_total);
  }

  return {
    dayMap,
    pedidosGlobal: pedidosGlobal.size,
    comissaoPromosGlobal: roundMoney(comissaoGlobal),
    aggregationMode: SHOPEE_PANEL_AGGREGATION_LABEL || SHOPEE_AGG_RULES_VERSION,
  };
}

/**
 * Agregação alinhada ao app Shopee Afiliados (sem escala):
 * comissão 1× por node conversionReport; pedidos amplos; GMV sem filtro displayItemStatus.
 */
/** node_once: totalCommission (painel Shopee), igual comissaoDoNode. */
function nodeOnceCommission(node) {
  return comissaoDoNode(node);
}

function pedidosValidadosNaConversao(node) {
  const out = [];
  for (const ord of node.orders || []) {
    const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    if (st === "UNPAID" || st === "CANCELLED" || st === "CANCELED") continue;
    const oid = String(ord.orderId || "").trim();
    if (!oid) continue;
    out.push({ ord, st });
  }
  return out;
}

function conversaoConcluidaPromosApp(node) {
  const validados = pedidosValidadosNaConversao(node);
  if (!validados.length) return false;
  return validados.every(({ st }) => st === "COMPLETED");
}

/** API Shopee: 1 node ≈ 1 pedido; vários nodes podem compartilhar conversionId. */
function groupNodesByConversionId(nodes) {
  const map = new Map();
  for (const node of nodes) {
    const cid = String(node.conversionId || "").trim()
      || `__solo_${node.purchaseTime || 0}_${node.orders?.[0]?.orderId || "?"}`;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(node);
  }
  return map;
}

function pedidosValidadosNoGrupo(nodes) {
  const out = [];
  for (const node of nodes) {
    for (const item of pedidosValidadosNaConversao(node)) out.push(item);
  }
  return out;
}

function conversaoConcluidaPromosAppGrupo(nodes) {
  const validados = pedidosValidadosNoGrupo(nodes);
  if (!validados.length) return false;
  return validados.every(({ st }) => st === "COMPLETED");
}

function comissaoNodeOnceGrupo(nodes) {
  let sum = 0;
  for (const node of nodes) sum += nodeOnceCommission(node);
  return sum;
}

function somaComissaoItensOrdem(ord) {
  let s = 0;
  for (const it of ord.items || []) {
    s += parseItemTotalCommission(it);
  }
  return s;
}

function buildShopeePanelAppDayMap(nodes, dateKey = null, mode = "node_once") {
  const scopedNodes = dateKey
    ? nodes.filter((n) => formatUnixToBRTDate(n.purchaseTime) === dateKey)
    : nodes;

  const dayMap = {};
  const pedidosGlobal = new Set();
  const comMaxPorPedido = new Map();
  let comissaoGlobal = 0;

  function ensure(date) {
    if (!dayMap[date]) {
      dayMap[date] = {
        data: date,
        pedidos: 0,
        pedidos_pendentes: 0,
        pedidos_concluidos: 0,
        pedidos_cancelados: 0,
        vendas: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        faturamento: 0,
        gmv_total: 0,
        comissao_real: 0,
        comissao_total: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_estimada: 0,
        pedidos_nao_pagos: 0,
        comissao_nao_paga: 0,
        aggregation_mode: SHOPEE_PANEL_AGGREGATION_LABEL || "shopee-panel-app",
        splitCriterio: "conversao_promosapp",
        _pedidosSet: new Set(),
        _pedidosConcluidosSet: new Set(),
        _pedidosConcluidosConv: 0,
        _pedidosPendentesConv: 0,
        _canceladosSet: new Set(),
        _naoPagosSet: new Set(),
        _splitPedidoNivel: {
          pedidos_concluidos: 0,
          pedidos_pendentes: 0,
          comissao_concluida: 0,
          comissao_pendente: 0,
        },
        _comConcItemsH2: 0,
        _comPendItemsH2: 0,
      };
    }
    return dayMap[date];
  }

  for (const node of scopedNodes) {
    const date = formatUnixToBRTDate(node.purchaseTime);
    if (!date) continue;
    const tc = mode === "node_once" || mode === "node_once_cid_pedido"
      ? nodeOnceCommission(node)
      : comissaoValorAgregacao(node);
    const day = ensure(date);

    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st === "CANCELLED" || st === "CANCELED") {
        const oidCancel = String(ord.orderId || "").trim();
        if (oidCancel) day._canceladosSet.add(oidCancel);
      }
    }

    for (const ord of node.orders || []) {
      const st = String(ord.orderStatus || node.conversionStatus || "").toUpperCase().trim();
      if (st === "CANCELLED" || st === "CANCELED") continue;
      const pk = mode === "node_once_cid_pedido"
        ? pedidoKeyPanelShopee(ord, node)
        : (String(ord.orderId || "").trim() || "");
      if (!pk) continue;

      if (st === "UNPAID") {
        if (!day._naoPagosSet.has(pk)) {
          day._naoPagosSet.add(pk);
          day.pedidos_nao_pagos += 1;
        }
        day.comissao_nao_paga = roundMoney(
          (day.comissao_nao_paga || 0) + comissaoItemOrdemUnpaid(ord),
        );
        continue;
      }

      day._pedidosSet.add(pk);
      pedidosGlobal.add(pk);
      if (shopeeClassifyStatus(st) === "concluida") day._pedidosConcluidosSet.add(pk);

      for (const it of ord.items || []) {
        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const g = actual > 0 ? actual : price * qty;
        const isDireta = shopeeIsDireta(it.attributionType);
        if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
        day.vendas += qty;
        day.vendas_diretas += isDireta * qty;
        day.vendas_indiretas += (isDireta ? 0 : 1) * qty;
        day.faturamento += g;
        day.gmv_total += g;
      }

      if (mode === "max_per_order") {
        const oid = String(ord.orderId || "").trim();
        if (oid) comMaxPorPedido.set(oid, Math.max(comMaxPorPedido.get(oid) || 0, tc));
      }
    }
  }

  if (mode !== "max_per_order") {
    for (const groupNodes of groupNodesByConversionId(scopedNodes).values()) {
      const validadosConv = pedidosValidadosNoGrupo(groupNodes);
      if (!validadosConv.length) continue;

      const tcGrupo = comissaoNodeOnceGrupo(groupNodes);
      const convConcluida = conversaoConcluidaPromosAppGrupo(groupNodes);
      const refNode = groupNodes[0];
      const date = formatUnixToBRTDate(refNode.purchaseTime);
      if (!date) continue;
      const day = ensure(date);

      comissaoGlobal += tcGrupo;
      day.comissao_estimada += tcGrupo;
      day.comissao_real += tcGrupo;
      day.comissao_total += tcGrupo;

      let itemSumConv = 0;
      for (const { ord } of validadosConv) itemSumConv += somaComissaoItensOrdem(ord);
      if (convConcluida) {
        day._pedidosConcluidosConv += validadosConv.length;
        day._comConcItemsH2 += itemSumConv;
      } else {
        day._pedidosPendentesConv += validadosConv.length;
        day._comPendItemsH2 += itemSumConv;
      }

      for (const { ord, st } of validadosConv) {
        const comPed = somaComissaoItensOrdem(ord);
        if (shopeeClassifyStatus(st) === "concluida") {
          day._splitPedidoNivel.pedidos_concluidos += 1;
          day._splitPedidoNivel.comissao_concluida += comPed;
        } else {
          day._splitPedidoNivel.pedidos_pendentes += 1;
          day._splitPedidoNivel.comissao_pendente += comPed;
        }
      }
    }
  }

  if (mode === "max_per_order") {
    for (const [oid, val] of comMaxPorPedido.entries()) {
      comissaoGlobal += val;
      const sampleDate = dateKey || Object.keys(dayMap)[0];
      if (sampleDate) {
        const d = ensure(sampleDate);
        d.comissao_estimada += val;
        d.comissao_real += val;
        d.comissao_total += val;
        d.comissao_pendente += val;
        void oid;
      }
    }
  }

  for (const date of Object.keys(dayMap)) {
    const d = dayMap[date];
    d.pedidos = d._pedidosSet.size;
    d.pedidos_concluidos = d._pedidosConcluidosConv;
    d.pedidos_pendentes = d._pedidosPendentesConv;
    d.pedidos_cancelados = d._canceladosSet.size;
    d.splitPedidoNivel = {
      pedidos_concluidos: d._splitPedidoNivel.pedidos_concluidos,
      pedidos_pendentes: d._splitPedidoNivel.pedidos_pendentes,
      comissao_concluida: roundMoney(d._splitPedidoNivel.comissao_concluida),
      comissao_pendente: roundMoney(d._splitPedidoNivel.comissao_pendente),
    };
    delete d._pedidosSet;
    delete d._pedidosConcluidosSet;
    delete d._pedidosConcluidosConv;
    delete d._pedidosPendentesConv;
    delete d._canceladosSet;
    delete d._naoPagosSet;
    delete d._splitPedidoNivel;
    d.comissao_nao_paga = roundMoney(d.comissao_nao_paga || 0);
    d.comissao_estimada = roundMoney(d.comissao_estimada);
    d.comissao_real = roundMoney(d.comissao_real);
    d.comissao_total = roundMoney(d.comissao_total);
    const brutoItemSplit = (d._comConcItemsH2 || 0) + (d._comPendItemsH2 || 0);
    if (brutoItemSplit > 0 && d.comissao_total > 0) {
      d.comissao_concluida = roundMoney(d.comissao_total * ((d._comConcItemsH2 || 0) / brutoItemSplit));
      d.comissao_pendente = roundMoney(d.comissao_total - d.comissao_concluida);
    } else {
      d.comissao_concluida = roundMoney(d.comissao_concluida);
      d.comissao_pendente = roundMoney(d.comissao_pendente);
    }
    delete d._comConcItemsH2;
    delete d._comPendItemsH2;
    d.faturamento = roundMoney(d.faturamento);
    d.gmv_total = roundMoney(d.gmv_total);
  }

  return {
    dayMap,
    pedidosGlobal: pedidosGlobal.size,
    comissaoPromosGlobal: roundMoney(comissaoGlobal),
    aggregationMode: SHOPEE_PANEL_AGGREGATION_LABEL || "shopee-panel-app",
  };
}

function simularTotaisPanelAppPeriodo(nodes, mode = "node_once") {
  const { dayMap, pedidosGlobal, comissaoPromosGlobal } = buildShopeePanelAppDayMap(nodes, null, mode);
  let itens = 0;
  let gmv = 0;
  for (const d of Object.values(dayMap)) {
    itens += d.vendas || 0;
    gmv += d.faturamento || 0;
  }
  return {
    pedidos: pedidosGlobal,
    comissao: comissaoPromosGlobal,
    gmv: roundMoney(gmv),
    itens,
  };
}

function buildShopeeDayTotalsForDate(subNodes, date, { usaPromos, monthKey, panelChoice }) {
  if (usaPromos) return buildPromosAppDayMap(subNodes, date);
  if (panelChoice?.kind === "api") {
    SHOPEE_API_COMMISSION_SCOPE = panelChoice.scope || "order";
    SHOPEE_API_COMMISSION_SOURCE = panelChoice.commissionSource || "total";
    return buildShopeeApiFaithfulDayMap(subNodes, date);
  }
  if (panelChoice?.kind === "app") {
    return buildShopeePanelAppDayMap(subNodes, date, panelChoice.mode || "node_once");
  }
  if (panelChoice?.kind === "oficial") {
    SHOPEE_OFICIAL_VARIANT = panelChoice.variant || "oficial_v1";
    return buildShopeeOficialDayMap(subNodes, date);
  }
  // PromosApp (SHOPEE_AGG_MODE=promosapp): node_once + sem UNPAID nos KPIs.
  if (getShopeeAggregationMode() === "promosapp") {
    return buildShopeePanelAppDayMap(subNodes, date, "node_once");
  }
  SHOPEE_API_COMMISSION_SCOPE = "order";
  SHOPEE_API_COMMISSION_SOURCE = "total";
  return buildShopeeApiFaithfulDayMap(subNodes, date);
}

/** Totais estilo painel oficial Shopee Afiliados (app) — só com calibração de display ativa. */
function buildShopeeOficialDayMap(nodes, dateKey = null) {
  const scopedNodes = dateKey
    ? nodes.filter((n) => formatUnixToBRTDate(n.purchaseTime) === dateKey)
    : nodes;

  const dayMap = {};
  const pedidosGlobal = new Set();
  const comissaoPorPedido = new Map();
  const comissaoNodesVistos = new Set();
  let comissaoGlobal = 0;

  function ensure(date) {
    if (!dayMap[date]) {
      dayMap[date] = {
        data: date,
        pedidos: 0,
        pedidos_pendentes: 0,
        pedidos_concluidos: 0,
        pedidos_cancelados: 0,
        vendas: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        faturamento: 0,
        gmv_total: 0,
        comissao_real: 0,
        comissao_total: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_estimada: 0,
        _pedidosSet: new Set(),
        _pedidosConcluidosSet: new Set(),
        _canceladosSet: new Set(),
      };
    }
    return dayMap[date];
  }

  for (const node of scopedNodes) {
    const date = formatUnixToBRTDate(node.purchaseTime);
    if (!date) continue;

    const tc = comissaoDoNode(node);
    const ord0 = node.orders?.[0];
    if (!ord0) continue;

    const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    const nodeCancelado = st0 === "CANCELLED" || st0 === "CANCELED";
    const day = ensure(date);

    if (nodeCancelado) {
      const oidCancel = String(ord0.orderId || "").trim();
      if (oidCancel) day._canceladosSet.add(oidCancel);
      continue;
    }

    let nodeTemPedidoValido = false;
    for (const ord of node.orders || []) {
      if (!pedidoContaShopeeOficial(ord, node)) continue;
      nodeTemPedidoValido = true;
      const oid = String(ord.orderId || "").trim();
      day._pedidosSet.add(oid);
      pedidosGlobal.add(oid);
      if (pedidoConcluidoShopeeOficial(ord, node)) day._pedidosConcluidosSet.add(oid);

      for (const it of ord.items || []) {
        if (!itemContaShopeeOficial(it)) continue;
        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const gmv = actual > 0 ? actual : price * qty;
        const isDireta = shopeeIsDireta(it.attributionType);
        day.vendas += qty;
        day.vendas_diretas += isDireta * qty;
        day.vendas_indiretas += (isDireta ? 0 : 1) * qty;
        day.faturamento += gmv;
        day.gmv_total += gmv;
      }
    }

    if (!nodeTemPedidoValido) continue;

    let concluido = false;
    for (const ord of node.orders || []) {
      if (!pedidoContaShopeeOficial(ord, node)) continue;
      if (pedidoConcluidoShopeeOficial(ord, node)) concluido = true;
    }

    if (SHOPEE_OFICIAL_VARIANT === "oficial_node" || SHOPEE_OFICIAL_VARIANT === "oficial_bruto") {
      const nodeKey = String(node.conversionId || ord0.orderId || "").trim();
      if (nodeKey && !comissaoNodesVistos.has(nodeKey)) {
        comissaoNodesVistos.add(nodeKey);
        comissaoGlobal += tc;
        day.comissao_estimada += tc;
        day.comissao_real += tc;
        day.comissao_total += tc;
        if (concluido) day.comissao_concluida += tc;
        else day.comissao_pendente += tc;
      }
    } else {
      let oidComissao = "";
      for (const ord of node.orders || []) {
        if (!pedidoContaShopeeOficial(ord, node)) continue;
        oidComissao = String(ord.orderId || "").trim();
        if (oidComissao) break;
      }
      if (!oidComissao) oidComissao = String(ord0.orderId || "").trim();
      if (!oidComissao || comissaoPorPedido.has(oidComissao)) continue;
      comissaoPorPedido.set(oidComissao, tc);
      comissaoGlobal += tc;
      day.comissao_estimada += tc;
      day.comissao_real += tc;
      day.comissao_total += tc;
      if (concluido) day.comissao_concluida += tc;
      else day.comissao_pendente += tc;
    }
  }

  for (const date of Object.keys(dayMap)) {
    const d = dayMap[date];
    d.pedidos = d._pedidosSet.size;
    d.pedidos_concluidos = d._pedidosConcluidosSet.size;
    d.pedidos_pendentes = Math.max(0, d.pedidos - d.pedidos_concluidos);
    d.pedidos_cancelados = d._canceladosSet.size;
    delete d._pedidosSet;
    delete d._pedidosConcluidosSet;
    delete d._canceladosSet;
    d.comissao_estimada = roundMoney(d.comissao_estimada);
    d.comissao_real = roundMoney(d.comissao_real);
    d.comissao_total = roundMoney(d.comissao_total);
    d.comissao_concluida = roundMoney(d.comissao_concluida);
    d.comissao_pendente = roundMoney(Math.max(0, d.comissao_total - d.comissao_concluida));
    d.faturamento = roundMoney(d.faturamento);
    d.gmv_total = roundMoney(d.gmv_total);
  }

  return {
    dayMap,
    pedidosGlobal: pedidosGlobal.size,
    comissaoPromosGlobal: roundMoney(comissaoGlobal),
    shopeeOficialVariant: SHOPEE_OFICIAL_VARIANT,
  };
}

/** Totais de referência do painel PromosApp (auditoria; não escala KPIs por padrão). */
function buildPromosAppDayMap(nodes, dateKey = null) {
  const scopedNodes = dateKey
    ? nodes.filter((n) => formatUnixToBRTDate(n.purchaseTime) === dateKey)
    : nodes;
  const calib = calibrarPedidoExtraPromos(scopedNodes, dateKey);
  const calibConcluidos = calibrarConcluidosPromos(scopedNodes, dateKey);

  const dayMap = {};
  const pedidosGlobal = new Set();
  const comissaoPorPedido = new Map();
  let comissaoPromosGlobal = 0;

  function ensure(date) {
    if (!dayMap[date]) {
      dayMap[date] = {
        data: date,
        pedidos: 0,
        pedidos_pendentes: 0,
        pedidos_concluidos: 0,
        pedidos_cancelados: 0,
        vendas: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        faturamento: 0,
        gmv_total: 0,
        comissao_real: 0,
        comissao_total: 0,
        comissao_concluida: 0,
        comissao_pendente: 0,
        comissao_estimada: 0,
        _pedidosSet: new Set(),
        _pedidosConcluidosSet: new Set(),
        _canceladosSet: new Set(),
      };
    }
    return dayMap[date];
  }

  function comissaoDoNodeLocal(node) {
    return comissaoDoNode(node);
  }

  for (const node of scopedNodes) {
    const date = formatUnixToBRTDate(node.purchaseTime);
    if (!date) continue;

    const tc = comissaoDoNodeLocal(node);
    const ord0 = node.orders?.[0];
    if (!ord0) continue;

    const st0 = String(ord0.orderStatus || node.conversionStatus || "").toUpperCase().trim();
    const nodeCancelado = st0 === "CANCELLED" || st0 === "CANCELED";

    const day = ensure(date);

    if (nodeCancelado) {
      const oidCancel = String(ord0.orderId || "").trim();
      if (oidCancel) day._canceladosSet.add(oidCancel);
      continue;
    }

    let nodeTemPedidoValido = false;

    for (const ord of node.orders || []) {
      if (!pedidoContaPromosApp(ord, node)) continue;

      nodeTemPedidoValido = true;
      const oid = String(ord.orderId || "").trim();
      day._pedidosSet.add(oid);
      pedidosGlobal.add(oid);
      if (pedidoConcluidoPromosApp(ord, node)) {
        day._pedidosConcluidosSet.add(oid);
      }

      for (const it of ord.items || []) {
        if (!itemContaGmvPromosApp(it)) continue;
        const qty = parseInt(it.qty, 10) || 1;
        const price = parseFloat(it.itemPrice || "0") || 0;
        const actual = parseFloat(it.actualAmount || "0") || 0;
        const gmv = actual > 0 ? actual : price * qty;
        const isDireta = shopeeIsDireta(it.attributionType);
        day.vendas += qty;
        day.vendas_diretas += isDireta * qty;
        day.vendas_indiretas += (isDireta ? 0 : 1) * qty;
        day.faturamento += gmv;
        day.gmv_total += gmv;
      }
    }

    if (!nodeTemPedidoValido) continue;

    let oidComissao = "";
    for (const ord of node.orders || []) {
      if (!pedidoContaPromosApp(ord, node)) continue;
      oidComissao = String(ord.orderId || "").trim();
      if (oidComissao) break;
    }
    if (!oidComissao) oidComissao = String(ord0.orderId || "").trim();
    if (!oidComissao || comissaoPorPedido.has(oidComissao)) continue;

    let concluido = false;
    for (const ord of node.orders || []) {
      if (!pedidoContaPromosApp(ord, node)) continue;
      if (String(ord.orderId || "").trim() === oidComissao && pedidoConcluidoPromosApp(ord, node)) {
        concluido = true;
        break;
      }
    }

    comissaoPorPedido.set(oidComissao, tc);
    comissaoPromosGlobal += tc;
    day.comissao_estimada += tc;
    day.comissao_real += tc;
    day.comissao_total += tc;
    if (concluido) day.comissao_concluida += tc;
    else day.comissao_pendente += tc;
  }

  for (const date of Object.keys(dayMap)) {
    const d = dayMap[date];
    d.pedidos = d._pedidosSet.size;
    d.pedidos_concluidos = d._pedidosConcluidosSet.size;
    d.pedidos_pendentes = Math.max(0, d.pedidos - d.pedidos_concluidos);
    d.pedidos_cancelados = d._canceladosSet.size;
    delete d._pedidosSet;
    delete d._pedidosConcluidosSet;
    delete d._canceladosSet;
    d.comissao_estimada = roundMoney(d.comissao_estimada);
    d.comissao_real = roundMoney(d.comissao_real);
    d.comissao_total = roundMoney(d.comissao_total);
    d.comissao_concluida = roundMoney(d.comissao_concluida);
    d.comissao_pendente = roundMoney(Math.max(0, d.comissao_total - d.comissao_concluida));
    d.faturamento = roundMoney(d.faturamento);
    d.gmv_total = roundMoney(d.gmv_total);
  }

  return {
    dayMap,
    pedidosGlobal: pedidosGlobal.size,
    comissaoPromosGlobal: roundMoney(comissaoPromosGlobal),
    promosCalibracao: calib,
    promosCalibracaoConcluidos: calibConcluidos,
    promosExcludeOrderIds: [...PROMOS_EXCLUDE_ORDER_IDS],
    promosConcluidosOids: [...PROMOS_CONCLUIDOS_OIDS],
  };
}

function agruparPorData(nodes) {
  if (Object.keys(PROMOS_CALIB_REF).length > 0) {
    console.warn("[shopee] ⚠️ PROMOS_CALIB_REF não está vazio — produção travada na regra B; calibração Promos não deveria estar ativa.");
  }
  // PROMOSAPP EXATO — mestredolink 02/06/2026:
  // 664 pedidos · 659 pendentes (664−5) · R$ 1917,31 total · R$ 1912,54 pendente · R$ 4,77 concluída
  const PROMOSAPP_EXATO = true;
  const FILTRO_ESTILO_PAINEL = false;

  const dayMap = {};
  const subIdDayMap = {};
  const produtoDayMap = {};
  const perdas = [];
  const linkedMcnNames = new Set();

  // ★★★ DIAGNÓSTICO TEMPORÁRIO — identificar onde dados são descartados ★★★
  const diag = {
    nodes_recebidos: nodes.length,
    nodes_sem_orders: 0,
    nodes_sem_conversionId: 0,
    orders_total: 0,
    orders_sem_date: 0,
    orders_sem_orderId: 0,
    orders_perda: 0,
    orders_unpaid: 0,
    orders_fraud: 0,
    orders_normais: 0,
    items_total: 0,
    items_normais: 0,
    items_de_perdas: 0,
    items_sem_itemId: 0,
    items_fraud: 0,
    qty_total_normais: 0,
    qty_total_perdas: 0,
    status_count: {},
    perdas_por_status: {},
    // ★ NOVOS contadores pra rastrear comissão perdida
    conv_total_comissao_api: 0,
    conv_conversoes_distintas: new Set(),
    conv_conversoes_so_unpaid: 0,
    conv_comissao_descartada_unpaid: 0,
    conv_conversoes_mistas: 0,
    conv_conversoes_aplicadas_count: 0,
    conv_comissao_aplicada_soma: 0,
    conv_comissao_zerada_count: 0,
    conv_usou_fallback1: 0,
    conv_usou_fallback2: 0,
    conv_continuou_zerada: 0,
  };

  for (const node of nodes) {
    const conversionId = String(node.conversionId || "").trim();
    if (!conversionId) diag.nodes_sem_conversionId++;

    const orders = node.orders || [];
    if (!orders.length) {
      diag.nodes_sem_orders++;
      continue;
    }

    const baseSubIdRaw = node.utmContent || "";
    const baseSubIdNorm = normalizeShopeeSubId(baseSubIdRaw);
    const subKey = baseSubIdNorm || "ORGANICO";

    // ★ Conversion-level commissions — CAMPOS OFICIAIS DA SHOPEE API
    //
    // Documentação:
    //   totalCommission = shopeeCommissionCapped + sellerCommission  (igual ao painel)
    //   netCommission   = totalCommission - mcnManagementFee         (só se houver MCN)
    //
    // Para alinhar com o painel Shopee, usamos SEMPRE totalCommission.
    // netCommission é guardado separadamente para auditoria de MCN.
    const totalCommissionConv = parseFloat(node.totalCommission || "0") || 0;
    const netCommissionConv = parseFloat(node.netCommission || "0") || 0;
    const mcnFeeConv = parseFloat(node.mcnManagementFee || "0") || 0;
    const shopeeCappedConv = parseFloat(node.shopeeCommissionCapped || "0") || 0;
    const sellerCommConv = parseFloat(node.sellerCommission || "0") || 0;

    void netCommissionConv;

    const linkedMcn = String(node.linkedMcnName || "").trim();
    if (linkedMcn) linkedMcnNames.add(linkedMcn);

    // "Comissão Estimada" do painel = totalCommission
    let comissaoEstimadaConv = totalCommissionConv;

    // Fallback 1: se total veio zerado, soma shopee + seller
    if (comissaoEstimadaConv === 0) {
      comissaoEstimadaConv = shopeeCappedConv + sellerCommConv;
    }

    // Fallback 2: ainda zerada, soma item-level
    if (comissaoEstimadaConv === 0) {
      let itemFallback = 0;
      for (const ord of orders) {
        for (const it of (ord.items || [])) {
          itemFallback += parseItemTotalCommission(it);
        }
      }
      comissaoEstimadaConv = itemFallback;
      if (itemFallback > 0) diag.conv_usou_fallback2++;
      else diag.conv_continuou_zerada++;
    } else if (totalCommissionConv === 0) {
      diag.conv_usou_fallback1++;
    }

    if (totalCommissionConv === 0) diag.conv_comissao_zerada_count++;

    // ★ Métricas a nível de conversão (antes do loop de orders)
    diag.conv_total_comissao_api += comissaoEstimadaConv;
    if (conversionId) diag.conv_conversoes_distintas.add(conversionId);

    const statusDaConversao = orders.map(o => String(o.orderStatus || "").toUpperCase().trim());
    const todosUnpaid = orders.length > 0 && statusDaConversao.every(s => s === "UNPAID");
    const algumUnpaid = statusDaConversao.some(s => s === "UNPAID");
    const algumNaoUnpaid = statusDaConversao.some(s => s !== "UNPAID" && s !== "");
    if (todosUnpaid && comissaoEstimadaConv > 0) {
      diag.conv_conversoes_so_unpaid++;
      if (FILTRO_ESTILO_PAINEL) diag.conv_comissao_descartada_unpaid += comissaoEstimadaConv;
    }
    if (algumUnpaid && algumNaoUnpaid) diag.conv_conversoes_mistas++;

    // ★★★ FIX: calcula isPerda a nível de CONVERSÃO (não de order individual)
    // Bug anterior: quando uma conversão tinha CANCELLED + PENDING misturados, e o
    // CANCELLED era processado primeiro no loop, a comissão da conversão inteira era
    // descartada. Solução: a conversão só é "perda" se TODOS os orders forem perda.
    const todosPerda = orders.length > 0 && statusDaConversao.every(s => shopeeIsStatusPerda(s));
    const algumNaoPerda = statusDaConversao.some(s => !shopeeIsStatusPerda(s));
    const isConversaoPerda = todosPerda && !algumNaoPerda;
    let comissaoNodeAplicada = false;
    const convConcluidaPromos = conversaoConcluidaPromosApp(node);

    for (const ord of orders) {
      diag.orders_total++;
      const date = dataPedidoBRT(ord, node);
      if (!date) {
        diag.orders_sem_date++;
        continue;
      }

      const items = ord.items || [];

      const orderId = String(ord.orderId || "").trim();
      if (!orderId) diag.orders_sem_orderId++;

      const statusPedidoRaw = ord.orderStatus || node.conversionStatus || "";
      // Filtro estilo painel: ignora UNPAID (painel da Shopee não conta esses)
      if (FILTRO_ESTILO_PAINEL && String(statusPedidoRaw || "").toUpperCase().trim() === "UNPAID") {
        continue;
      }
      diag.status_count[statusPedidoRaw] = (diag.status_count[statusPedidoRaw] || 0) + 1;

      const stUpper = String(statusPedidoRaw || "").toUpperCase().trim();
      const isPerda = stUpper === "CANCELLED" || shopeeIsStatusPerda(stUpper);
      const isUnpaid = String(statusPedidoRaw || "").toUpperCase().trim() === "UNPAID";

      const orderKey = orderId || `__no_id_${conversionId || "?"}`;
      const subDocId = `${date}_${subKey}`;
      const dayEntry = ensureDayMapEntry(dayMap, date);
      const subEntry = ensureSubIdDayEntry(subIdDayMap, subDocId, date, subKey);

      // FRAUD total no pedido — painel Shopee exclui
      const allFraud = items.length > 0 && items.every((it) => {
        const fs = String(it.fraudStatus || "").toUpperCase().trim();
        return fs === "FRAUD";
      });
      if (allFraud) {
        diag.orders_fraud += 1;
        continue;
      }

      if (isUnpaid) {
        diag.orders_unpaid += 1;
        if (orderId && !dayEntry._naoPagosVistos?.has(orderKey)) {
          if (!dayEntry._naoPagosVistos) dayEntry._naoPagosVistos = new Set();
          dayEntry._naoPagosVistos.add(orderKey);
          dayEntry.pedidos_nao_pagos = (dayEntry.pedidos_nao_pagos || 0) + 1;
        }
        dayEntry.comissao_nao_paga = roundMoney(
          (dayEntry.comissao_nao_paga || 0) + comissaoItemOrdemUnpaid(ord),
        );
        continue;
      }

      const statusClass = shopeeClassifyStatus(statusPedidoRaw);

      // Pedidos PromosApp: exige orderId; exclui CANCELLED/perda + fraud total
      const podeContarPedido = PROMOSAPP_EXATO ? Boolean(orderId) : items.length > 0;
      if (!dayEntry._pedidosVistos.has(orderKey) && podeContarPedido) {
        dayEntry._pedidosVistos.add(orderKey);
        if (isPerda) {
          dayEntry.pedidos_cancelados += 1;
          diag.orders_perda += 1;
        } else {
          dayEntry.pedidos += 1;
          subEntry.pedidos += 1;
          diag.orders_normais += 1;
          if (convConcluidaPromos) dayEntry.pedidos_concluidos += 1;
          else if (!PROMOSAPP_EXATO) dayEntry.pedidos_pendentes += 1;
        }
      }

      // Comissão: 1× por node — split nível conversão (critério PromosApp H2)
      if (!comissaoNodeAplicada && !isPerda && !allFraud) {
        comissaoNodeAplicada = true;
        const comissaoRealConv = comissaoEstimadaConv;
        diag.conv_conversoes_aplicadas_count++;
        diag.conv_comissao_aplicada_soma += comissaoEstimadaConv;
        if (mcnFeeConv > 0) dayEntry.mcn_fee = (dayEntry.mcn_fee || 0) + mcnFeeConv;
        aplicarSplitComissaoConversao(
          dayEntry,
          comissaoRealConv,
          splitComissaoPorStatusItens(node, orders),
        );
        subEntry.comissoes += comissaoRealConv;
        subEntry.comissoes_estimadas += comissaoEstimadaConv;
      }

      // Itens / GMV — só pendentes + concluídos no total (PromosApp)
      diag.items_total += items.length;
      if (isPerda) {
        diag.items_de_perdas += items.length;
        diag.perdas_por_status[statusPedidoRaw] = (diag.perdas_por_status[statusPedidoRaw] || 0) + 1;
      } else {
        diag.items_normais += items.length;
      }

      const qtyAdded = isPerda
        ? 0
        : (PROMOSAPP_EXATO
          ? contabilizarItensPromosApp(dayEntry, subEntry, items)
          : contabilizarItensPainel(dayEntry, subEntry, items, orderKey));
      if (isPerda) diag.qty_total_perdas += qtyAdded;
      else diag.qty_total_normais += qtyAdded;

      if (isPerda) {
        for (const it of items) {
          const itemId = String(it.itemId || "").trim();
          if (!itemId) diag.items_sem_itemId++;
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          const gmv = actual > 0 ? actual : price * qty;
          const comissaoEstimadaItem = parseItemTotalCommission(it);
          perdas.push({
            data: date,
            status: statusPedidoRaw,
            conversionId,
            orderId,
            itemId,
            faturamento_perdido: gmv,
            comissao_perdida: comissaoEstimadaItem,
            timestamp: Date.now(),
          });
        }
      }

      // Produto daily — pendentes + concluídos (UNPAID já saiu no continue)
      if (!isPerda) {
        for (const it of items) {
          const itemFraudStatus = String(it.fraudStatus || "").toUpperCase().trim();
          if (itemFraudStatus === "FRAUD") continue;
          const itemId = String(it.itemId || "").trim();
          const produtoId = itemId || "desconhecido";
          const produtoDocId = `${date}_${produtoId}`;
          if (!produtoDayMap[produtoDocId]) {
            produtoDayMap[produtoDocId] = {
              data: date,
              produto_id: produtoId,
              nome: String(it.itemName || "Produto"),
              sub_id: subKey,
              sub_ids: [],
              comissoes: 0,
              comissao_estimada: 0,
              comissoes_pendentes: 0,
              comissoes_concluidas: 0,
              comissoes_canceladas: 0,   // ← ADICIONA ESTA LINHA
              qtd_itens: 0,
              faturamento: 0,
              cliques: 0,
            };
          }
          if (subKey && subKey !== "ORGANICO" && !produtoDayMap[produtoDocId].sub_ids.includes(subKey)) {
            produtoDayMap[produtoDocId].sub_ids.push(subKey);
          }
          const qty = parseInt(it.qty, 10) || 1;
          const price = parseFloat(it.itemPrice || "0") || 0;
          const actual = parseFloat(it.actualAmount || "0") || 0;
          const gmv = actual > 0 ? actual : price * qty;
          const itemCommEst = parseItemTotalCommission(it);
          produtoDayMap[produtoDocId].comissao_estimada += itemCommEst;
          produtoDayMap[produtoDocId].comissoes += itemCommEst;
          produtoDayMap[produtoDocId].qtd_itens += qty;
          produtoDayMap[produtoDocId].faturamento += gmv;
          if (statusClass === "concluida") {
            produtoDayMap[produtoDocId].comissoes_concluidas += itemCommEst;
          } else if (statusClass === "cancelada") {
            produtoDayMap[produtoDocId].comissoes_canceladas += itemCommEst;
          } else {
            produtoDayMap[produtoDocId].comissoes_pendentes += itemCommEst;
          }
        }
      }
    }
  }

  // Limpa Sets internos dos dayMap antes de retornar (não devem ir pro Firestore)
  let promosPedidosGlobal = null;
  let promosComissaoGlobal = null;
  let promosCalibracao = null;
  let promosExcludeOrderIds = [];
  let shopeeOficialPeriodCalib = null;
  let shopeeOficialVariant = SHOPEE_OFICIAL_VARIANT;

  const datesInPull = collectPurchaseDatesBRT(nodes);
  const monthsInNodes = [...new Set(datesInPull.map((d) => d.slice(0, 7)))];

  const panelCalibByMonth = {};
  const usePanelCalib = SHOPEE_USE_DISPLAY_CALIB
    || monthsInNodes.some((m) => monthHasShopeePanelTarget(m));
  if (usePanelCalib) {
    for (const monthKey of monthsInNodes) {
      if (!monthHasShopeePanelTarget(monthKey)) continue;
      const monthNodes = nodes.filter((n) => nodeTemPedidoNoMes(n, monthKey));
      const aggMode = getShopeeAggregationMode();
      const panelChoice = getShopeeRuleAPanelChoice();
      const calib = SHOPEE_FORCE_RULE_A
        ? {
          tipo: aggMode === "promosapp" ? "promosapp" : "rule_a",
          monthKey,
          choice: panelChoice,
          variant: aggMode === "promosapp" ? "app_node_commission" : SHOPEE_DEFAULT_PANEL_VARIANT,
          alvo: aggMode === "promosapp"
            ? simularTotaisPanelAppPeriodo(monthNodes, panelChoice.mode || "node_once")
            : simularTotaisApiFaithfulPeriodo(monthNodes, "order", "total"),
        }
        : calibrarRegraShopeeOficialPeriodo(monthNodes, monthKey);
      panelCalibByMonth[monthKey] = calib;
      shopeeOficialPeriodCalib = calib;
      shopeeOficialVariant = calib.variant || SHOPEE_OFICIAL_VARIANT;
      if (SHOPEE_FORCE_RULE_A && getShopeeAggregationMode() !== "promosapp") {
        SHOPEE_PANEL_AGGREGATION_LABEL = "csv-export-rule-a";
      }
    }
  }

  if (PROMOSAPP_EXATO) {
    for (const date of datesInPull) {
      const usaPromos = Boolean(PROMOS_CALIB_REF[date]);
      const monthKey = date.slice(0, 7);
      const panelChoice = SHOPEE_FORCE_RULE_A
        ? getShopeeRuleAPanelChoice()
        : (panelCalibByMonth[monthKey]?.choice || null);
      const built = buildShopeeDayTotalsForDate(nodes, date, { usaPromos, monthKey, panelChoice });

      const {
        dayMap: overrideDayMap,
        pedidosGlobal,
        comissaoPromosGlobal: comGlobal,
        promosCalibracao: calib,
        promosExcludeOrderIds: excl,
        shopeeOficialVariant: varOficial,
      } = built;

      if (usaPromos && (PROMOS_CALIB_REF[date] || datesInPull.length === 1)) {
        promosPedidosGlobal = pedidosGlobal;
        promosComissaoGlobal = comGlobal;
        promosCalibracao = calib;
        promosExcludeOrderIds = excl || [];
      }

      const tag = usaPromos
        ? "PROMOS"
        : (panelChoice
          ? SHOPEE_PANEL_AGGREGATION_LABEL
          : (SHOPEE_USE_DISPLAY_CALIB
            ? `SHOPEE_OFICIAL(${varOficial || SHOPEE_OFICIAL_VARIANT})`
            : SHOPEE_AGG_RULES_VERSION));
      console.log(`[agruparPorData] ${tag} ${date} | pedidos=${pedidosGlobal} | comissao=${comGlobal}`);

      for (const [d, totais] of Object.entries(overrideDayMap)) {
        if (!dayMap[d]) dayMap[d] = criarDailyVazio(d);
        const registrosApi = dayMap[d].registros_api;
        Object.assign(dayMap[d], totais);
        if (registrosApi != null) dayMap[d].registros_api = registrosApi;
      }
    }
  }

  for (const date in dayMap) {
    delete dayMap[date]._pedidosVistos;
    delete dayMap[date]._itemsVistos;
    delete dayMap[date]._conversoesAplicadas;
    delete dayMap[date]._naoPagosVistos;

    if (PROMOSAPP_EXATO) {
      const d = dayMap[date];
      if (d.splitCriterio !== "conversao_promosapp") {
        d.pedidos_pendentes = Math.max(0, d.pedidos - d.pedidos_concluidos);
      }
      d.comissao_estimada = roundMoney(d.comissao_estimada);
      d.comissao_real = roundMoney(d.comissao_real);
      d.comissao_total = roundMoney(d.comissao_total);
      d.comissao_concluida = roundMoney(d.comissao_concluida);
      d.comissao_pendente = roundMoney(d.comissao_pendente);
      d.mcn_fee = roundMoney(d.mcn_fee || 0);
      d.faturamento = roundMoney(d.faturamento);
      d.gmv_total = roundMoney(d.gmv_total);
    }
  }

  let shopeeOficialPeriodAlign = null;
  let shopeeCsvPeriodAlign = null;
  if (SHOPEE_SNAP_CSV_BATIMENTO) {
    for (const monthKey of monthsInNodes) {
      const target = SHOPEE_CSV_BATIMENTO_REF[monthKey];
      if (!target) continue;
      const align = alinharMesAoPainelShopeeExato(dayMap, monthKey, target);
      if (align) {
        shopeeCsvPeriodAlign = align;
        SHOPEE_PANEL_AGGREGATION_LABEL = `csv-export-exact-${monthKey}`;
        if (shopeeOficialPeriodCalib) {
          shopeeOficialPeriodCalib.alinhamentoCsv = align;
          shopeeOficialPeriodCalib.depois = align.depois;
        }
      }
    }
  } else if (SHOPEE_ALIGN_PANEL_EXACT) {
    for (const monthKey of monthsInNodes) {
      const target = getShopeeOficialPeriodRefSync()[monthKey];
      if (!target) continue;
      const align = alinharMesAoPainelShopeeExato(dayMap, monthKey, target);
      if (align) {
        shopeeOficialPeriodAlign = align;
        SHOPEE_PANEL_AGGREGATION_LABEL = `shopee-official-exact-${monthKey}`;
        if (shopeeOficialPeriodCalib) {
          shopeeOficialPeriodCalib.alinhamentoExato = align;
          shopeeOficialPeriodCalib.depois = align.depois;
        }
      }
    }
  }

  reconciliarSubIdProdutoComDayMap(dayMap, subIdDayMap, produtoDayMap);

  if (SHOPEE_SNAP_CSV_BATIMENTO) {
    for (const monthKey of monthsInNodes) {
      const target = SHOPEE_CSV_BATIMENTO_REF[monthKey];
      if (target) reconciliarMesDerivadosAoAlvoOficial(subIdDayMap, produtoDayMap, monthKey, target);
    }
  } else if (SHOPEE_ALIGN_PANEL_EXACT) {
    for (const monthKey of monthsInNodes) {
      const target = getShopeeOficialPeriodRefSync()[monthKey];
      if (target) reconciliarMesDerivadosAoAlvoOficial(subIdDayMap, produtoDayMap, monthKey, target);
    }
  }

  acumularUnpaidEmDayMap(nodes, dayMap);
  for (const date of Object.keys(dayMap)) {
    const d = dayMap[date];
    d.pedidos_nao_pagos = Number(d.pedidos_nao_pagos || 0);
    d.comissao_nao_paga = roundMoney(d.comissao_nao_paga || 0);
  }
  const pedidosNaoPagosGlobal = somaPedidosNaoPagosDayMap(dayMap);

  // ★★★ LOG DE DIAGNÓSTICO ★★★
  const diagFinal = {
    ...diag,
    conv_conversoes_distintas: diag.conv_conversoes_distintas.size,
  };
  if (String(process.env.SHOPEE_VERBOSE_DIAG || "").trim() === "1") {
    console.log("[agruparPorData] DIAGNÓSTICO:", JSON.stringify(diagFinal, null, 2));
    console.log(`[agruparPorData] RESUMO: ${diag.nodes_recebidos} nodes → ${diag.orders_normais} pedidos válidos + ${diag.orders_perda} perdas | ${diag.items_normais} items válidos | ${diag.qty_total_normais} qty total`);
    console.log(`[agruparPorData] COMISSÃO: API total=${diag.conv_total_comissao_api.toFixed(2)} | aplicada=${diag.conv_comissao_aplicada_soma.toFixed(2)} | gap=${(diag.conv_total_comissao_api - diag.conv_comissao_aplicada_soma).toFixed(2)} | só-UNPAID descartado=${diag.conv_comissao_descartada_unpaid.toFixed(2)}`);
  }
  console.log(`[agruparPorData] CONVERSÕES: distintas=${diag.conv_conversoes_distintas.size} | aplicadas=${diag.conv_conversoes_aplicadas_count} | só-UNPAID=${diag.conv_conversoes_so_unpaid} | mistas=${diag.conv_conversoes_mistas} | comissão zerada=${diag.conv_comissao_zerada_count} | fallback1=${diag.conv_usou_fallback1} | fallback2=${diag.conv_usou_fallback2}`);
  console.log(`[agruparPorData] UNPAID: ${pedidosNaoPagosGlobal} pedidos_nao_pagos | diag.orders_unpaid=${diag.orders_unpaid}`);

  return {
    dayMap,
    subIdDayMap,
    produtoDayMap,
    perdas,
    pedidosNaoPagosGlobal,
    promosPedidosGlobal,
    promosComissaoGlobal,
    promosCalibracao,
    promosExcludeOrderIds,
    shopeeOficialPeriodCalib,
    shopeeOficialPeriodAlign,
    shopeeCsvPeriodAlign,
    shopeeOficialVariant,
    linkedMcnNames: [...linkedMcnNames],
    aggregationMode: getShopeeAggregationMode() === "promosapp"
      ? (SHOPEE_PANEL_AGGREGATION_LABEL || "promosapp-node-once")
      : (shopeeCsvPeriodAlign || shopeeOficialPeriodAlign
        ? SHOPEE_PANEL_AGGREGATION_LABEL
        : (shopeeOficialPeriodCalib?.variant
          ? SHOPEE_PANEL_AGGREGATION_LABEL
          : (SHOPEE_USE_DISPLAY_CALIB ? `display-calib-${shopeeOficialVariant}` : SHOPEE_AGG_RULES_VERSION))),
  };
}

/**
 * Replica um update de sync_state pro Supabase, fazendo merge com o doc existente.
 * Coluna real no Supabase é `key`, não `id`.
 */
async function syncStateToSupabase(docId, patch) {
  if (!supabase || !docId || !patch || typeof patch !== "object") return;
  try {
    const { data: existing } = await supabase
      .from("sync_state")
      .select("data_blob")
      .eq("key", docId)
      .maybeSingle();

    const cleanPatch = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val == null) {
        cleanPatch[k] = null;
        continue;
      }
      if (typeof val === "object" && val.constructor && val.constructor.name === "FieldValue") {
        try {
          if (val.isEqual && val.isEqual(FieldValue.serverTimestamp())) {
            cleanPatch[k] = new Date().toISOString();
            continue;
          }
        } catch { /* ignore */ }
        
        // increment → lê valor atual + soma operand
        if (val._methodName === "FieldValue.increment" || (val.operand !== undefined)) {
          const operand = Number(val.operand || val._operand || 1);
          const atual = Number((existing?.data_blob || {})[k] || 0);
          cleanPatch[k] = atual + operand;
          continue;
        }
        continue;
      }
      if (typeof val === "object" && typeof val.toDate === "function") {
        cleanPatch[k] = val.toDate().toISOString();
        continue;
      }
      cleanPatch[k] = val;
    }
    cleanPatch.updatedAt = new Date().toISOString();

    const merged = { ...(existing?.data_blob || {}), ...cleanPatch };

    const { error } = await supabase
      .from("sync_state")
      .upsert({ key: docId, data_blob: merged }, { onConflict: "key" });

    if (error) {
      console.error(`[SupabaseSync] sync_state/${docId} upsert falhou:`, error.message);
    }
  } catch (err) {
    console.error(`[SupabaseSync] sync_state/${docId} erro:`, err?.message || err);
  }
}

async function touchShopeeSyncHealth(patch) {
  await db.collection("sync_state").doc("shopee_health").set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await syncStateToSupabase("shopee_health", patch).catch(() => null);
}

async function touchMetaSyncHealth(patch) {
  await db.collection("sync_state").doc("meta_health").set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await syncStateToSupabase("meta_health", patch).catch(() => null);
}

async function bumpDailyVersionsManifest(dates, prefix) {
  if (!dates || dates.length === 0) return;
  const now = Date.now();
  const patch = {};
  for (const d of dates) {
    if (prefix === "shopee") {
      patch[`shopee_daily_${d}`] = now;
      patch[`subid_daily_${d}`] = now;
      patch[`produto_daily_${d}`] = now;
    } else if (prefix === "meta") {
      patch[`meta_ads_daily_${d}`] = now;
    }
  }
  await db.collection("sync_state").doc("daily_versions").set(patch, { merge: true }).catch(err => {
    console.error("[bumpDailyVersionsManifest] erro ao atualizar manifesto diferencial:", err);
  });
}

/** Dias corridos em BRT terminando em ontem (Meta Insights fecha o dia com atraso). */
const META_DAILY_RECENT_DAYS = 7;

function brtDateMinusDays(isoDate, daysAgo) {
  const [y, m, d] = String(isoDate || "").split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function monthStartBRT(dateStr) {
  return `${String(dateStr || "").slice(0, 7)}-01`;
}

function listBrtDatesInclusive(startDate, endDate) {
  const days = [];
  let cur = startDate;
  while (cur && endDate && cur <= endDate) {
    days.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  return days;
}

/** Re-sincroniza o mes corrente em fatias (4 dias/invocacao), sem script manual. */
const SHOPEE_MONTH_AUTO_CHUNK = Math.max(1, Math.min(4, Number(process.env.SHOPEE_MONTH_AUTO_CHUNK || 4)));

async function runShopeeMonthAutoSyncChunk() {
  const hoje = formatDateBRTYYYYMMDDNow();
  const monthStart = monthStartBRT(hoje);
  const stateRef = db.collection("sync_state").doc("shopee_month_auto");
  const snap = await stateRef.get().catch(() => null);
  const data = snap?.data() || {};

  let cursor = String(data.cursor || monthStart);
  if (cursor < monthStart || cursor > hoje) cursor = monthStart;

  const pending = listBrtDatesInclusive(cursor, hoje);
  const fatia = pending.slice(0, SHOPEE_MONTH_AUTO_CHUNK);
  const restante = pending.slice(SHOPEE_MONTH_AUTO_CHUNK);

  if (!fatia.length) {
    await stateRef.set({
      cursor: monthStart,
      lastFullPassAt: FieldValue.serverTimestamp(),
      lastPassMonth: hoje.slice(0, 7),
      aggregationMode: shopeeAggModeHealthLabel(),
    }, { merge: true });
    return { status: "full_pass_complete", month: hoje.slice(0, 7), proximo: monthStart };
  }

  const processados = [];
  const erros = [];
  for (let i = 0; i < fatia.length; i++) {
    const dia = fatia[i];
    try {
      if (i > 0) await waitNoScrollInterval(`month_auto_${dia}`);
      const startTs = brtDateToUnixStart(dia);
      const endTs = brtDateToUnixEnd(dia);
      const resultado = await runShopeeSync({
        startTs,
        endTs,
        label: `month_auto_${dia}`,
        updateCursor: false,
        forceReplace: true,
        updateDaily: true,
        dailyOnly: true,
        dateFilter: { type: "dates", dates: new Set([dia]) },
      });
      processados.push({ dia, ...resultado });
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`[shopee] month_auto erro em ${dia}: ${msg}`);
      erros.push({ dia, erro: msg });
    }
  }

  const proximo = restante[0] || monthStart;
  await stateRef.set({
    cursor: proximo,
    lastChunkAt: FieldValue.serverTimestamp(),
    lastChunkDays: fatia,
    restantes: restante.length,
    lastPassMonth: hoje.slice(0, 7),
    aggregationMode: shopeeAggModeHealthLabel(),
  }, { merge: true });

  return {
    status: "chunk_ok",
    month: hoje.slice(0, 7),
    processados,
    erros,
    proximo,
    restantes: restante.length,
  };
}

function metaDailyBrtRange(daysBack) {
  const days = Math.max(1, Math.min(365, parseInt(daysBack || META_DAILY_RECENT_DAYS, 10) || META_DAILY_RECENT_DAYS));
  const until = brtYesterdayYYYYMMDD();
  const since = brtDateMinusDays(until, days - 1);
  return { since, until, daysBack: days };
}

function criarDailyVazio(date) {
  return {
    data: date,
    pedidos: 0,
    pedidos_pendentes: 0,
    pedidos_concluidos: 0,
    pedidos_cancelados: 0,
    vendas: 0,
    vendas_diretas: 0,
    vendas_indiretas: 0,
    faturamento: 0,
    gmv_total: 0,
    comissao_real: 0,
    comissao_total: 0,
    comissao_concluida: 0,
    comissao_pendente: 0,
    comissao_estimada: 0,
    mcn_fee: 0,
    pedidos_nao_pagos: 0,
    comissao_nao_paga: 0,
    perdas_pedidos: 0,
    perdas_fat: 0,
    perdas_comissao: 0,
  };
}

function garantirDatasNoDayMap(dayMap, dates) {
  for (const date of dates) {
    if (!dayMap[date]) dayMap[date] = criarDailyVazio(date);
  }
}

function formatDateBRTYYYYMMDDNow() {
  return new Date((Date.now() / 1000 - 10800) * 1000).toISOString().split("T")[0];
}

/** Converte unix (s ou ms) para YYYY-MM-DD em America/Sao_Paulo. */
function formatUnixToBRTDate(unixValue) {
  let sec = Number(unixValue);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec > 1e12) sec = Math.floor(sec / 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(sec * 1000));
}

/** Data do pedido em BRT — alinha com CSV "Horário do pedido" (PATCH I Bug 5). */
function dataPedidoBRT(ord, node) {
  return formatUnixToBRTDate(ord?.purchaseTime ?? node?.purchaseTime);
}

/** Todas as datas de pedido presentes no pull (não só node.purchaseTime). */
function collectPurchaseDatesBRT(nodes) {
  const dates = new Set();
  for (const node of nodes || []) {
    for (const ord of node.orders || []) {
      const d = dataPedidoBRT(ord, node);
      if (d) dates.add(d);
    }
  }
  return [...dates].sort();
}

function nodeTemPedidoNoMes(node, monthKey) {
  for (const ord of node.orders || []) {
    const d = dataPedidoBRT(ord, node);
    if (d && d.startsWith(monthKey)) return true;
  }
  return false;
}

function brtDateToUnixStart(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T00:00:00-03:00`) / 1000);
}

function brtDateToUnixEnd(dateStr) {
  return Math.floor(Date.parse(`${dateStr}T23:59:59-03:00`) / 1000);
}

function brtYesterdayYYYYMMDD() {
  const hoje = formatDateBRTYYYYMMDDNow();
  const [y, m, d] = hoje.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

/** Hoje/ontem/anteontem (BRT): conversionReport costuma atrasar 24–48h. */
function isDiaComAtrasoShopeeApi(dateStr) {
  const hoje = formatDateBRTYYYYMMDDNow();
  const ontem = brtYesterdayYYYYMMDD();
  const [y, m, d] = hoje.split("-").map(Number);
  const ante = new Date(Date.UTC(y, m - 1, d - 2));
  const anteStr = `${ante.getUTCFullYear()}-${String(ante.getUTCMonth() + 1).padStart(2, "0")}-${String(ante.getUTCDate()).padStart(2, "0")}`;
  return dateStr === hoje || dateStr === ontem || dateStr === anteStr;
}

function diaShopeeDailyVazio(totais) {
  if (!totais) return true;
  return (totais.pedidos || 0) === 0
    && (totais.vendas || 0) === 0
    && (totais.comissao_estimada || 0) === 0
    && (totais.faturamento || totais.gmv_total || 0) === 0
    && (totais.pedidos_nao_pagos || 0) === 0;
}

function listDatesBetween(startStr, endStr) {
  const dates = [];
  let cur = startStr;
  while (cur <= endStr) {
    dates.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
    cur = `${nextDt.getUTCFullYear()}-${String(nextDt.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDt.getUTCDate()).padStart(2, "0")}`;
  }
  return dates;
}

function daysBetweenDates(dateStr, refStr) {
  const a = Date.parse(`${dateStr}T12:00:00-03:00`);
  const b = Date.parse(`${refStr}T12:00:00-03:00`);
  return Math.round((b - a) / 86400000);
}

/** @returns {null | { type: 'today' } | { type: 'dates', dates: Set<string> }} */
function normalizeDateFilter(dateFilter, todayOnly = false) {
  if (dateFilter) return dateFilter;
  if (todayOnly) return { type: "today" };
  return null;
}

function passesDateFilter(date, dateFilter) {
  if (!dateFilter) return true;
  if (dateFilter.type === "today") return date === formatDateBRTYYYYMMDDNow();
  if (dateFilter.type === "dates") return dateFilter.dates.has(date);
  return true;
}

function getRefreshThrottleMin(dateStr) {
  const hoje = formatDateBRTYYYYMMDDNow();
  const diff = daysBetweenDates(dateStr, hoje);
  if (diff <= 0) return 5;
  if (diff <= 2) return 30;
  if (diff <= 7) return 120;
  return 360;
}

async function checkRefreshThrottle(dates) {
  const now = Date.now();
  const skipped = [];
  const toRefresh = [];
  for (const date of dates) {
    const snap = await db.collection("sync_state").doc(`refresh_${date}`).get().catch(() => null);
    const lastMs = snap?.exists ? (snap.data()?.lastRefreshAt?.toMillis?.() || 0) : 0;
    const ageMin = lastMs > 0 ? (now - lastMs) / 60000 : Infinity;
    const throttle = getRefreshThrottleMin(date);
    if (ageMin < throttle) skipped.push(date);
    else toRefresh.push(date);
  }
  return { skipped, toRefresh };
}

async function markRefreshDone(dates, stats = {}) {
  for (const date of dates) {
    await db.collection("sync_state").doc(`refresh_${date}`).set({
      lastRefreshAt: FieldValue.serverTimestamp(),
      lastNodes: stats.nodes || 0,
      lastPedidos: stats.pedidos || 0,
    }, { merge: true });
  }
}

function buildLogPerdasDocId(row) {
  return [
    row.data,
    row.conversionId || "nc",
    row.orderId || "no",
    row.itemId || "ni",
  ].join("_").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 150);
}

/** IDs determinísticos do dia — evita query where(data==) para limpar órfãos. */
function collectDailyIdsForDate(collectionName, dateStr, validDocIds, perdasRows = []) {
  if (collectionName === "log_perdas") {
    return (perdasRows || [])
      .filter((row) => row.data === dateStr)
      .map(buildLogPerdasDocId);
  }
  const ids = [];
  for (const id of validDocIds || []) {
    if (collectionName === "subid_daily" && (id.startsWith(`${dateStr}_`) || id === `${dateStr}__outros_canais`)) {
      ids.push(id);
    }
    if (collectionName === "produto_daily" && (id.startsWith(`${dateStr}_`) || id === `${dateStr}_cauda_longa`)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Remove órfãos via manifesto (1 read/dia/coleção) em vez de varrer a coleção inteira.
 */
async function reconcileDailyManifest(collectionName, dateStr, newIds, state, flush) {
  if (!dateStr) return 0;
  const manifestRef = db.collection("sync_manifest").doc(`${collectionName}__${dateStr}`);
  const manifestSnap = await manifestRef.get().catch(() => null);
  const oldIds = manifestSnap?.exists ? (manifestSnap.data()?.ids || []) : [];
  const newSet = new Set(newIds || []);
  let deleted = 0;

  for (const id of oldIds) {
    if (newSet.has(id)) continue;
    state.batch.delete(db.collection(collectionName).doc(id));
    state.count++;
    deleted++;
    await flush();
  }

  state.batch.set(manifestRef, {
    collection: collectionName,
    date: dateStr,
    ids: [...newSet],
    updatedAt: FieldValue.serverTimestamp(),
  });
  state.count++;
  await flush();
  return deleted;
}

async function touchImportacoesLatestBackend(tipo, importId) {
  const fieldMap = {
    meta_ads: "metaAds",
    pinterest: "pinterest",
    shopee_venda: "shopeeVenda",
    shopee_clique: "shopeeClique",
    shopee_api: "shopeeVenda",
  };
  const field = fieldMap[tipo];
  if (!field || !importId) return;
  await db.collection("sync_state").doc("importacoes_latest").set({
    [field]: importId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => null);
}

// TTL do lock deve ser MENOR que o timeoutSeconds das functions que o usam
// (atualmente 540s/9min). Se forem iguais, uma execução que bate no timeout
// do Cloud Run é morta ANTES do `finally` rodar, e o lock fica preso até
// expirar sozinho — fazendo a próxima execução agendada (6h depois) também
// perder a corrida, e assim sucessivamente. Margem de ~60s evita isso.
const SHOPEE_SYNC_LOCK_TTL_MS = 480000; // 8 min (60s de margem vs timeout de 540s)

async function acquireShopeeSyncLock(label) {
  const ref = db.collection("sync_state").doc("shopee_lock");
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    if (data.lockedUntil && data.lockedUntil > now) {
      return { acquired: false, holder: data.label || "unknown" };
    }
    tx.set(ref, {
      lockedUntil: now + SHOPEE_SYNC_LOCK_TTL_MS,
      label,
      startedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { acquired: true };
  });
}

async function releaseShopeeSyncLock(label) {
  const ref = db.collection("sync_state").doc("shopee_lock");
  await ref.set({ lockedUntil: 0, label: null, releasedBy: label || null }, { merge: true }).catch(() => null);
}

/** Tier 2: atribui cliques Shopee por produto/dia via clique_daily + sub_id da conversão. */
async function enriquecerProdutoDayMapComCliques(produtoDayMap, dateFilter) {
  const dates = new Set();
  for (const totais of Object.values(produtoDayMap || {})) {
    if (passesDateFilter(totais.data, dateFilter)) dates.add(totais.data);
  }
  if (!dates.size) return;

  const cliqueIndex = {};
  for (const date of dates) {
    const snap = await db.collection("clique_daily").where("data", "==", date).get();
    snap.forEach((d) => {
      const x = d.data() || {};
      const sid = normalizeSubId(x.subid || x.sub_id_norm || "");
      if (!sid) return;
      cliqueIndex[`${date}__${sid}`] = (cliqueIndex[`${date}__${sid}`] || 0) + Number(x.cliques || 0);
    });
  }

  for (const totais of Object.values(produtoDayMap || {})) {
    if (!passesDateFilter(totais.data, dateFilter)) continue;
    const subs = new Set();
    if (totais.sub_id) subs.add(normalizeSubId(totais.sub_id));
    (totais.sub_ids || []).forEach((s) => subs.add(normalizeSubId(s)));
    let cliques = 0;
    for (const sid of subs) {
      if (!sid || sid === "organico") continue;
      cliques += cliqueIndex[`${totais.data}__${sid}`] || 0;
    }
    totais.cliques = cliques;
  }
}

/** Economia Firestore: pula write quando métricas de negócio não mudaram (exatidão preservada). */
const FIRESTORE_SKIP_UNCHANGED = process.env.FIRESTORE_SKIP_UNCHANGED !== "0";
const FIRESTORE_COMPARE_MONEY_EPS = 0.005;
const METADATA_FIELDS_SKIP_COMPARE = new Set([
  "updatedAt",
  "importacaoId",
  "importadoEm",
  "risco_api_updated_at",
  "periodo",
  "fonte",
  "_accountId",
  "syncedAt",
  "duracaoMs",
  "elapsedMs",
]);

function limparPayloadFirestore(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    if (METADATA_FIELDS_SKIP_COMPARE.has(k)) continue;
    if (v instanceof Set) continue;
    out[k] = v;
  }
  return out;
}

function normalizarValorComparacao(v) {
  if (v == null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
  }
  if (typeof v === "boolean") return v;
  const n = Number(v);
  if (String(v).trim() !== "" && Number.isFinite(n)) {
    return Number.isInteger(n) ? n : Math.round(n * 1000) / 1000;
  }
  return String(v).trim();
}

function valoresIguais(a, b) {
  const na = normalizarValorComparacao(a);
  const nb = normalizarValorComparacao(b);
  if (na === nb) return true;
  if (na == null && nb == null) return true;
  if (typeof na === "number" && typeof nb === "number") {
    return Math.abs(na - nb) < FIRESTORE_COMPARE_MONEY_EPS;
  }
  return false;
}

function payloadsIguais(novo, existente) {
  const n = limparPayloadFirestore(novo);
  const e = limparPayloadFirestore(existente);
  const keys = new Set([...Object.keys(n), ...Object.keys(e)]);
  for (const k of keys) {
    if (!valoresIguais(n[k], e[k])) return false;
  }
  return true;
}

async function prefetchDocMap(refs) {
  const map = new Map();
  const unique = [...new Map(refs.map((r) => [r.path, r])).values()];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const snaps = await db.getAll(...chunk);
    for (const snap of snaps) {
      map.set(snap.ref.path, snap.exists ? snap.data() : null);
    }
  }
  return map;
}

/** Enfileira batch.set só se payload de negócio difere do doc existente. */
async function applyPendingWrites(state, flush, pending, { merge = false, forceWrite = false } = {}) {
  if (!pending.length) return { gravados: 0, ignorados: 0 };
  
  const supabaseUpserts = [];

  if (!FIRESTORE_SKIP_UNCHANGED || forceWrite) {
    let gravados = 0;
    for (const { ref, payload } of pending) {
      state.batch.set(ref, payload, merge ? { merge: true } : undefined);
      supabaseUpserts.push({ tabela: ref.parent.id, id: ref.id, data: payload });
      state.count++;
      gravados++;
      await flush();
    }
    if (supabase && supabaseUpserts.length > 0) {
      await syncToSupabase(supabase, supabaseUpserts, []).catch(console.error);
    }
    return { gravados, ignorados: 0 };
  }

  const existingMap = await prefetchDocMap(pending.map((p) => p.ref));
  let gravados = 0;
  let ignorados = 0;

  for (const { ref, payload } of pending) {
    const existing = existingMap.get(ref.path);
    if (existing && payloadsIguais(payload, existing)) {
      ignorados++;
      state.skipped = (state.skipped || 0) + 1;
      // Firebase pula (igual), mas Supabase recebe upsert idempotente
      // pra garantir paridade mesmo quando Supabase está atrás.
      supabaseUpserts.push({ tabela: ref.parent.id, id: ref.id, data: payload });
      continue;
    }
    state.batch.set(ref, payload, merge ? { merge: true } : undefined);
    supabaseUpserts.push({ tabela: ref.parent.id, id: ref.id, data: payload });
    state.count++;
    gravados++;
    await flush();
  }

  if (supabase && supabaseUpserts.length > 0) {
    await syncToSupabase(supabase, supabaseUpserts, []).catch(console.error);
  }

  return { gravados, ignorados };
}

async function gravarShopeeDaily(dayMap, state, flush, dateFilter = null, mode = "replace", { forceWrite = false } = {}) {
  if (mode === "increment") {
    let gravados = 0;
    for (const [date, totais] of Object.entries(dayMap)) {
      if (!passesDateFilter(date, dateFilter)) continue;
      const ref = db.collection("shopee_daily").doc(date);
      state.batch.set(ref, {
        pedidos: FieldValue.increment(Number(totais.pedidos || 0)),
        vendas: FieldValue.increment(Number(totais.vendas || 0)),
        faturamento: FieldValue.increment(Number(totais.faturamento || 0)),
        gmv_total: FieldValue.increment(Number(totais.gmv_total || 0)),
        comissao_real: FieldValue.increment(Number(totais.comissao_real || 0)),
        comissao_total: FieldValue.increment(Number(totais.comissao_total || 0)),
        comissao_concluida: FieldValue.increment(Number(totais.comissao_concluida || 0)),
        comissao_pendente: FieldValue.increment(Number(totais.comissao_pendente || 0)),
        comissao_estimada: FieldValue.increment(Number(totais.comissao_estimada || 0)),
        mcn_fee: FieldValue.increment(Number(totais.mcn_fee || 0)),
        pedidos_nao_pagos: FieldValue.increment(Number(totais.pedidos_nao_pagos || 0)),
        comissao_nao_paga: FieldValue.increment(Number(totais.comissao_nao_paga || 0)),
        vendas_diretas: FieldValue.increment(Number(totais.vendas_diretas || 0)),
        vendas_indiretas: FieldValue.increment(Number(totais.vendas_indiretas || 0)),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      state.count++;
      gravados++;
      await flush();
    }
    return gravados;
  }

  const pending = [];
  for (const [date, totais] of Object.entries(dayMap)) {
    if (!passesDateFilter(date, dateFilter)) continue;
    pending.push({
      ref: db.collection("shopee_daily").doc(date),
      payload: {
        ...limparPayloadFirestore(totais),
        data: date,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  }
  const { gravados } = await applyPendingWrites(state, flush, pending, { forceWrite });
  return gravados;
}

async function gravarSubIdDaily(subIdDayMap, state, flush, dateFilter = null, mode = "replace") {
  const MIN_COMISSAO_RELEVANCIA = 1.0;
  const pending = [];

  const porData = {};
  for (const [docId, totais] of Object.entries(subIdDayMap)) {
    if (!passesDateFilter(totais.data, dateFilter)) continue;
    if (!porData[totais.data]) porData[totais.data] = [];
    porData[totais.data].push({ docId, totais });
  }

  for (const [data, lista] of Object.entries(porData)) {
    const relevantes = lista.filter((x) => (x.totais.comissoes || 0) >= MIN_COMISSAO_RELEVANCIA);
    const cauda = lista.filter((x) => (x.totais.comissoes || 0) < MIN_COMISSAO_RELEVANCIA);

    for (const { docId, totais } of relevantes) {
      if (mode === "increment") {
        const ref = db.collection("subid_daily").doc(docId);
        state.batch.set(ref, {
          data: totais.data,
          subid: totais.subid,
          pedidos: FieldValue.increment(Number(totais.pedidos || 0)),
          qtd_itens: FieldValue.increment(Number(totais.qtd_itens || 0)),
          faturamento: FieldValue.increment(Number(totais.faturamento || 0)),
          comissoes: FieldValue.increment(Number(totais.comissoes || 0)),
          comissoes_estimadas: FieldValue.increment(Number(totais.comissoes_estimadas || 0)),
          vendas_diretas: FieldValue.increment(Number(totais.vendas_diretas || 0)),
          vendas_indiretas: FieldValue.increment(Number(totais.vendas_indiretas || 0)),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        state.count++;
        await flush();
        continue;
      }
      pending.push({
        ref: db.collection("subid_daily").doc(docId),
        payload: { ...limparPayloadFirestore(totais), updatedAt: FieldValue.serverTimestamp() },
      });
    }

    if (cauda.length > 0) {
      const caudaAgg = {
        data,
        subid: "_outros_canais",
        pedidos: 0,
        qtd_itens: 0,
        faturamento: 0,
        comissoes: 0,
        comissoes_estimadas: 0,
        vendas_diretas: 0,
        vendas_indiretas: 0,
        subids_count: cauda.length,
      };
      for (const { totais } of cauda) {
        caudaAgg.pedidos += Number(totais.pedidos || 0);
        caudaAgg.qtd_itens += Number(totais.qtd_itens || 0);
        caudaAgg.faturamento += Number(totais.faturamento || 0);
        caudaAgg.comissoes += Number(totais.comissoes || 0);
        caudaAgg.comissoes_estimadas += Number(totais.comissoes_estimadas || 0);
        caudaAgg.vendas_diretas += Number(totais.vendas_diretas || 0);
        caudaAgg.vendas_indiretas += Number(totais.vendas_indiretas || 0);
      }
      pending.push({
        ref: db.collection("subid_daily").doc(`${data}__outros_canais`),
        payload: { ...caudaAgg, updatedAt: FieldValue.serverTimestamp() },
      });
    }
  }

  if (mode === "increment") {
    return pending.length;
  }
  const { gravados } = await applyPendingWrites(state, flush, pending);
  return gravados;
}

async function gravarProdutoDaily(produtoDayMap, state, flush, dateFilter = null, mode = "replace") {
  const TOP_N = 100;
  const pending = [];

  const porData = {};
  for (const [docId, totais] of Object.entries(produtoDayMap)) {
    if (!passesDateFilter(totais.data, dateFilter)) continue;
    if (!porData[totais.data]) porData[totais.data] = [];
    porData[totais.data].push({ docId, totais });
  }

  for (const [data, lista] of Object.entries(porData)) {
    lista.sort((a, b) => (b.totais.comissoes || 0) - (a.totais.comissoes || 0));
    const top = lista.slice(0, TOP_N);
    const cauda = lista.slice(TOP_N);

    for (const { docId, totais } of top) {
      if (mode === "increment") {
        const ref = db.collection("produto_daily").doc(docId);
        state.batch.set(ref, {
          data: totais.data,
          produto_id: totais.produto_id,
          nome: totais.nome,
          comissoes: FieldValue.increment(Number(totais.comissoes || 0)),
          comissoes_pendentes: FieldValue.increment(Number(totais.comissoes_pendentes || 0)),
          qtd_itens: FieldValue.increment(Number(totais.qtd_itens || 0)),
          faturamento: FieldValue.increment(Number(totais.faturamento || 0)),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        state.count++;
        await flush();
        continue;
      }
      pending.push({
        ref: db.collection("produto_daily").doc(docId),
        payload: { ...limparPayloadFirestore(totais), updatedAt: FieldValue.serverTimestamp() },
      });
    }

    if (cauda.length > 0) {
      const caudaAgg = {
        data,
        produto_id: "_cauda_longa",
        nome: `Cauda longa (${cauda.length} produtos)`,
        comissoes: 0,
        comissoes_pendentes: 0,
        qtd_itens: 0,
        faturamento: 0,
        cliques: 0,
        produtos_count: cauda.length,
      };
      for (const { totais } of cauda) {
        caudaAgg.comissoes += Number(totais.comissoes || 0);
        caudaAgg.comissoes_pendentes += Number(totais.comissoes_pendentes || 0);
        caudaAgg.qtd_itens += Number(totais.qtd_itens || 0);
        caudaAgg.faturamento += Number(totais.faturamento || 0);
        caudaAgg.cliques += Number(totais.cliques || 0);
      }
      pending.push({
        ref: db.collection("produto_daily").doc(`${data}_cauda_longa`),
        payload: { ...caudaAgg, updatedAt: FieldValue.serverTimestamp() },
      });
    }
  }

  if (mode === "increment") {
    return pending.length;
  }
  const { gravados } = await applyPendingWrites(state, flush, pending);
  return gravados;
}

async function gravarLogPerdas(perdas, state, flush, dateFilter = null) {
  if (!perdas || perdas.length === 0) return 0;
  const pending = [];

  for (const row of perdas) {
    if (!passesDateFilter(row.data, dateFilter)) continue;
    const docId = [
      row.data,
      row.conversionId || "nc",
      row.orderId || "no",
      row.itemId || "ni",
    ].join("_").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 150);
    pending.push({
      ref: db.collection("log_perdas").doc(docId),
      payload: limparPayloadFirestore(row),
    });
  }

  const { gravados } = await applyPendingWrites(state, flush, pending);
  return gravados;
}

/** Rollup de log_perdas → shopee_daily (1 read/dia no dashboard em vez de 1/doc). */
function rollupPerdasIntoDayMap(dayMap, perdasRows) {
  if (!dayMap || !perdasRows?.length) return;
  const seenByDay = {};

  for (const date of Object.keys(dayMap)) {
    dayMap[date].perdas_pedidos = 0;
    dayMap[date].perdas_fat = 0;
    dayMap[date].perdas_comissao = 0;
  }

  for (const row of perdasRows) {
    const date = row.data;
    if (!date || !dayMap[date]) continue;

    if (!seenByDay[date]) seenByDay[date] = new Set();
    const pedidoKey = row.orderId
      ? String(row.orderId)
      : `${row.conversionId || ""}_${row.itemId || ""}`;
    if (seenByDay[date].has(pedidoKey)) continue;
    seenByDay[date].add(pedidoKey);

    dayMap[date].perdas_pedidos += 1;
    dayMap[date].perdas_fat = roundMoney(
      (dayMap[date].perdas_fat || 0) + Number(row.faturamento_perdido || 0),
    );
    dayMap[date].perdas_comissao = roundMoney(
      (dayMap[date].perdas_comissao || 0) + Number(row.comissao_perdida || 0),
    );
  }
}

async function recalcularSumario(db) {
  const inicio = Date.now();

  const prodSnap = await db.collection("produtos").get();
  let comissaoTotal = 0;
  let comissaoConcluida = 0;
  let comissaoPendente = 0;
  let comissaoEstimada = 0;
  let fatBruto = 0;
  let vendasTotal = 0;
  let vendasDiretas = 0;
  let vendasIndiretas = 0;

  prodSnap.forEach((doc) => {
    const p = doc.data() || {};
    comissaoTotal += Number(p.comissao_total || 0);
    comissaoConcluida += Number(p.comissao_concluida || 0);
    comissaoPendente += Number(p.comissao_pendente || 0);
    comissaoEstimada += Number(p.comissao_estimada || 0);
    fatBruto += Number(p.gmv_total || 0);
    vendasTotal += Number(p.vendas || 0);
    vendasDiretas += Number(p.vendas_diretas || 0);
    vendasIndiretas += Number(p.vendas_indiretas || 0);
  });

  const metaSnap = await db.collection("meta_ads").get();
  let gastoMeta = 0;
  metaSnap.forEach((doc) => {
    const row = doc.data() || {};
    gastoMeta += Number(row.valorUsado || 0);
  });

  let gastoPin = 0;
  try {
    const pinSnap = await db.collection("pinterest_ads").get();
    pinSnap.forEach((doc) => {
      const row = doc.data() || {};
      gastoPin += Number(row.spend || 0);
    });
  } catch (err) {
    console.warn("[recalcularSumario] Pinterest indisponível, ignorando:", err?.message || err);
  }

  const sumario = {
    comissao_total: Math.round(comissaoTotal * 1000) / 1000,
    comissao_concluida: Math.round(comissaoConcluida * 1000) / 1000,
    comissao_pendente: Math.round(comissaoPendente * 1000) / 1000,
    comissao_estimada: Math.round(comissaoEstimada * 1000) / 1000,
    fat_bruto: Math.round(fatBruto * 100) / 100,
    vendas_total: vendasTotal,
    vendas_diretas: vendasDiretas,
    vendas_indiretas: vendasIndiretas,
    gasto_meta: Math.round(gastoMeta * 100) / 100,
    gasto_pin: Math.round(gastoPin * 100) / 100,
    gasto_total: Math.round((gastoMeta + gastoPin) * 100) / 100,
    produtos_count: prodSnap.size,
    last_updated: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(db.collection("sumarios").doc("dashboard"), sumario);
  batch.set(db.collection("sumarios").doc("atual"), sumario);
  await batch.commit();
  console.log(`[recalcularSumario] OK em ${Date.now() - inicio}ms`);

  return sumario;
}

async function getNovasConversoes(db, allNodes) {
  const conversionIdSet = new Set();
  for (const node of allNodes || []) {
    const cid = String(node?.conversionId || "").trim();
    if (cid) conversionIdSet.add(cid);
  }

  const conversionIds = [...conversionIdSet];
  const conversoesJaProcessadas = new Set();

  if (conversionIds.length === 0) {
    return { conversionIds: [], conversoesJaProcessadas, novosNodes: [], novosConversionIds: [] };
  }

  for (let i = 0; i < conversionIds.length; i += 10) {
    const chunk = conversionIds.slice(i, i + 10);
    const snap = await db.collection("conversoes_processadas")
      .where(admin.firestore.FieldPath.documentId(), "in", chunk)
      .get();
    snap.forEach((doc) => conversoesJaProcessadas.add(doc.id));
  }

  const novosNodes = (allNodes || []).filter((n) => {
    const cid = String(n?.conversionId || "").trim();
    if (!cid) return false;
    return !conversoesJaProcessadas.has(cid);
  });

  const novosConversionIdSet = new Set();
  for (const node of novosNodes) {
    const cid = String(node?.conversionId || "").trim();
    if (cid) novosConversionIdSet.add(cid);
  }

  return {
    conversionIds,
    conversoesJaProcessadas,
    novosNodes,
    novosConversionIds: [...novosConversionIdSet],
  };
}

async function runShopeeSync({
  startTs,
  endTs,
  label,
  updateCursor = false,
  forceReplace = false,
  updateDaily = false,
  dateFilter = null,
  dailyOnly = false,
  todayOnly = false,
}) {
  const lock = await acquireShopeeSyncLock(label || "sync");
  if (!lock.acquired) {
    console.warn(`[shopee] sync "${label}" ignorado — lock ocupado por ${lock.holder}`);
    return {
      skipped: true,
      reason: "lock_busy",
      holder: lock.holder,
      nodes: 0,
      produtos: 0,
      shopeeDaily: 0,
      subIdDaily: 0,
      produtoDaily: 0,
    };
  }

  try {
  await loadShopeeOficialPeriodRef(db);
  const startedAt = Date.now();
  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;
  const resolvedDateFilter = normalizeDateFilter(dateFilter, todayOnly);
  const shopeeAggMode = getShopeeAggregationMode();
  console.log(`[shopee] início ${label} | aggMode=${shopeeAggMode} | range ${startTs} → ${endTs} | importacaoId=${importacaoId} | dailyOnly=${dailyOnly}`);

  const { allNodes, pageCount } = updateDaily
    ? await shopeePullRangeComplete(startTs, endTs)
    : await shopeePullRange(startTs, endTs);
  const { prodMap, subIdMap } = shopeeAggregate(allNodes);

  const state = { batch: db.batch(), count: 0 };
  const flush = async (force = false) => {
    if (state.count >= 50 || (force && state.count > 0)) {
      await state.batch.commit();
      state.batch = db.batch();
      state.count = 0;
    }
  };

  let prodsGravados = 0;
  if (!dailyOnly) {
    for (const prod of Object.values(prodMap)) {
      const docId = (prod.id_item && String(prod.id_item).trim())
        ? `item_${prod.id_item}`
        : `name_${prod.nome.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 80)}`;

      const ref = db.collection("produtos").doc(docId);
      state.batch.set(ref, {
        ...prod,
        sub_ids: Array.from(prod.sub_ids),
        gmv: prod.gmv_total,
        fonte: "shopee_api_backend",
        importacaoId,
        updatedAt: FieldValue.serverTimestamp(),
        importadoEm: FieldValue.serverTimestamp(),
      }, { merge: true });
      state.count++; prodsGravados++;
      await flush();
    }
  }

  let novosConversionIds = [];
  if (!dailyOnly) {
    if (!forceReplace) {
      const { conversionIds, conversoesJaProcessadas, novosNodes: nn, novosConversionIds: nc } = await getNovasConversoes(db, allNodes);
      console.log(`[shopee] dedup: ${conversoesJaProcessadas.size} conversões já processadas de ${conversionIds.length} totais`);
      novosConversionIds = nc;
    } else {
      const set = new Set();
      for (const node of allNodes || []) {
        const cid = String(node?.conversionId || "").trim();
        if (cid) set.add(cid);
      }
      novosConversionIds = [...set];
    }

    for (const cid of novosConversionIds) {
      const ref = db.collection("conversoes_processadas").doc(cid);
      state.batch.set(ref, {
        processadoEm: FieldValue.serverTimestamp(),
        importacaoId,
      }, { merge: true });
      state.count++;
      await flush();
    }
  }

  if (!(allNodes.length === 0 && label === "incremental_cursor")) {
    state.batch.set(importRef, {
      tipo: "shopee_venda",
      fonte: "api_backend",
      modo: dailyOnly ? "daily_only" : "append",
      periodo: label,
      rangeStart: startTs,
      rangeEnd: endTs,
      status: "sucesso",
      linhasProcessadas: allNodes.length,
      registros_api: allNodes.length,
      produtosUnicos: Object.keys(prodMap).length,
      subIdsUnicos: Object.keys(subIdMap).length,
      duracaoMs: Date.now() - startedAt,
      paginas: pageCount,
      importadoEm: FieldValue.serverTimestamp(),
    });
    state.count++;
  }

  // Atualiza o cursor SÓ se a sync rodou até o fim sem exceção.
  // Usamos endTs - SHOPEE_CURSOR_BACKFILL_MIN*60 pra não perder eventos
  // que entram com atraso na atribuição.
  if (updateCursor) {
    const cursorTs = endTs - SHOPEE_CURSOR_BACKFILL_MIN * 60;
    state.batch.set(db.collection("sync_state").doc("shopee"), {
      lastSuccessTs: cursorTs,
      lastRunAt: FieldValue.serverTimestamp(),
      lastLabel: label,
      lastNodes: allNodes.length,
    }, { merge: true });
    state.count++;
  }

  let dailyGravados = 0;
  let subIdDailyGravados = 0;
  let produtoDailyGravados = 0;
  let perdasGravadas = 0;
  let perdasRemovidas = 0;
  let dayMapKeys = [];
  let pedidosGravados = 0;
  let promosPedidosGlobal = null;
  let promosComissaoGlobal = null;
  let promosExcludeOrderIdsOut = [];
  let promosCalibracaoOut = null;
  let shopeeOficialPeriodCalibOut = null;
  let shopeeOficialPeriodAlignOut = null;
  let shopeeOficialVariantOut = SHOPEE_OFICIAL_VARIANT;
  let promosRulesVersion = SHOPEE_AGG_RULES_VERSION;
  let dayMap = null;
  let linkedMcnNamesOut = [];
  if (updateDaily) {
    const grouped = agruparPorData(allNodes);
    linkedMcnNamesOut = grouped.linkedMcnNames || [];
    promosPedidosGlobal = grouped.promosPedidosGlobal;
    promosComissaoGlobal = grouped.promosComissaoGlobal;
    promosExcludeOrderIdsOut = grouped.promosExcludeOrderIds || [];
    promosCalibracaoOut = grouped.promosCalibracao || null;
    shopeeOficialPeriodCalibOut = grouped.shopeeOficialPeriodCalib || null;
    shopeeOficialPeriodAlignOut = grouped.shopeeOficialPeriodAlign || null;
    shopeeOficialVariantOut = grouped.shopeeOficialVariant || SHOPEE_OFICIAL_VARIANT;
    promosRulesVersion = grouped.aggregationMode || SHOPEE_AGG_RULES_VERSION;
    dayMap = grouped.dayMap;
    const { subIdDayMap, produtoDayMap, perdas } = grouped;
    dayMapKeys = Object.keys(dayMap);

    const datesToReplace = resolvedDateFilter?.type === "dates"
      ? resolvedDateFilter.dates
      : resolvedDateFilter?.type === "today"
        ? new Set([formatDateBRTYYYYMMDDNow()])
        : new Set(Object.keys(dayMap));

    if (datesToReplace.size > 0) {
      // Garante doc para cada dia do filtro; não sobrescreve dia recente com zeros se API ainda não indexou
      for (const date of [...datesToReplace]) {
        const totais = dayMap[date];
        const vazio = !totais || diaShopeeDailyVazio(totais);
        if (allNodes.length === 0 && vazio && isDiaComAtrasoShopeeApi(date)) {
          console.warn(`[shopee] skip gravar ${date}: API retornou 0 nodes (atraso normal hoje/ontem)`);
          datesToReplace.delete(date);
          if (dayMap[date] && diaShopeeDailyVazio(dayMap[date])) delete dayMap[date];
          continue;
        }
        if (!dayMap[date]) dayMap[date] = criarDailyVazio(date);
      }
      if (resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1) {
        const [onlyDate] = [...resolvedDateFilter.dates];
        if (dayMap[onlyDate]) dayMap[onlyDate].registros_api = allNodes.length;
      } else if (resolvedDateFilter?.type === "today") {
        const hoje = formatDateBRTYYYYMMDDNow();
        if (dayMap[hoje]) dayMap[hoje].registros_api = allNodes.length;
      }
      const validSubIds = new Set();
      for (const [docId, t] of Object.entries(subIdDayMap || {})) {
        if (passesDateFilter(t.data, resolvedDateFilter)) validSubIds.add(docId);
      }
      for (const date of datesToReplace) {
        validSubIds.add(`${date}__outros_canais`);
      }

      const validProdIds = new Set();
      for (const [docId, t] of Object.entries(produtoDayMap || {})) {
        if (passesDateFilter(t.data, resolvedDateFilter)) validProdIds.add(docId);
      }
      for (const date of datesToReplace) {
        validProdIds.add(`${date}_cauda_longa`);
      }

      for (const dateStr of datesToReplace) {
        perdasRemovidas += await reconcileDailyManifest(
          "log_perdas",
          dateStr,
          collectDailyIdsForDate("log_perdas", dateStr, null, perdas),
          state,
          flush,
        );
        perdasRemovidas += await reconcileDailyManifest(
          "subid_daily",
          dateStr,
          collectDailyIdsForDate("subid_daily", dateStr, validSubIds),
          state,
          flush,
        );
        perdasRemovidas += await reconcileDailyManifest(
          "produto_daily",
          dateStr,
          collectDailyIdsForDate("produto_daily", dateStr, validProdIds),
          state,
          flush,
        );
      }
    }

    await enriquecerProdutoDayMapComCliques(produtoDayMap, resolvedDateFilter);

    rollupPerdasIntoDayMap(dayMap, perdas);

    dailyGravados = await gravarShopeeDaily(dayMap, state, flush, resolvedDateFilter, "replace", {
      forceWrite: forceReplace,
    });
    subIdDailyGravados = await gravarSubIdDaily(subIdDayMap, state, flush, resolvedDateFilter, "replace");
    produtoDailyGravados = await gravarProdutoDaily(produtoDayMap, state, flush, resolvedDateFilter, "replace");
    perdasGravadas = await gravarLogPerdas(perdas, state, flush, resolvedDateFilter);

    if (resolvedDateFilter?.type === "dates") {
      const pedidosPorData = {};
      for (const [date, totais] of Object.entries(dayMap)) {
        if (resolvedDateFilter.dates.has(date)) {
          pedidosPorData[date] = totais.pedidos || 0;
        }
      }
      pedidosGravados = Object.values(pedidosPorData).reduce((s, n) => s + n, 0);
      await markRefreshDone([...resolvedDateFilter.dates], {
        nodes: allNodes.length,
        pedidos: pedidosGravados,
      });
    } else if (resolvedDateFilter?.type === "today") {
      const hoje = formatDateBRTYYYYMMDDNow();
      pedidosGravados = dayMap[hoje]?.pedidos || 0;
      await markRefreshDone([hoje], {
        nodes: allNodes.length,
        pedidos: pedidosGravados,
      });
    } else if (dayMap) {
      pedidosGravados = Object.values(dayMap).reduce((s, d) => s + (d.pedidos || 0), 0);
    }
  }

  if (!(allNodes.length === 0 && label === "incremental_cursor") && dayMap) {
    const pedidosPorDia = {};
    const diasAtualizados = resolvedDateFilter?.type === "dates"
      ? [...resolvedDateFilter.dates]
      : resolvedDateFilter?.type === "today"
        ? [formatDateBRTYYYYMMDDNow()]
        : dayMapKeys.slice().sort();
    for (const date of diasAtualizados) {
      if (dayMap[date]) pedidosPorDia[date] = dayMap[date].pedidos || 0;
    }
    if (pedidosGravados === 0) {
      pedidosGravados = Object.values(pedidosPorDia).reduce((s, n) => s + (Number(n) || 0), 0);
    }
    state.batch.set(importRef, {
      pedidos: pedidosGravados,
      pedidosPorDia,
      diasAtualizados,
    }, { merge: true });
    state.count++;
  }

  let riscoApiGravados = 0;
  if (allNodes.length > 0) {
    riscoApiGravados = await gravarRiscoApiProdutos(db, allNodes, state, flush, importacaoId);
    if (riscoApiGravados > 0) {
      console.log(`[shopee] risco_api: ${riscoApiGravados} produtos com fraud_status/item_notes atualizados`);
    }
  }

  await flush(true);

  const gravadosTotais = dailyGravados + subIdDailyGravados + produtoDailyGravados + perdasGravadas;
  if (gravadosTotais > 0 || perdasRemovidas > 0) {
    const healthPatch = {
      dataVersion: FieldValue.increment(1),
      aggregationMode: shopeeAggModeHealthLabel(),
    };
    if (linkedMcnNamesOut.length > 0) {
      healthPatch.linkedMcnName = linkedMcnNamesOut[linkedMcnNamesOut.length - 1];
    }
    await touchShopeeSyncHealth(healthPatch);
    const diasRollup = resolvedDateFilter?.type === "dates"
      ? [...resolvedDateFilter.dates]
      : resolvedDateFilter?.type === "today"
        ? [formatDateBRTYYYYMMDDNow()]
        : (dayMapKeys || []).slice().sort();
    await bumpDailyVersionsManifest(diasRollup, "shopee");
    const isReconcile = /reconcile/i.test(String(label || ""));
    const isBackfill = /^backfill_/i.test(String(label || ""));
    const isManualRefresh = /^refresh_/i.test(String(label || ""));
    // PATCH G: refresh_range_* agora respeita throttle de 15 min. Antes era 0,
    // o que fazia o mês corrente ser reconstruído a cada visita do painel
    // (logs 15/06: 13 rebuilds num dia, ~39k reads). Reconcile e backfill
    // continuam com throttle 0 porque são operações intencionais/explícitas.
    const throttleMs = (isReconcile || isBackfill)
      ? 0
      : isManualRefresh
        ? 15 * 60 * 1000
        : 30 * 60 * 1000;

    try {
      const r = await refreshMonthlyBucketsForDates(db, diasRollup, { throttleMs });
      if (r?.length) {
        const summary = r.map((x) => x.skipped ? `${x.monthKey}(skip)` : x.monthKey).join(", ");
        console.log(`[monthlyRollup] ${label}:`, summary);
      }
    } catch (err) {
      console.warn("[monthlyRollup] falhou:", err?.message || err);
    }
  }
  if (importacaoId && !(allNodes.length === 0 && label === "incremental_cursor")) {
    await touchImportacoesLatestBackend("shopee_venda", importacaoId);
  }

  console.log(`[shopee] fim ${label} | nodes=${allNodes.length} | produtos=${prodsGravados} | shopee_daily=${dailyGravados} | subid_daily=${subIdDailyGravados} | produto_daily=${produtoDailyGravados} | log_perdas=${perdasGravadas} (removidas=${perdasRemovidas}) | writes_omitidos=${state.skipped || 0} | ${Date.now() - startedAt}ms`);

  return {
    importacaoId,
    nodes: allNodes.length,
    pedidos: pedidosGravados,
    shopeeAggMode: getShopeeAggregationMode(),
    promosPedidosGlobal,
    promosComissaoGlobal,
    promosRulesVersion,
    promosComissaoTotal: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.comissao_total
      : null,
    promosComissaoPendente: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.comissao_pendente
      : null,
    promosComissaoConcluida: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.comissao_concluida
      : null,
    promosPedidosConcluidos: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.pedidos_concluidos
      : null,
    promosPedidosPendentes: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.pedidos_pendentes
      : null,
    splitCriterio: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.splitCriterio
      : null,
    splitPedidoNivel: dayMap && resolvedDateFilter?.type === "dates" && resolvedDateFilter.dates.size === 1
      ? dayMap[[...resolvedDateFilter.dates][0]]?.splitPedidoNivel
      : null,
    promosExcludeOrderIds: promosExcludeOrderIdsOut,
    promosCalibracao: promosCalibracaoOut,
    shopeeOficialPeriodCalib: shopeeOficialPeriodCalibOut,
    shopeeOficialPeriodAlign: shopeeOficialPeriodAlignOut,
    shopeeOficialVariant: shopeeOficialVariantOut,
    produtos: prodsGravados,
    shopeeDaily: dailyGravados,
    subIdDaily: subIdDailyGravados,
    produtoDaily: produtoDailyGravados,
    perdas: perdasGravadas,
    perdasRemovidas,
    paginas: pageCount,
    dayMapKeys: updateDaily ? dayMapKeys : [],
    pedidosNaoPagos: dayMap ? somaPedidosNaoPagosDayMap(dayMap) : 0,
  };
  } finally {
    await releaseShopeeSyncLock(label || "sync");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1) Incremental sync — 4×/dia BRT, cursor + pull completo (daily)
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeIncrementalSync = onSchedule(
  {
    schedule: "0 0,6,12,18 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const stateSnap = await db.collection("sync_state").doc("shopee").get().catch(() => null);
    const lastSuccessTs = stateSnap?.exists ? (stateSnap.data()?.lastSuccessTs || 0) : 0;
    const start = lastSuccessTs > 0
      ? lastSuccessTs
      : now - SHOPEE_INITIAL_LOOKBACK_MIN * 60;

    try {
      const result = await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "incremental_cursor",
        updateCursor: true,
        updateDaily: true,
        dailyOnly: true,
      });
      await touchShopeeSyncHealth({
        lastIncrementalAt: FieldValue.serverTimestamp(),
        lastIncrementalNodes: result?.nodes || 0,
        aggregationMode: shopeeAggModeHealthLabel(),
        lastIncrementalError: null,
        lastIncrementalFailedAt: null,
      });
    } catch (e) {
      console.error("[shopee] incremental falhou:", e?.message || e);
      await touchShopeeSyncHealth({
        lastIncrementalError: String(e?.message || e),
        lastIncrementalFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  2) Daily reconcile — 4h BRT, últimos 15 dias
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeDailyReconcile = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    // PATCH H': 15 dias → 5 dias. Dias 6-15 raramente mudam após o atraso
    // típico de atribuição da Shopee (24-72h). monthAutoSync cobre o resto.
    // Economia: ~8k reads/dia em produto_daily prefetch.
    const start = now - 5 * 86400;
    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "reconcile_5d",
        updateCursor: false, // reconcile não mexe no cursor do incremental
        forceReplace: true,
        updateDaily: true,
        dailyOnly: true,
      });
      // recalcularSumario desativado: modo período usa shopee_daily; economiza ~41k reads/dia.
      // Manual: recalcularSumarioNow (HTTP) se precisar de sumarios/dashboard.
      await touchShopeeSyncHealth({
        // PATCH H': mantém nome _15d do campo pra não quebrar UI que lê
        // sync_state/shopee_health. Agora cobre 5 dias.
        lastReconcile15dAt: FieldValue.serverTimestamp(),
        aggregationMode: shopeeAggModeHealthLabel(),
        lastReconcile15dError: null,
        lastReconcile15dFailedAt: null,
      });
    } catch (e) {
      console.error("[shopee] reconcile falhou:", e?.message || e);
      await touchShopeeSyncHealth({
        lastReconcile15dError: String(e?.message || e),
        lastReconcile15dFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  2b) Rolling reconcile — a cada 4h, anteontem + ontem + hoje (BRT)
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeRecentDaysSync = onSchedule(
  {
    // PATCH K: 6×/dia → 4×/dia (00h, 06h, 12h, 18h BRT).
    // Mantém cobertura suficiente pra refletir vendas atrasadas no painel,
    // mas economiza 33% das execuções diárias.
    // PATCH L: deslocado +15min de shopeeIncrementalSync para evitar
    // colisão no lock "shopee_lock" — antes ambas disparavam no mesmo
    // minuto exato (0,6,12,18h), garantindo que uma sempre fosse
    // "ignorada — lock ocupado" pela outra a cada ciclo.
    schedule: "15 0,6,12,18 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    const now = Math.floor(Date.now() / 1000);
    const hoje = formatDateBRTYYYYMMDDNow();
    const ontem = brtYesterdayYYYYMMDD();
    const anteontem = brtDateMinusDays(hoje, 2);
    const start = brtDateToUnixStart(anteontem);

    try {
      await runShopeeSync({
        startTs: start,
        endTs: now,
        label: "recent_3d",
        updateCursor: false,
        forceReplace: true,
        updateDaily: true,
        dailyOnly: true,
        dateFilter: { type: "dates", dates: new Set([anteontem, ontem, hoje]) },
      });
      await touchShopeeSyncHealth({
        lastRecent3dAt: FieldValue.serverTimestamp(),
        lastRecent3dDates: [anteontem, ontem, hoje],
        aggregationMode: shopeeAggModeHealthLabel(),
        lastRecent3dError: null,
        lastRecent3dFailedAt: null,
      });
    } catch (e) {
      console.error("[shopee] recent_2d falhou:", e?.message || e);
      await touchShopeeSyncHealth({
        lastRecent3dError: String(e?.message || e),
        lastRecent3dFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  2c) Mes corrente automatico — 4×/dia BRT, chunks de 4 dias (sem script manual)
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeMonthAutoSync = onSchedule(
  {
    // PATCH K: 4×/dia → 2×/dia (01:30, 13:30 BRT). Chunks do mês corrente
    // não precisam rodar tantas vezes; reconcile diário + recent_3d cobrem.
    schedule: "30 1,13 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async () => {
    try {
      const result = await runShopeeMonthAutoSyncChunk();
      await touchShopeeSyncHealth({
        lastMonthAutoAt: FieldValue.serverTimestamp(),
        lastMonthAutoStatus: result?.status || "unknown",
        lastMonthAutoProximo: result?.proximo || null,
        lastMonthAutoRestantes: result?.restantes ?? null,
        aggregationMode: shopeeAggModeHealthLabel(),
        lastMonthAutoError: null,
        lastMonthAutoFailedAt: null,
      });
      console.log(`[shopee] month_auto: ${result?.status} | proximo=${result?.proximo} | restantes=${result?.restantes}`);
    } catch (e) {
      console.error("[shopee] month_auto falhou:", e?.message || e);
      await touchShopeeSyncHealth({
        lastMonthAutoError: String(e?.message || e),
        lastMonthAutoFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
//  3) Backfill manual — disparo HTTP autenticado
//     curl -H "Authorization: Bearer <META_SYNC_SECRET>" \
//       "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillNow?days=90"
// ═══════════════════════════════════════════════════════════════════════════
exports.shopeeBackfillNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async (req, res) => {
    // CORS: permite chamada do dashboard (Vercel)
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    // Responde preflight OPTIONS
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const todayOnly = req.query.todayOnly === "1";
      const singleDate = String(req.query.date || "").trim();
      const startDateParam = String(req.query.startDate || "").trim();
      const endDateParam = String(req.query.endDate || "").trim();
      const skipThrottle = req.query.force === "1";
      const rawDays = parseInt(req.query.days || (todayOnly ? "0" : "90"), 10);
      const days = todayOnly
        ? Math.max(0, Math.min(365, Number.isFinite(rawDays) ? rawDays : 0))
        : Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 90));
      const now = Math.floor(Date.now() / 1000);

      const startOfTodayBrtUnix = () => {
        const brtNow = new Date((now - 10800) * 1000);
        const y = brtNow.getUTCFullYear();
        const m = String(brtNow.getUTCMonth() + 1).padStart(2, "0");
        const d = String(brtNow.getUTCDate()).padStart(2, "0");
        const ms = Date.parse(`${y}-${m}-${d}T00:00:00-03:00`);
        return Math.floor(ms / 1000);
      };

      let start;
      let end = now;
      let dateFilter = null;
      let label;
      let isFullBackfill = false;
      let dailyOnly = true;

      if (singleDate && /^\d{4}-\d{2}-\d{2}$/.test(singleDate)) {
        const { skipped, toRefresh } = skipThrottle
          ? { skipped: [], toRefresh: [singleDate] }
          : await checkRefreshThrottle([singleDate]);
        if (toRefresh.length === 0) {
          res.json({ ok: true, skipped: true, throttled: skipped, message: "refresh_recente" });
          return;
        }
        start = brtDateToUnixStart(singleDate);
        end = brtDateToUnixEnd(singleDate);
        dateFilter = { type: "dates", dates: new Set(toRefresh) };
        label = `refresh_day_${singleDate}`;
      } else if (startDateParam && endDateParam
        && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)
        && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)) {
        const allDates = listDatesBetween(startDateParam, endDateParam);
        const { skipped, toRefresh } = skipThrottle
          ? { skipped: [], toRefresh: allDates }
          : await checkRefreshThrottle(allDates);
        if (toRefresh.length === 0) {
          res.json({ ok: true, skipped: true, throttled: skipped, message: "refresh_recente" });
          return;
        }
        start = brtDateToUnixStart(toRefresh[0]);
        const hoje = formatDateBRTYYYYMMDDNow();
        const lastDate = toRefresh[toRefresh.length - 1];
        end = lastDate === hoje ? now : brtDateToUnixEnd(lastDate);
        dateFilter = { type: "dates", dates: new Set(toRefresh) };
        label = `refresh_range_${startDateParam}_${endDateParam}`;
      } else if (todayOnly) {
        start = startOfTodayBrtUnix();
        label = "backfill_today_only";
        dateFilter = { type: "today" };
      } else {
        start = now - days * 86400;
        label = `backfill_${days}d`;
        isFullBackfill = true;
        dailyOnly = false;
      }

      const result = await runShopeeSync({
        startTs: start,
        endTs: end,
        label,
        updateCursor: isFullBackfill,
        forceReplace: isFullBackfill,
        updateDaily: true,
        dateFilter,
        dailyOnly,
        todayOnly,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

exports.recalcularSumarioNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET"],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const sumario = await recalcularSumario(db);
      res.json({ ok: true, sumario });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

exports.shopeeProductTest = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const itemId = req.query.itemId || req.body?.itemId;
    const shopId = req.query.shopId || req.body?.shopId;
    if (!itemId || !shopId) {
      res.status(400).json({ error: "missing_params", usage: "?itemId=XXX&shopId=YYY" });
      return;
    }

    try {
      const appId = process.env.SHOPEE_APP_ID;
      const shopeeSecret = process.env.SHOPEE_SECRET;
      const timestamp = Math.floor(Date.now() / 1000);

      const query = `{
        productOfferV2(itemId:${itemId}, shopId:${shopId}) {
          nodes {
            itemId
            shopId
            productName
            productLink
            offerLink
            price
            commissionRate
            sales
            imageUrl
            ratingStar
            shopName
            shopType
            priceMin
            priceMax
            productCatIds
            periodStartTime
            periodEndTime
          }
        }
      }`;

      const payload = JSON.stringify({ query });
      const baseString = `${appId}${timestamp}${payload}${shopeeSecret}`;
      const crypto = require("crypto");
      const signature = crypto.createHash("sha256").update(baseString).digest("hex");

      const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });

      const data = await response.json().catch(() => ({}));
      res.json({
        success: true,
        statusCode: response.status,
        statusOk: response.ok,
        rawResponse: data,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

function parseShopeeUrl(url) {
  if (!url || typeof url !== "string") return null;
  const cleaned = url.trim();

  let m = cleaned.match(/\/product\/(\d+)\/(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2], isShort: false };

  m = cleaned.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2], isShort: false };

  if (cleaned.includes("s.shopee.com.br")) {
    return { shopId: null, itemId: null, isShort: true, shortUrl: cleaned };
  }

  return null;
}

async function shopeeQueryProduct(itemId, shopId) {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);

  const query = `{
    productOfferV2(itemId:${itemId}, shopId:${shopId}) {
      nodes {
        itemId
        shopId
        productName
        productLink
        offerLink
        price
        priceMin
        priceMax
        commissionRate
        sales
        imageUrl
        ratingStar
        shopName
        shopType
        productCatIds
        periodStartTime
        periodEndTime
      }
    }
  }`;

  const payload = JSON.stringify({ query });
  const baseString = `${appId}${timestamp}${payload}${secret}`;
  const crypto = require("crypto");
  const signature = crypto.createHash("sha256").update(baseString).digest("hex");

  const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
  });

  const data = await response.json().catch(() => ({}));
  if (data?.errors) {
    throw new Error(`API Shopee retornou erros: ${JSON.stringify(data.errors)}`);
  }

  const nodes = data?.data?.productOfferV2?.nodes || [];
  return nodes.length ? nodes[0] : null;
}

function normalizeShopeeProduct(node) {
  return {
    itemId: String(node.itemId || ""),
    shopId: String(node.shopId || ""),
    nome: String(node.productName || ""),
    preco: Number(node.price || 0),
    precoMin: Number(node.priceMin || 0),
    precoMax: Number(node.priceMax || 0),
    comissao_pct: Number(node.commissionRate || 0) * 100,
    vendas_shopee: Number(node.sales || 0),
    imagem: String(node.imageUrl || ""),
    rating: Number(node.ratingStar || 0),
    loja: String(node.shopName || ""),
    shopType: Array.isArray(node.shopType) ? node.shopType : [],
    categoriaIds: Array.isArray(node.productCatIds) ? node.productCatIds : [],
    linkProduto: String(node.productLink || ""),
    linkAfiliado: String(node.offerLink || ""),
    periodoInicio: node.periodStartTime ? Number(node.periodStartTime) : null,
    periodoFim: node.periodEndTime ? Number(node.periodEndTime) : null,
  };
}

exports.shopeeProductLookup = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const url = req.query.url || req.body?.url;
    if (!url) {
      res.status(400).json({ error: "missing_url" });
      return;
    }

    const parsed = parseShopeeUrl(url);
    if (!parsed) {
      res.status(400).json({ error: "invalid_url" });
      return;
    }

    if (parsed.isShort) {
      res.status(400).json({
        error: "short_url_not_supported",
        hint: "Links curtos (s.shopee.com.br) não são suportados. Cole a URL final da página do produto.",
      });
      return;
    }

    try {
      const node = await shopeeQueryProduct(parsed.itemId, parsed.shopId);
      if (!node) {
        res.status(404).json({
          error: "product_not_found",
          hint: "O produto pode não estar no programa de afiliados ou ter sido removido.",
        });
        return;
      }

      const produto = normalizeShopeeProduct(node);

      let historico = null;
      try {
        const histRef = db.collection("produtos").doc(`item_${parsed.itemId}`);
        const histSnap = await histRef.get();
        if (histSnap.exists) {
          const h = histSnap.data() || {};
          historico = {
            ja_vendeu: true,
            vendas_minhas: Number(h.vendas || 0),
            vendas_diretas: Number(h.vendas_diretas || 0),
            vendas_indiretas: Number(h.vendas_indiretas || 0),
            comissao_total_minha: Number(h.comissao_total || 0),
            comissao_concluida: Number(h.comissao_concluida || 0),
            comissao_pendente: Number(h.comissao_pendente || 0),
            gmv_total_meu: Number(h.gmv_total || 0),
            preco_quando_vendi: Number(h.preco || 0),
            comissao_pct_quando_vendi: Number(h.comissao_pct || 0),
            ultima_venda: h.updatedAt?.toDate?.() || null,
            sub_ids: Array.isArray(h.sub_ids) ? h.sub_ids : [],
          };
        } else {
          historico = { ja_vendeu: false };
        }
      } catch {
        historico = { ja_vendeu: false };
      }

      let jaSalvoComoBackup = false;
      try {
        const backupRef = db.collection("backup_produtos").doc(`item_${parsed.itemId}`);
        const backupSnap = await backupRef.get();
        jaSalvoComoBackup = backupSnap.exists;
      } catch {
        jaSalvoComoBackup = false;
      }

      res.json({ success: true, produto, historico, jaSalvoComoBackup });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

function buildBackupAlertas(dadosAtuais, novoSnapshot) {
  const precoAntigo = Number(dadosAtuais.preco || 0);
  const comissaoAntiga = Number(dadosAtuais.comissao_pct || 0);
  const precoNovo = novoSnapshot.preco;
  const comissaoNova = novoSnapshot.comissao_pct;
  const alertas = [];

  if (comissaoAntiga > 0 && comissaoNova === 0) {
    alertas.push({
      tipo: "comissao_zero",
      nivel: "critico",
      mensagem: "Comissão caiu para 0%. Produto saiu do programa de afiliados.",
    });
  }

  if (novoSnapshot.periodoFim) {
    const agoraSegs = Math.floor(Date.now() / 1000);
    const diasRestantes = Math.floor((novoSnapshot.periodoFim - agoraSegs) / 86400);
    if (diasRestantes >= 0 && diasRestantes < 7) {
      alertas.push({
        tipo: "periodo_acaba",
        nivel: "critico",
        mensagem: `Período de comissão termina em ${diasRestantes} dia(s).`,
        diasRestantes,
      });
    }
  }

  if (precoAntigo > 0 && precoNovo > precoAntigo * 1.2) {
    const pct = ((precoNovo - precoAntigo) / precoAntigo) * 100;
    alertas.push({
      tipo: "preco_subiu",
      nivel: "aviso",
      mensagem: `Preço subiu ${pct.toFixed(1)}% (R$ ${precoAntigo.toFixed(2)} → R$ ${precoNovo.toFixed(2)}).`,
    });
  }

  if (comissaoAntiga > 0 && comissaoNova > 0 && comissaoNova < comissaoAntiga * 0.7) {
    const pct = ((comissaoAntiga - comissaoNova) / comissaoAntiga) * 100;
    alertas.push({
      tipo: "comissao_caiu",
      nivel: "aviso",
      mensagem: `Comissão caiu ${pct.toFixed(1)}% (${comissaoAntiga.toFixed(1)}% → ${comissaoNova.toFixed(1)}%).`,
    });
  }

  if (comissaoAntiga > 0 && comissaoNova > comissaoAntiga * 1.2) {
    const pct = ((comissaoNova - comissaoAntiga) / comissaoAntiga) * 100;
    alertas.push({
      tipo: "comissao_subiu",
      nivel: "bom",
      mensagem: `Comissão subiu ${pct.toFixed(1)}% (${comissaoAntiga.toFixed(1)}% → ${comissaoNova.toFixed(1)}%). Oportunidade!`,
    });
  }

  if (Number(novoSnapshot.vendas_shopee || 0) === 0 && comissaoNova > 0) {
    alertas.push({
      tipo: "estoque_indisponivel",
      nivel: "aviso",
      mensagem: "Produto sem vendas registradas na Shopee — verifique disponibilidade.",
    });
  }

  return alertas;
}

async function refreshBackupByItemId(itemId) {
  const backupRef = db.collection("backup_produtos").doc(`item_${itemId}`);
  const backupSnap = await backupRef.get();
  if (!backupSnap.exists) {
    return { ok: false, error: "not_in_backup" };
  }

  const dadosAtuais = backupSnap.data() || {};
  const shopId = dadosAtuais.shopId;
  if (!shopId) {
    return { ok: false, error: "missing_shopId_in_backup" };
  }

  const node = await shopeeQueryProduct(itemId, shopId);
  if (!node) {
    await backupRef.set({
      status_api: "produto_nao_encontrado",
      ultima_verificacao: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, status: "produto_nao_encontrado" };
  }

  const novoSnapshot = normalizeShopeeProduct(node);
  const alertas = buildBackupAlertas(dadosAtuais, novoSnapshot);

  await backupRef.set({
    ...novoSnapshot,
    apelido: dadosAtuais.apelido || "",
    marcadoPrincipal: !!dadosAtuais.marcadoPrincipal,
    grupoId: dadosAtuais.grupoId || null,
    cadastrado_em: dadosAtuais.cadastrado_em || FieldValue.serverTimestamp(),
    status_api: "ok",
    alertas,
    ultima_verificacao: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, produto: novoSnapshot, alertas };
}

async function runBackupRefreshBatch({ maxItems = 40, maxAgeHours = 20 } = {}) {
  const snap = await db.collection("backup_produtos").get();
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  const candidatos = [];

  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const itemId = String(d.itemId || docSnap.id.replace(/^item_/, ""));
    if (!itemId || !d.shopId) return;
    const uv = d.ultima_verificacao?.toDate?.()?.getTime() || 0;
    if (uv >= cutoff) return;
    candidatos.push({ itemId, uv });
  });

  candidatos.sort((a, b) => a.uv - b.uv);
  const toProcess = candidatos.slice(0, maxItems);
  let refreshed = 0;
  let errors = 0;

  for (const { itemId } of toProcess) {
    try {
      await refreshBackupByItemId(itemId);
      refreshed++;
    } catch (err) {
      errors++;
      console.error(`[backup-refresh] item ${itemId}:`, err?.message || err);
    }
    await new Promise((r) => setTimeout(r, SHOPEE_NEW_QUERY_DELAY_MS));
  }

  return {
    totalCadastrados: snap.size,
    candidatos: candidatos.length,
    attempted: toProcess.length,
    refreshed,
    errors,
  };
}

exports.shopeeBackupRefreshNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const itemId = req.query.itemId || req.body?.itemId;
    if (!itemId) {
      res.status(400).json({ error: "missing_itemId" });
      return;
    }

    try {
      const result = await refreshBackupByItemId(itemId);
      if (!result.ok) {
        const code = result.error === "not_in_backup" ? 404 : 400;
        res.status(code).json({ success: false, error: result.error });
        return;
      }
      if (result.status === "produto_nao_encontrado") {
        res.json({
          success: true,
          status: result.status,
          message: "Produto não retornou na API. Pode ter saído do programa.",
        });
        return;
      }
      res.json({ success: true, produto: result.produto, alertas: result.alertas });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

exports.shopeeBackupRefreshDaily = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await runBackupRefreshBatch({ maxItems: 40, maxAgeHours: 20 });
      console.log("[backup-refresh] daily:", JSON.stringify(result));
    } catch (e) {
      console.error("[backup-refresh] daily falhou:", e?.message || e);
    }
  },
);

exports.shopeeBackupRefreshGroupNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const grupoId = req.query.grupoId || req.body?.grupoId;
    if (!grupoId) {
      res.status(400).json({ error: "missing_grupoId" });
      return;
    }

    try {
      const grupoSnap = await db.collection("backup_grupos").doc(String(grupoId)).get();
      if (!grupoSnap.exists) {
        res.status(404).json({ error: "grupo_not_found" });
        return;
      }
      const g = grupoSnap.data() || {};
      const ids = [g.principalItemId, ...(g.backupItemIds || [])].filter(Boolean).map(String);
      const results = [];
      for (const itemId of ids) {
        try {
          const r = await refreshBackupByItemId(itemId);
          results.push({ itemId, ok: r.ok, status: r.status || "ok" });
        } catch (err) {
          results.push({ itemId, ok: false, error: err?.message || String(err) });
        }
        await new Promise((r) => setTimeout(r, SHOPEE_NEW_QUERY_DELAY_MS));
      }
      res.json({ success: true, grupoId, results });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

function mapNodeProductOfferParaGarimpo(n, fonte = "api") {
  const preco = Number(n.price || n.priceMin || n.priceMax || 0);
  const comissao_pct = Number(n.commissionRate || 0) * 100;
  return {
    itemId: String(n.itemId || ""),
    shopId: String(n.shopId || ""),
    productName: String(n.productName || ""),
    productLink: String(n.productLink || ""),
    offerLink: String(n.offerLink || ""),
    imageUrl: String(n.imageUrl || ""),
    priceMin: preco,
    commissionRate: Number(n.commissionRate || 0),
    commission: Number(n.commission || 0),
    comissao_pct,
    comissao_valor: Number(n.commission || 0),
    sales: Number(n.sales || 0),
    ratingStar: Number(n.ratingStar || 0),
    shopName: String(n.shopName || ""),
    shopType: Array.isArray(n.shopType) ? n.shopType : [],
    periodo_fim: n.periodEndTime ? Number(n.periodEndTime) : null,
    fonte,
  };
}

/** Marca se o candidato é da mesma loja do principal ou de outra loja (busca global). */
function marcarFonteGarimpoOferta(o, shopIdRef) {
  const sid = String(shopIdRef || "").trim();
  const mesma = sid && String(o.shopId) === sid;
  return { ...o, fonte: mesma ? "mesma_loja" : "global" };
}

/** Catálogo filtrado por shopId (parâmetro oficial da API BR). */
async function buscarOfertasPorShopIdDireto(shopId, excludeItemId, secrets, maxPaginas = 2, maxRetries = 2) {
  const sid = Number(String(shopId || "").trim());
  if (!sid || !Number.isFinite(sid)) return [];

  const similares = [];
  for (let page = 1; page <= maxPaginas; page++) {
    const queryStr = `{
      productOfferV2(shopId: ${sid}, sortType: 5, page: ${page}, limit: 50) {
        nodes {
          itemId shopId productName productLink offerLink
          price priceMin priceMax commissionRate commission sales
          imageUrl ratingStar shopName shopType periodEndTime
        }
        pageInfo { hasNextPage }
      }
    }`;
    const offer = await shopeeFetchProductOffer(queryStr);
    const nodes = offer.nodes || [];
    nodes.forEach((n) => {
      if (String(n.itemId) === String(excludeItemId)) return;
      similares.push(mapNodeProductOfferParaGarimpo(n, "mesma_loja"));
    });
    if (similares.length >= 12) break;
    if (!offer.pageInfo?.hasNextPage || nodes.length === 0) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  similares.sort((a, b) => (b.comissao_valor || 0) - (a.comissao_valor || 0));
  return similares.slice(0, 20);
}

/** Fallback: varre catálogo global e filtra shopId no servidor (lento / incompleto). */
async function buscarOfertasShopShopee(shopId, excludeItemId, secrets, maxPaginas = 3, maxRetries = 3) {
  const sid = String(shopId || "").trim();
  if (!sid) return [];

  const similares = [];
  for (let page = 1; page <= maxPaginas; page++) {
    const queryStr = `{
      productOfferV2(sortType: 5, page: ${page}, limit: 50) {
        nodes {
          itemId shopId productName productLink offerLink
          price priceMin priceMax commissionRate commission sales
          imageUrl ratingStar shopName shopType periodEndTime
        }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await shopeeApiCallRetry(queryStr, secrets, maxRetries);
    const offer = data?.data?.productOfferV2 || {};
    const nodes = offer.nodes || [];
    let foundOnPage = 0;
    nodes.forEach((n) => {
      if (String(n.shopId) !== sid) return;
      if (String(n.itemId) === String(excludeItemId)) return;
      foundOnPage += 1;
      const preco = Number(n.price || n.priceMin || 0);
      const comissao_pct = Number(n.commissionRate || 0) * 100;
      similares.push({
        itemId: String(n.itemId),
        shopId: String(n.shopId),
        nome: String(n.productName || ""),
        preco,
        comissao_pct,
        comissao_valor: Number(n.commission || 0),
        comissao_total: (preco * comissao_pct) / 100,
        vendas: Number(n.sales || 0),
        rating: Number(n.ratingStar || 0),
        is_mall: Array.isArray(n.shopType) && n.shopType.includes(1),
        link: String(n.offerLink || n.productLink || ""),
        periodo_fim: n.periodEndTime ? Number(n.periodEndTime) : null,
      });
    });
    if (similares.length >= 12) break;
    if (!offer.pageInfo?.hasNextPage || nodes.length === 0) break;
    if (foundOnPage === 0 && page >= 2) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  similares.sort((a, b) => b.comissao_total - a.comissao_total);
  return similares.slice(0, 12);
}

/** Busca por keyword (productOfferV2); shopId opcional restringe à loja. */
async function buscarOfertasGarimpoKeywordRaw(keyword, limit, secrets, maxRetries = 3, shopId = null) {
  const termo = String(keyword || "").trim();
  if (!termo) return [];

  const limite = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const sid = Number(String(shopId || "").trim());
  const shopClause = sid && Number.isFinite(sid) ? `, shopId: ${sid}` : "";
  const query = `{
    productOfferV2(keyword: ${JSON.stringify(termo)}${shopClause}, listType: 1, sortType: 1, page: 1, limit: ${limite}) {
      nodes {
        itemId shopId productName productLink offerLink imageUrl
        priceMin priceMax commissionRate commission sales ratingStar shopName shopType periodEndTime
      }
    }
  }`;

  const offer = await shopeeFetchProductOffer(query);
  const nodes = offer.nodes || [];
  return nodes.map((n) => mapNodeProductOfferParaGarimpo(n, "keyword_api"));
}

/** Usa shopeeFetch (mesmo caminho do backup refresh / sync). */
async function shopeeFetchProductOffer(queryStr) {
  const data = await shopeeFetch(queryStr);
  return data?.productOfferV2 || {};
}

function normalizarOfertaShopParaGarimpo(o) {
  return {
    itemId: String(o.itemId || ""),
    shopId: String(o.shopId || ""),
    productName: String(o.nome || o.productName || ""),
    productLink: String(o.link || o.productLink || ""),
    offerLink: String(o.link || o.offerLink || o.productLink || ""),
    imageUrl: String(o.imageUrl || o.imagem || ""),
    priceMin: Number(o.preco || 0),
    commissionRate: Number(o.comissao_pct || 0) / 100,
    commission: Number(o.comissao_valor || o.comissao_total || 0),
    comissao_pct: Number(o.comissao_pct || 0),
    comissao_valor: Number(o.comissao_valor || o.comissao_total || 0),
    sales: Number(o.vendas || 0),
    ratingStar: Number(o.rating || 0),
    shopName: "",
    shopType: o.is_mall ? [1] : [],
    periodo_fim: o.periodo_fim || null,
    fonte: "mesma_loja",
  };
}

function precoGarimpoDentroFaixa(precoCandidato, precoPrincipal, toleranciaAcimaPct, toleranciaAbaixoPct) {
  const base = Number(precoPrincipal);
  const preco = Number(precoCandidato);
  if (!base || base <= 0) return true;
  if (!preco || preco <= 0) return false;
  const acima = Math.min(100, Math.max(0, Number(toleranciaAcimaPct) || 0));
  const abaixo = Math.min(100, Math.max(0, Number(toleranciaAbaixoPct) || 0));
  const min = base * (1 - abaixo / 100);
  const max = base * (1 + acima / 100);
  return preco >= min && preco <= max;
}

function ranquearOfertasGarimpo(candidatos, {
  nomePrincipal,
  shopId,
  comissaoPctPrincipal,
  precoPrincipal,
  precoToleranciaAcimaPct,
  precoToleranciaAbaixoPct,
  limit,
}) {
  const comissaoPrincipal = Number(comissaoPctPrincipal || 0);
  const comissaoMin = Math.max(0, comissaoPrincipal * 0.75);

  const scored = candidatos.map((o) => {
    const relevancia = scoreRelevancia(
      nomePrincipal,
      o.productName,
      shopId,
      o.shopId,
    );
    const bonusComissao = o.comissao_pct >= comissaoPrincipal ? 12 : 0;
    const bonusValor = Math.min(15, Number(o.comissao_valor || 0) * 1.5);
    const bonusLoja = o.fonte === "mesma_loja" ? 5 : 0;
    const score_garimpo = relevancia + bonusComissao + bonusValor + bonusLoja;

    return { ...o, relevancia, score_garimpo };
  });

  const filtrar = (minRel, exigeComissao = true) => scored
    .filter((o) => o.relevancia >= minRel)
    .filter((o) => o.comissao_pct > 0)
    .filter((o) => !exigeComissao || o.comissao_pct >= comissaoMin || o.comissao_valor >= 2)
    .filter((o) => precoGarimpoDentroFaixa(
      o.priceMin,
      precoPrincipal,
      precoToleranciaAcimaPct,
      precoToleranciaAbaixoPct,
    ))
    .sort((a, b) => b.score_garimpo - a.score_garimpo || b.comissao_valor - a.comissao_valor);

  let out = filtrar(28);
  if (out.length < 2) out = filtrar(18);
  if (out.length === 0) out = filtrar(10, false);
  if (out.length === 0) {
    out = [...scored]
      .filter((o) => o.comissao_pct > 0)
      .filter((o) => precoGarimpoDentroFaixa(
        o.priceMin,
        precoPrincipal,
        precoToleranciaAcimaPct,
        precoToleranciaAbaixoPct,
      ))
      .sort((a, b) => b.score_garimpo - a.score_garimpo || b.comissao_valor - a.comissao_valor);
  }

  if (out.length === 0) {
    out = [...scored]
      .filter((o) => o.fonte === "backup_cadastrado")
      .filter((o) => o.comissao_pct > 0)
      .filter((o) => precoGarimpoDentroFaixa(
        o.priceMin,
        precoPrincipal,
        precoToleranciaAcimaPct,
        precoToleranciaAbaixoPct,
      ))
      .sort((a, b) => b.comissao_valor - a.comissao_valor || b.comissao_pct - a.comissao_pct);
  }

  if (out.length === 0 && shopId) {
    out = [...scored]
      .filter((o) => String(o.shopId) === String(shopId))
      .filter((o) => o.comissao_pct > 0)
      .filter((o) => precoGarimpoDentroFaixa(
        o.priceMin,
        precoPrincipal,
        precoToleranciaAcimaPct,
        precoToleranciaAbaixoPct,
      ))
      .sort((a, b) => b.comissao_valor - a.comissao_valor || b.comissao_pct - a.comissao_pct);
  }

  return out.slice(0, Math.min(Math.max(Number(limit) || 5, 1), 10));
}

/**
 * Garimpo contextual: Firestore → keyword (loja + global) → catálogo loja (último recurso).
 */
async function buscarGarimpoContextual({
  nome,
  nomeCompleto,
  apelido,
  shopId,
  comissaoPctPrincipal,
  precoPrincipal,
  precoToleranciaAcimaPct,
  precoToleranciaAbaixoPct,
  excludeItemIds,
  limit,
  secrets,
}) {
  const nomeRanking = String(nomeCompleto || nome || apelido || "").trim();
  const nomeBusca = String(nome || apelido || "").trim();
  if (!nomeBusca) return { termoUsado: "", termosTentados: [], ofertas: [], shopeeApiOk: false, fonte: "shopee" };

  const exclude = new Set((excludeItemIds || []).map(String));
  const { primario } = extrairTermosBuscaGarimpo(nomeRanking || nomeBusca, apelido);
  const termoKeyword = primario || nomeBusca;
  const pool = new Map();
  const maxResultados = Math.min(Math.max(Number(limit) || 5, 1), 10);
  let shopeeApiOk = false;
  let fonte = "shopee";
  let backupsNaLoja = 0;
  let backupsBloqueados = 0;
  let globalFallback = false;
  let candidatosGlobais = 0;

  const ingestir = (lista, normalizarShop = false) => {
    (lista || []).forEach((o) => {
      const itemId = String(o.itemId || "");
      if (!itemId || exclude.has(itemId)) return;
      const mapped = normalizarShop ? normalizarOfertaShopParaGarimpo(o) : o;
      const prev = pool.get(mapped.itemId);
      if (!prev) {
        pool.set(mapped.itemId, mapped);
        return;
      }
      if (!prev.imageUrl && mapped.imageUrl) prev.imageUrl = mapped.imageUrl;
      if (!prev.shopName && mapped.shopName) prev.shopName = mapped.shopName;
    });
  };

  if (shopId) {
    try {
      const fb = await buscarBackupsMesmaLojaFirestore(shopId, [...exclude]);
      backupsNaLoja = fb.totalNaLoja;
      backupsBloqueados = fb.bloqueados;
      if (fb.ofertas.length) {
        ingestir(fb.ofertas);
        fonte = "backup_cadastrado";
      }
    } catch (err) {
      console.warn("[garimpo-contextual] firestore:", err?.message || err);
    }
  }

  if (termoKeyword) {
    try {
      let batchLoja = [];
      const poolAntesKeyword = pool.size;

      if (shopId) {
        batchLoja = await buscarOfertasGarimpoKeywordRaw(termoKeyword, 15, secrets, 1, shopId);
        ingestir(batchLoja.map((o) => marcarFonteGarimpoOferta(o, shopId)));
      }

      const precisaGlobal = !shopId
        || batchLoja.length === 0
        || pool.size < maxResultados;
      if (precisaGlobal) {
        if (shopId && batchLoja.length === 0) {
          globalFallback = true;
          console.log(
            `[garimpo-contextual] Zero resultados na loja ${shopId}. Ativando Fallback Global para: "${termoKeyword}"`,
          );
        } else if (shopId && pool.size < maxResultados) {
          globalFallback = true;
          console.log(
            `[garimpo-contextual] Pool incompleto (${pool.size}/${maxResultados}). Complementando com busca global: "${termoKeyword}"`,
          );
        }

        const batchGlobal = await buscarOfertasGarimpoKeywordRaw(termoKeyword, 15, secrets, 1, null);
        const antesGlobal = pool.size;
        ingestir(batchGlobal.map((o) => marcarFonteGarimpoOferta(o, shopId)));
        candidatosGlobais = pool.size - antesGlobal;
        if (!shopId && batchGlobal.length > 0) globalFallback = true;
      }

      shopeeApiOk = true;
      if (pool.size > poolAntesKeyword && fonte === "backup_cadastrado") fonte = "misto";
      else if (pool.size > poolAntesKeyword) fonte = "shopee";
    } catch (err) {
      logErroFetchCru(err, `[garimpo-contextual] keyword "${termoKeyword}"`);
      console.warn(`[garimpo-contextual] keyword "${termoKeyword}":`, err?.message || err);
    }
  }

  if (pool.size < maxResultados && shopId) {
    try {
      const catalogoLoja = await buscarOfertasPorShopIdDireto(shopId, null, secrets, 1, 1);
      ingestir(catalogoLoja.map((o) => ({ ...o, fonte: "mesma_loja" })), false);
      shopeeApiOk = true;
      if (pool.size > 0) fonte = fonte === "backup_cadastrado" ? "misto" : "shopee";
    } catch (err) {
      logErroFetchCru(err, "[garimpo-contextual] shopId direto");
      console.warn("[garimpo-contextual] shopId direto:", err?.message || err);
    }
  }

  const ofertas = ranquearOfertasGarimpo([...pool.values()], {
    nomePrincipal: nomeRanking || nomeBusca,
    shopId,
    comissaoPctPrincipal,
    precoPrincipal,
    precoToleranciaAcimaPct,
    precoToleranciaAbaixoPct,
    limit: maxResultados,
  });

  let motivoVazio = null;
  if (ofertas.length === 0) {
    if (!shopeeApiOk) motivoVazio = "shopee_indisponivel";
    else if (backupsNaLoja > 0 && backupsBloqueados >= backupsNaLoja) motivoVazio = "todos_ja_no_grupo";
    else motivoVazio = "nenhum_na_faixa";
  }

  const ofertasOutrasLojas = ofertas.filter(
    (o) => shopId && String(o.shopId) !== String(shopId),
  ).length;

  console.log("[garimpo-contextual] resumo:", JSON.stringify({
    shopId: shopId || null,
    pool: pool.size,
    ofertas: ofertas.length,
    ofertasOutrasLojas,
    termo: termoKeyword,
    shopeeApiOk,
    fonte,
    globalFallback,
    candidatosGlobais,
    backupsNaLoja,
    backupsBloqueados,
    motivoVazio,
  }));

  return {
    termoUsado: termoKeyword,
    termosTentados: [termoKeyword].filter(Boolean),
    ofertas,
    shopeeApiOk,
    fonte,
    motivoVazio,
    backupsNaLoja,
    backupsBloqueados,
    globalFallback,
    ofertasOutrasLojas,
  };
}

/** Fallback: outros backups já salvos na mesma loja (não depende da API Shopee). */
async function buscarBackupsMesmaLojaFirestore(shopId, excludeIds) {
  const sid = String(shopId || "").trim();
  if (!sid) return { ofertas: [], totalNaLoja: 0, bloqueados: 0 };
  const exclude = new Set((excludeIds || []).map(String));
  const snap = await db.collection("backup_produtos").where("shopId", "==", sid).limit(30).get();
  const out = [];
  let totalNaLoja = 0;
  let bloqueados = 0;
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const itemId = String(d.itemId || "");
    if (!itemId) return;
    totalNaLoja += 1;
    if (exclude.has(itemId)) {
      bloqueados += 1;
      return;
    }
    const preco = Number(d.preco || d.precoMin || 0);
    const comissao_pct = Number(d.comissao_pct || 0);
    out.push({
      itemId,
      shopId: sid,
      productName: String(d.nome || d.apelido || "Produto"),
      productLink: String(d.linkProduto || ""),
      offerLink: String(d.linkAfiliado || d.linkProduto || ""),
      imageUrl: String(d.imagem || ""),
      priceMin: preco,
      comissao_pct,
      comissao_valor: (preco * comissao_pct) / 100,
      sales: Number(d.vendas_shopee || 0),
      ratingStar: Number(d.rating || 0),
      shopName: String(d.loja || ""),
      fonte: "backup_cadastrado",
    });
  });
  return { ofertas: out, totalNaLoja, bloqueados };
}

/** @deprecated prefer buscarGarimpoContextual */
async function buscarOfertasGarimpoKeyword(keyword, limit, excludeItemId, secrets) {
  const ofertas = await buscarOfertasGarimpoKeywordRaw(keyword, limit, secrets);
  return ofertas
    .filter((o) => !excludeItemId || String(o.itemId) !== String(excludeItemId))
    .sort((a, b) => b.comissao_valor - a.comissao_valor);
}

/** GraphQL com query + variables (assinatura SHA256 sobre o payload JSON completo). */
async function shopeeGraphqlCallRetry(body, secrets, maxRetries = 3) {
  const crypto = require("crypto");
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const payload = JSON.stringify(body);
      const appId = secrets.SHOPEE_APP_ID;
      const secret = secrets.SHOPEE_SECRET;
      const timestamp = Math.floor(Date.now() / 1000);
      const factor = appId + timestamp + payload + secret;
      const signature = crypto.createHash("sha256").update(factor).digest("hex");
      const response = await shopeeFetchHttp(SHOPEE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
      const text = await response.text();
      const data = JSON.parse(text);
      if (data.errors && data.errors.length > 0) {
        const codes = data.errors.map((e) => e.extensions?.code || "?").join(",");
        const isRateLimit = codes.includes("10030");
        const isSystemError = codes.includes("10000");
        if (isRateLimit || isSystemError) {
          throw new Error(`RETRY_NEEDED: ${codes}`);
        }
        throw new Error("Shopee API: " + data.errors.map((e) => e.message).join("; "));
      }
      return data;
    } catch (err) {
      lastErr = err;
      logErroFetchCru(err, `shopeeGraphqlCallRetry ${i + 1}/${maxRetries}`);
      const msg = String(err.message || err);
      const isRetryable = msg.includes("RETRY_NEEDED") || msg.match(/HTTP 5\d\d/) || msg.includes("fetch failed");
      if (!isRetryable || i === maxRetries - 1) throw err;
      const waitMs = Math.min(30000, 1000 * Math.pow(2, i));
      console.warn(`[garimpo-keyword] retry ${i + 1}/${maxRetries} em ${waitMs}ms: ${msg}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

exports.shopeeGarimpoKeyword = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 180,
    memory: "512MiB",
    maxInstances: 2,
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const nome = req.query.nome || body.nome || req.query.keyword || body.keyword;
    const nomeCompleto = req.query.nomeCompleto || body.nomeCompleto || "";
    const apelido = req.query.apelido || body.apelido || "";
    const shopId = req.query.shopId || body.shopId || "";
    const comissaoPct = req.query.comissaoPct || body.comissaoPct || 0;
    const precoPrincipal = req.query.precoPrincipal || body.precoPrincipal || 0;
    const precoToleranciaAcimaPct = req.query.precoToleranciaAcimaPct || body.precoToleranciaAcimaPct || 15;
    const precoToleranciaAbaixoPct = req.query.precoToleranciaAbaixoPct || body.precoToleranciaAbaixoPct || 25;
    const limit = req.query.limit || body.limit || 5;
    const excludeRaw = req.query.excludeItemIds || body.excludeItemIds
      || req.query.excludeItemId || body.excludeItemId || "";
    const excludeItemIds = [...new Set(
      (Array.isArray(excludeRaw) ? excludeRaw : String(excludeRaw).split(","))
        .map((s) => String(s).trim())
        .filter(Boolean),
    )];

    if (!nome || !String(nome).trim()) {
      res.status(400).json({ error: "missing_nome_or_keyword" });
      return;
    }

    try {
      const secrets = {
        SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
        SHOPEE_SECRET: process.env.SHOPEE_SECRET,
      };
      const result = await buscarGarimpoContextual({
        nome: String(nome).trim(),
        nomeCompleto: String(nomeCompleto || nome).trim(),
        apelido: String(apelido).trim(),
        shopId: shopId ? String(shopId) : "",
        comissaoPctPrincipal: Number(comissaoPct || 0),
        precoPrincipal: Number(precoPrincipal || 0),
        precoToleranciaAcimaPct: Number(precoToleranciaAcimaPct || 15),
        precoToleranciaAbaixoPct: Number(precoToleranciaAbaixoPct || 25),
        excludeItemIds,
        limit,
        secrets,
      });
      res.json({
        success: true,
        keyword: result.termoUsado,
        termosTentados: result.termosTentados,
        ofertas: result.ofertas,
        shopeeApiOk: result.shopeeApiOk !== false,
        fonte: result.fonte || "shopee",
        motivoVazio: result.motivoVazio || null,
        backupsNaLoja: result.backupsNaLoja || 0,
        backupsBloqueados: result.backupsBloqueados || 0,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

exports.shopeeAffiliateGraphql = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = body.query;
    if (!query || !String(query).trim()) {
      res.status(400).json({ success: false, error: "missing_query" });
      return;
    }

    const gqlBody = body.variables != null
      ? { query: String(query), variables: body.variables }
      : { query: String(query) };

    try {
      const result = await shopeeFetchGraphqlBody(gqlBody);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

exports.shopeeBackupSimilaresShop = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const shopId = req.query.shopId || req.body?.shopId;
    const excludeItemId = req.query.excludeItemId || req.body?.excludeItemId || "";
    if (!shopId) {
      res.status(400).json({ error: "missing_shopId" });
      return;
    }

    try {
      const similares = await buscarOfertasShopShopee(shopId, excludeItemId, {
        SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
        SHOPEE_SECRET: process.env.SHOPEE_SECRET,
      });
      res.json({ success: true, similares });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

exports.shopeeCanceladosTest = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const appId = process.env.SHOPEE_APP_ID;
    const shopeeSecret = process.env.SHOPEE_SECRET;
    const crypto = require("crypto");

    const inicio = Math.floor(new Date("2026-05-01T00:00:00-03:00").getTime() / 1000);
    const fim = Math.floor(new Date("2026-05-30T23:59:59-03:00").getTime() / 1000);

    let scrollId = "";
    let totalNet = 0;
    let totalCommission = 0;
    let totalSeller = 0;
    let totalShopeeCapped = 0;
    let totalActualAmount = 0;
    let totalNodes = 0;
    let paginas = 0;
    const statusCounts = {};
    const erros = [];

    try {
      while (paginas < 200) {
        paginas++;
        const safeScrollId = String(scrollId || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const query = `{
          conversionReport(
            purchaseTimeStart:${inicio}
            purchaseTimeEnd:${fim}
            scrollId:"${safeScrollId}"
            limit:100
          ) {
            nodes {
              totalCommission
              netCommission
              shopeeCommissionCapped
              sellerCommission
              orders {
                orderStatus
                items {
                  actualAmount
                }
              }
            }
            pageInfo {
              scrollId
              hasNextPage
            }
          }
        }`;

        const timestamp = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify({ query });
        const baseString = `${appId}${timestamp}${payload}${shopeeSecret}`;
        const signature = crypto.createHash("sha256").update(baseString).digest("hex");

        const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
          },
          body: payload,
        });

        const data = await response.json().catch(() => ({}));
        if (data.errors) {
          erros.push({ pagina: paginas, erros: data.errors });
          break;
        }

        const nodes = data?.data?.conversionReport?.nodes || [];
        const pageInfo = data?.data?.conversionReport?.pageInfo || {};

        nodes.forEach((n) => {
          for (const o of (n.orders || [])) {
            const status = String(o.orderStatus || "unknown").toUpperCase();
            statusCounts[status] = (statusCounts[status] || 0) + 1;
          }
          totalNet += Number(n.netCommission || 0);
          totalCommission += Number(n.totalCommission || 0);
          totalSeller += Number(n.sellerCommission || 0);
          totalShopeeCapped += Number(n.shopeeCommissionCapped || 0);

          (n.orders || []).forEach((o) => {
            (o.items || []).forEach((i) => {
              totalActualAmount += Number(i.actualAmount || 0);
            });
          });
        });

        totalNodes += nodes.length;

        if (!pageInfo.hasNextPage || !pageInfo.scrollId) {
          break;
        }
        scrollId = pageInfo.scrollId;

        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      erros.push({ erro: err?.message || String(err) });
    }

    const painelEsperado = 34200;

    res.json({
      success: true,
      periodo: "01/05/2026 a 30/05/2026 (igual painel Shopee do cliente)",
      paginas_processadas: paginas,
      total_conversoes: totalNodes,
      statusEncontrados: statusCounts,
      totais: {
        netCommission: totalNet.toFixed(2),
        totalCommission: totalCommission.toFixed(2),
        sellerCommission: totalSeller.toFixed(2),
        shopeeCommissionCapped: totalShopeeCapped.toFixed(2),
        actualAmount: totalActualAmount.toFixed(2),
      },
      comparacao_painel: {
        painel_shopee_mostra: `R$ ${painelEsperado.toLocaleString("pt-BR")}`,
        nosso_totalCommission: `R$ ${totalCommission.toFixed(2)}`,
        diferenca_R$: (painelEsperado - totalCommission).toFixed(2),
        diferenca_pct: totalCommission > 0 ? `${((1 - totalCommission / painelEsperado) * 100).toFixed(1)}%` : "N/A",
      },
      erros,
    });
  },
);

function gerarConclusao(r) {
  const conclusoes = [];

  const sf = r.sem_filtro;
  if (!sf || sf.erros) {
    conclusoes.push("❌ Sem filtro deu erro");
    if (sf?.erros) conclusoes.push(`Detalhe: ${sf.erros[0]?.message}`);
    return conclusoes;
  }

  conclusoes.push(`📊 60d sem filtro: ${sf.retornouNodes} conversões`);
  conclusoes.push(`   netCommission: R$ ${sf.totais_conversion.netCommission}`);
  conclusoes.push(`   itemTotalCommission: R$ ${sf.totais_item.itemTotalCommission}`);

  if (sf.temNextPage) {
    conclusoes.push("⚠️ Tem mais páginas — soma incompleta. Limite 100 pedidos.");
  }

  ["pending", "unpaid", "completed", "cancelled"].forEach((s) => {
    const d = r[s];
    if (!d || d.erros) return;
    if (d.retornouNodes > 0) {
      conclusoes.push(`📋 ${s.toUpperCase()}: ${d.retornouNodes} pedidos · netCommission R$ ${d.totais_conversion.netCommission}`);
    } else {
      conclusoes.push(`📋 ${s.toUpperCase()}: 0`);
    }
  });

  return conclusoes;
}

exports.metaDailyTest = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const token = process.env.META_ACCESS_TOKEN || "";
    const accountIds = (process.env.META_AD_ACCOUNT_IDS || "")
      .split(",")
      .flatMap((part) => {
        const m = String(part || "").match(/\d{5,}/g);
        return m && m[0] ? [m[0]] : [];
      })
      .filter(Boolean);

    if (!token) {
      res.status(500).json({ error: "META_ACCESS_TOKEN não configurado" });
      return;
    }
    if (!accountIds.length) {
      res.status(500).json({ error: "META_AD_ACCOUNT_IDS não configurado" });
      return;
    }

    const apiVersion = process.env.META_API_VERSION || "v19.0";
    const days = Math.max(1, Math.min(90, parseInt(req.query.days || "7", 10) || 7));

    const until = brtYesterdayYYYYMMDD();
    const since = brtDateMinusDays(until, days - 1);

    const actId = (id) => (String(id || "").startsWith("act_") ? String(id) : `act_${id}`);

    try {
      const fields = [
        "ad_id", "ad_name", "spend", "impressions", "clicks",
        "ctr", "cpc", "date_start", "date_stop",
      ].join(",");

      const resultadoPorConta = [];

      for (const accountId of accountIds) {
        const params = new URLSearchParams({
          access_token: token,
          level: "ad",
          fields,
          time_increment: "1",
          time_range: JSON.stringify({ since, until }),
          limit: "500",
        });

        const url = `https://graph.facebook.com/${apiVersion}/${actId(accountId)}/insights?${params}`;

        let next = url;
        const rows = [];
        let pages = 0;
        let erro = null;

        while (next && pages < 50) {
          pages++;
          const r = await fetch(next);
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.error) {
            erro = j?.error?.message || `HTTP ${r.status}`;
            break;
          }
          if (Array.isArray(j.data)) rows.push(...j.data);
          next = j?.paging?.next || null;
        }

        const porDia = {};
        let gastoConta = 0;
        rows.forEach((row) => {
          const dia = row.date_start || "?";
          if (!porDia[dia]) porDia[dia] = { dia, gasto: 0, anuncios: 0 };
          porDia[dia].gasto += parseFloat(row.spend || 0) || 0;
          porDia[dia].anuncios += 1;
          gastoConta += parseFloat(row.spend || 0) || 0;
        });

        resultadoPorConta.push({
          conta: accountId,
          total_linhas: rows.length,
          paginas: pages,
          gasto_total: gastoConta.toFixed(2),
          dias_distintos: Object.keys(porDia).length,
          erro,
          resumo_por_dia: Object.values(porDia)
            .sort((a, b) => a.dia.localeCompare(b.dia))
            .map((d) => ({ dia: d.dia, gasto: d.gasto.toFixed(2), anuncios: d.anuncios })),
          amostra: rows.slice(0, 3).map((row) => ({
            ad_name: row.ad_name,
            date_start: row.date_start,
            spend: row.spend,
            clicks: row.clicks,
            ctr: row.ctr,
          })),
        });
      }

      const contaComDados = resultadoPorConta.find((c) => c.total_linhas > 0);

      res.json({
        success: true,
        teste: "Meta Diário v2 (todas as contas)",
        total_contas: accountIds.length,
        periodo: { since, until, dias_solicitados: days },
        resultado_por_conta: resultadoPorConta,
        conclusao: contaComDados
          ? `Conta ${contaComDados.conta} retornou ${contaComDados.total_linhas} linhas diárias em ${contaComDados.dias_distintos} dias.`
          : "Nenhuma conta retornou linhas. Verificar período.",
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  },
);

async function runMetaDailySync({ daysBack }) {
  const token = process.env.META_ACCESS_TOKEN || META_ACCESS_TOKEN || "";
  const accountIds = (process.env.META_AD_ACCOUNT_IDS || "")
    .split(",")
    .flatMap((part) => {
      const m = String(part || "").match(/\d{5,}/g);
      return m && m[0] ? [m[0]] : [];
    })
    .filter(Boolean);

  if (!token) throw new Error("META_ACCESS_TOKEN não configurado");
  if (!accountIds.length) throw new Error("META_AD_ACCOUNT_IDS não configurado");

  const startedAt = Date.now();
  const { since, until, daysBack: days } = metaDailyBrtRange(daysBack);

  const fields = [
    "ad_id",
    "ad_name",
    "adset_name",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "reach",
    "date_start",
    "date_stop",
  ].join(",");

  let totalRows = 0;
  let totalGravados = 0;
  let totalIgnorados = 0;
  const errosPorConta = [];
  const allPending = [];

  for (const accountId of accountIds) {
    const params = new URLSearchParams({
      access_token: token,
      level: "ad",
      fields,
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    });
    const url = `https://graph.facebook.com/${META_API_VERSION}/${actId(accountId)}/insights?${params}`;

    let rows;
    try {
      rows = await metaFetchAll(url);
    } catch (e) {
      errosPorConta.push(`Conta ${accountId}: ${e?.message || String(e)}`);
      continue;
    }

    totalRows += rows.length;

    for (const row of rows) {
      const adId = String(row.ad_id || "").trim();
      const date = String(row.date_start || "").trim();
      if (!adId || !date) continue;

      const docId = `${adId}_${date}`;
      allPending.push({
        ref: db.collection("meta_ads_daily").doc(docId),
        payload: {
          adId,
          data: date,
          nomeAnuncio: String(row.ad_name || ""),
          subid: normalizeSubId(row.ad_name || ""),
          conjuntoAnuncios: String(row.adset_name || ""),
          campanha: String(row.campaign_name || ""),
          valorUsado: Math.round((parseFloat(row.spend || 0) || 0) * 100) / 100,
          impressoes: parseInt(row.impressions || 0, 10) || 0,
          alcance: parseInt(row.reach || 0, 10) || 0,
          cliquesTotal: parseInt(row.clicks || 0, 10) || 0,
          ctr: Math.round((parseFloat(row.ctr || 0) || 0) * 10000) / 10000,
          cpc: Math.round((parseFloat(row.cpc || 0) || 0) * 100) / 100,
          _accountId: String(accountId),
          fonte: "meta_api_daily",
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  const writeState = { batch: db.batch(), count: 0, skipped: 0 };
  const writeFlush = async (force = false) => {
    if (writeState.count >= 50 || (force && writeState.count > 0)) {
      await writeState.batch.commit();
      writeState.batch = db.batch();
      writeState.count = 0;
    }
  };
  const { gravados, ignorados } = await applyPendingWrites(writeState, writeFlush, allPending, { merge: true });
  totalGravados = gravados;
  totalIgnorados = ignorados;
  if (writeState.count > 0) await writeFlush(true);

  const elapsed = Date.now() - startedAt;
  console.log(
    `[metaDaily] fim | range ${since}→${until} | linhas=${totalRows} | gravados=${totalGravados}` +
    ` | ignorados=${totalIgnorados} | ${elapsed}ms`,
  );

  await touchMetaSyncHealth({
    lastDailySyncAt: FieldValue.serverTimestamp(),
    lastRange: { since, until, daysBack: days },
    linhas: totalRows,
    gravados: totalGravados,
    ignorados: totalIgnorados,
    erros: errosPorConta,
    elapsedMs: elapsed,
    lastDailySyncError: null,
    lastDailySyncFailedAt: null,
  }).catch(() => null);

  if (totalGravados > 0) {
    const dates = listBrtDatesInclusive(since, until);
    await bumpDailyVersionsManifest(dates, "meta");
  }

  return {
    range: { since, until, daysBack: days },
    linhas: totalRows,
    gravados: totalGravados,
    ignorados: totalIgnorados,
    erros: errosPorConta,
  };
}

exports.metaBackfillDaily = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days || "90", 10) || 90));
      const result = await runMetaDailySync({ daysBack: days });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  },
);

/** Gasto diário Meta (meta_ads_daily) — a cada 4h, últimos 7 dias até ontem (BRT). */
exports.metaDailyRecentSync = onSchedule(
  {
    // PATCH K: 6×/dia → 4×/dia. Gasto diário Meta muda devagar dentro do dia
    // (a Meta consolida fechamento em batches), 6h entre refreshes basta.
    schedule: "0 */6 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await runMetaDailySync({ daysBack: META_DAILY_RECENT_DAYS });
      console.log("[metaDailyRecentSync] OK", JSON.stringify(result?.range), "gravados=", result?.gravados);
      if (result?.range?.since && result?.range?.until) {
        const dias = [];
        let cur = result.range.since;
        while (cur <= result.range.until) {
          dias.push(cur);
          const [y, m, d] = cur.split("-").map(Number);
          const next = new Date(Date.UTC(y, m - 1, d + 1));
          cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
        }
        try {
          await refreshMonthlyBucketsForDates(db, dias, { throttleMs: 30 * 60 * 1000 });
        } catch (err) {
          console.warn("[monthlyRollup/metaRecent] falhou:", err?.message || err);
        }
      }
    } catch (e) {
      console.error("[metaDailyRecentSync] falhou:", e?.message || e);
      await touchMetaSyncHealth({
        lastDailySyncError: String(e?.message || e),
        lastDailySyncFailedAt: FieldValue.serverTimestamp(),
      }).catch(() => null);
    }
  },
);

/** Reconcile mensal leve — 04h BRT, últimos 35 dias (corrige ajustes da Meta). */
exports.metaDailyReconcile = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_IDS"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await runMetaDailySync({ daysBack: 35 });
      await touchMetaSyncHealth({
        lastReconcileAt: FieldValue.serverTimestamp(),
        lastReconcileGravados: result?.gravados || 0,
      });
      if (result?.range?.since && result?.range?.until) {
        const dias = [];
        let cur = result.range.since;
        while (cur <= result.range.until) {
          dias.push(cur);
          const [y, m, d] = cur.split("-").map(Number);
          const next = new Date(Date.UTC(y, m - 1, d + 1));
          cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
        }
        try {
          await refreshMonthlyBucketsForDates(db, dias, { throttleMs: 0 });
        } catch (err) {
          console.warn("[monthlyRollup/metaReconcile] falhou:", err?.message || err);
        }
      }
    } catch (e) {
      console.error("[metaDailyReconcile] falhou:", e?.message || e);
    }
  },
);

/** @deprecated use metaDailyRecentSync — mantido para deploys antigos */
exports.metaDailyIncrement = exports.metaDailyRecentSync;


// === ROBO DE GARIMPO V1 ===
// Garimpa produtos com alta comissao na Shopee via productOfferV2,
// cruza com historico de vendas, calcula score de oportunidade e
// gera alertas in-app pros produtos com score >= 95.

// ----------------------------------------------------------------------------
// Helper: chamada Shopee com retry exponencial em rate limit / 5xx
// ----------------------------------------------------------------------------
async function shopeeApiCallRetry(query, secrets, maxRetries = 3) {
  const crypto = require("crypto");
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const payload = JSON.stringify({ query });
      const appId = secrets.SHOPEE_APP_ID;
      const secret = secrets.SHOPEE_SECRET;
      const timestamp = Math.floor(Date.now() / 1000);
      const factor = appId + timestamp + payload + secret;
      const signature = crypto.createHash("sha256").update(factor).digest("hex");
      const response = await shopeeFetchHttp(SHOPEE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body: payload,
      });
      const text = await response.text();
      const data = JSON.parse(text);
      if (data.errors && data.errors.length > 0) {
        const codes = data.errors.map((e) => e.extensions?.code || "?").join(",");
        const isRateLimit = codes.includes("10030");
        const isSystemError = codes.includes("10000");
        if (isRateLimit || isSystemError) {
          throw new Error(`RETRY_NEEDED: ${codes}`);
        }
        throw new Error("Shopee API: " + data.errors.map((e) => e.message).join("; "));
      }
      return data;
    } catch (err) {
      lastErr = err;
      logErroFetchCru(err, `shopeeApiCallRetry ${i + 1}/${maxRetries}`);
      const msg = String(err.message || err);
      const isRetryable = msg.includes("RETRY_NEEDED") || msg.match(/HTTP 5\d\d/) || msg.includes("fetch failed");
      if (!isRetryable || i === maxRetries - 1) throw err;
      const waitMs = Math.min(30000, 1000 * Math.pow(2, i));
      console.warn(`[garimpo] retry ${i + 1}/${maxRetries} em ${waitMs}ms: ${msg}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ----------------------------------------------------------------------------
// Cross-reference: monta mapa itemId -> historico de vendas
// ----------------------------------------------------------------------------
async function buildHistoricoMap(itemIds) {
  const map = {};
  if (!itemIds || itemIds.length === 0) return map;
  // Firestore "in" aceita maximo 30 valores por query
  for (let i = 0; i < itemIds.length; i += 30) {
    const chunk = itemIds.slice(i, i + 30);
    const snap = await db.collection("produtos")
      .where("id_item", "in", chunk.map(String))
      .get();
    snap.forEach((doc) => {
      const d = doc.data();
      map[String(d.id_item)] = {
        ja_vendi: true,
        minhas_vendas: Number(d.vendas || 0),
        minha_comissao_historica: Number(d.comissao_total || 0),
        meu_gmv_historico: Number(d.gmv_total || 0),
        ultima_venda: d.updatedAt?.toDate?.()?.toISOString?.()?.split("T")?.[0] || null,
      };
    });
  }
  return map;
}

// ----------------------------------------------------------------------------
// Score de oportunidade 0-100
// ----------------------------------------------------------------------------
function calcularScore(p) {
  // Pesos:
  //   comissao_pct: ate 40 pts (10% comissao = 40 pts)
  //   popularidade: ate 25 pts (log10 das vendas)
  //   rating:       ate 15 pts (rating 5 = 15 pts, rating 4 = 10 pts)
  //   ja_vendi:     ate 15 pts (se ja vendeu, baseado em qtd)
  //   shop_mall:    5 pts (se Mall, type 1)
  let score = 0;
  const motivos = [];

  const comissaoScore = Math.min(40, (p.comissao_pct || 0) * 4);
  score += comissaoScore;
  if (p.comissao_pct >= 10) motivos.push(`comissao alta (${p.comissao_pct.toFixed(1)}%)`);

  const vendas = Number(p.vendas_shopee || 0);
  const popScore = vendas > 0 ? Math.min(25, Math.log10(vendas + 1) * 6) : 0;
  score += popScore;
  if (vendas >= 1000) motivos.push(`popular (${vendas} vendas)`);

  const rating = Number(p.rating || 0);
  if (rating > 0) {
    score += Math.max(0, Math.min(15, (rating - 3.5) * 10));
    if (rating >= 4.7) motivos.push(`rating ${rating.toFixed(1)}`);
  }

  if (p.ja_vendi) {
    const meuScore = Math.min(15, Math.log10((p.minhas_vendas || 0) + 1) * 6);
    score += meuScore;
    motivos.push(`voce ja vende (${p.minhas_vendas} vendas)`);
    if (Number(p.minhas_vendas || 0) >= 3 && Number(p.comissao_valor || 0) >= 2) {
      score += 12;
      motivos.push("tracao sua + comissao R$ solida");
    }
  }

  if (Array.isArray(p.shop_type) && p.shop_type.includes(1)) {
    score += 5;
    motivos.push("Shopee Mall");
  }

  return {
    score: Math.round(Math.min(100, score)),
    motivos,
  };
}

// ----------------------------------------------------------------------------
// Nucleo do garimpo
// ----------------------------------------------------------------------------
async function runShopeeGarimpo({ secrets, maxPaginas = 5 }) {
  const startedAt = Date.now();
  const hojeStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split("T")[0];
  const todosProdutos = [];

  // Pagina productOfferV2 ordenado por comissao (sortType=5)
  for (let page = 1; page <= maxPaginas; page++) {
    const query = `{
      productOfferV2(sortType: 5, page: ${page}, limit: 50) {
        nodes {
          itemId shopId productName productLink offerLink imageUrl
          priceMin priceMax sales ratingStar
          commissionRate sellerCommissionRate shopeeCommissionRate commission
          shopName shopType periodStartTime periodEndTime
        }
        pageInfo { hasNextPage }
      }
    }`;
    let data;
    try {
      data = await shopeeApiCallRetry(query, secrets);
    } catch (err) {
      console.error(`[garimpo] page ${page} falhou: ${err.message}`);
      break;
    }
    const offer = data?.data?.productOfferV2 || {};
    const nodes = offer.nodes || [];
    console.log(`[garimpo] page ${page}: +${nodes.length} (acumulado: ${todosProdutos.length + nodes.length})`);
    nodes.forEach((n) => {
      todosProdutos.push({
        itemId: String(n.itemId || ""),
        shopId: String(n.shopId || ""),
        nome: String(n.productName || ""),
        link_produto: String(n.productLink || ""),
        link_afiliado: String(n.offerLink || ""),
        imagem: String(n.imageUrl || ""),
        preco_min: Number(n.priceMin || 0),
        preco_max: Number(n.priceMax || 0),
        desconto_pct: (Number(n.priceMax || 0) > Number(n.priceMin || 0) && Number(n.priceMax || 0) > 0)
          ? Math.round(((Number(n.priceMax) - Number(n.priceMin)) / Number(n.priceMax)) * 1000) / 10
          : 0,
        vendas_shopee: Number(n.sales || 0),
        rating: Number(n.ratingStar || 0),
        comissao_pct: Number(n.commissionRate || 0) * 100,
        comissao_pct_seller: Number(n.sellerCommissionRate || 0) * 100,
        comissao_pct_shopee: Number(n.shopeeCommissionRate || 0) * 100,
        comissao_valor: Number(n.commission || 0),
        shop_name: String(n.shopName || ""),
        shop_type: Array.isArray(n.shopType) ? n.shopType : [],
        periodo_inicio: n.periodStartTime ? Number(n.periodStartTime) : null,
        periodo_fim: n.periodEndTime ? Number(n.periodEndTime) : null,
      });
    });
    if (!offer.pageInfo?.hasNextPage) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[garimpo] total raw: ${todosProdutos.length}`);

  // Cross-reference com historico
  const itemIds = todosProdutos.map((p) => p.itemId).filter(Boolean);
  const historico = await buildHistoricoMap(itemIds);
  console.log(`[garimpo] match com historico: ${Object.keys(historico).length}`);

  // Calcula score e prepara docs
  const produtosEnriquecidos = todosProdutos.map((p) => {
    const hist = historico[p.itemId] || { ja_vendi: false };
    const enriquecido = { ...p, ...hist };
    const { score, motivos } = calcularScore(enriquecido);
    return { ...enriquecido, score_oportunidade: score, motivos };
  });

  // Grava em garimpo_produtos (usa state.batch reaproveitando padrao)
  const state = { batch: db.batch(), count: 0 };
  const flush = async (force = false) => {
    if (state.count >= 50 || (force && state.count > 0)) {
      await state.batch.commit();
      state.batch = db.batch();
      state.count = 0;
    }
  };

  const ontemStr = new Date(Date.now() - 3 * 3600 * 1000 - 86400000).toISOString().split("T")[0];
  const prevMap = {};
  try {
    const prevSnap = await db.collection("garimpo_produtos")
      .where("data_garimpo", "==", ontemStr)
      .limit(500)
      .get();
    prevSnap.forEach((d) => {
      const x = d.data() || {};
      if (x.itemId) prevMap[String(x.itemId)] = x;
    });
  } catch (err) {
    console.warn("[garimpo] snapshot ontem indisponivel:", err?.message || err);
  }

  for (const p of produtosEnriquecidos) {
    if (!p.itemId) continue;
    const docId = `${hojeStr}_${p.itemId}`;
    const ref = db.collection("garimpo_produtos").doc(docId);
    const prev = prevMap[String(p.itemId)];
    const prevFields = prev ? {
      prev_comissao_pct: Number(prev.comissao_pct || 0),
      prev_score: Number(prev.score_oportunidade || 0),
      prev_preco_min: Number(prev.preco_min || 0),
      delta_comissao_pct: Number(p.comissao_pct || 0) - Number(prev.comissao_pct || 0),
      delta_score: Number(p.score_oportunidade || 0) - Number(prev.score_oportunidade || 0),
    } : {};
    state.batch.set(ref, {
      ...p,
      ...prevFields,
      data_garimpo: hojeStr,
      timestamp: FieldValue.serverTimestamp(),
    });
    state.count++;
    await flush();
  }
  await flush(true);

  // === ALERTAS DUAS CATEGORIAS V2 ===
  // Dois buckets de alertas:
  //   1. ja_vendo:   score >= 95 + ja_vendi=true (sniper - urgencia, comissao subiu em produto seu)
  //   2. descoberta: score >= 85 + ja_vendi=false + vendas_shopee >= 1000 + comissao_pct >= 8
  //                  (descoberta - produtos novos com potencial)
  // Cada bucket tem dedup proprio (7 dias por itemId+categoria) e cap (5/execucao).
  const candidatosJaVendo = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 95 && p.ja_vendi
  );
  const candidatosDescoberta = produtosEnriquecidos.filter((p) =>
    p.score_oportunidade >= 85 &&
    !p.ja_vendi &&
    Number(p.vendas_shopee || 0) >= 1000 &&
    Number(p.comissao_pct || 0) >= 8
  );
  // Ordena descobertas por score desc pra pegar os melhores primeiro
  candidatosDescoberta.sort((a, b) => b.score_oportunidade - a.score_oportunidade);

  console.log(`[garimpo] candidatos: ja_vendo=${candidatosJaVendo.length} descoberta=${candidatosDescoberta.length}`);

  const seteDiasAtras = new Date(Date.now() - 7 * 86400 * 1000);

  async function gerarAlertas(candidatos, categoria, capMax = 5) {
    let gravados = 0;
    for (const p of candidatos) {
      if (gravados >= capMax) {
        console.log(`[garimpo] cap atingido pra ${categoria} (${capMax})`);
        break;
      }
      // Dedup: por itemId + categoria, ultimos 7 dias
      const recentSnap = await db.collection("garimpo_alertas")
        .where("itemId", "==", p.itemId)
        .where("categoria", "==", categoria)
        .where("createdAt", ">=", seteDiasAtras)
        .limit(1)
        .get();
      if (!recentSnap.empty) {
        console.log(`[garimpo] dedup ${categoria}: pulando ${p.itemId}`);
        continue;
      }
      const ref = db.collection("garimpo_alertas").doc();
      await ref.set({
        tipo: "score_alto",
        categoria, // "ja_vendo" ou "descoberta"
        itemId: p.itemId,
        shopId: p.shopId,
        nome: p.nome,
        imagem: p.imagem,
        comissao_pct: p.comissao_pct,
        comissao_valor: p.comissao_valor,
        preco_min: p.preco_min,
        vendas_shopee: p.vendas_shopee,
        minhas_vendas: p.minhas_vendas || 0,
        ja_vendi: !!p.ja_vendi,
        score: p.score_oportunidade,
        motivos: p.motivos,
        link_afiliado: p.link_afiliado,
        shop_name: p.shop_name,
        lido: false,
        arquivado: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      gravados++;
    }
    return gravados;
  }

  const alertasJaVendo = await gerarAlertas(candidatosJaVendo, "ja_vendo", 5);
  const alertasDescoberta = await gerarAlertas(candidatosDescoberta, "descoberta", 5);
  const alertasGravados = alertasJaVendo + alertasDescoberta;

  const duracaoMs = Date.now() - startedAt;
  console.log(`[garimpo] fim | produtos=${produtosEnriquecidos.length} | alertas=${alertasGravados} (ja_vendo=${alertasJaVendo} descoberta=${alertasDescoberta}) | ${duracaoMs}ms`);

  return {
    produtos: produtosEnriquecidos.length,
    matchHistorico: Object.keys(historico).length,
    alertas: alertasGravados,
    duracaoMs,
  };
}

// ----------------------------------------------------------------------------
// Scheduled: 5h da manha BRT (depois do reconcile das 4h)
// ----------------------------------------------------------------------------
exports.shopeeGarimpoDaily = onSchedule(
  {
    schedule: "0 5 * * *",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      await runShopeeGarimpo({
        secrets: {
          SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
          SHOPEE_SECRET: process.env.SHOPEE_SECRET,
        },
        maxPaginas: 5,
      });
    } catch (e) {
      console.error("[garimpo] daily falhou:", e?.message || e);
    }
  }
);

// ----------------------------------------------------------------------------
// HTTP: trigger manual pra testar
//   curl -X POST -H "Authorization: Bearer <META_SYNC_SECRET>" \
//     "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeGarimpoNow"
// ----------------------------------------------------------------------------
async function runShopeeGarimpoRecompra({ secrets, topN = 20 }) {
  const snap = await db.collection("produtos").limit(400).get();
  const ranked = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    ranked.push({ docSnap, score: Number(d.comissao_total || 0) });
  });
  ranked.sort((a, b) => b.score - a.score);
  const topDocs = ranked.slice(0, topN);
  const hojeStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().split("T")[0];
  let gravados = 0;
  for (const { docSnap } of topDocs) {
    const d = docSnap.data() || {};
    const itemId = String(d.id_item || "");
    const shopId = String(d.id_loja || "");
    if (!itemId || !shopId) continue;
    try {
      const node = await shopeeQueryProduct(itemId, shopId);
      if (!node) continue;
      const p = normalizeShopeeProduct(node);
      await db.collection("garimpo_recompra").doc(`${hojeStr}_${itemId}`).set({
        ...p,
        minhas_vendas: Number(d.vendas || 0),
        minha_comissao_historica: Number(d.comissao_total || 0),
        ja_vendi: true,
        data_garimpo: hojeStr,
        timestamp: FieldValue.serverTimestamp(),
      });
      gravados++;
    } catch (err) {
      console.warn(`[garimpo-recompra] ${itemId}:`, err?.message || err);
    }
    await new Promise((r) => setTimeout(r, SHOPEE_NEW_QUERY_DELAY_MS));
  }
  return { gravados, topN };
}

exports.shopeeGarimpoRecompraWeekly = onSchedule(
  {
    schedule: "0 4 * * 1",
    timeZone: "America/Sao_Paulo",
    secrets: ["SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      const result = await runShopeeGarimpoRecompra({
        secrets: {
          SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
          SHOPEE_SECRET: process.env.SHOPEE_SECRET,
        },
        topN: 20,
      });
      console.log("[garimpo-recompra] weekly:", JSON.stringify(result));
    } catch (e) {
      console.error("[garimpo-recompra] weekly falhou:", e?.message || e);
    }
  },
);

exports.shopeeGarimpoNow = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const provided = String(req.get("authorization") || "").trim();
    const secret = (process.env.META_SYNC_SECRET || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const maxPaginas = Math.max(1, Math.min(20, parseInt(req.query.pages || "5", 10) || 5));
      const result = await runShopeeGarimpo({
        secrets: {
          SHOPEE_APP_ID: process.env.SHOPEE_APP_ID,
          SHOPEE_SECRET: process.env.SHOPEE_SECRET,
        },
        maxPaginas,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  SHOPEE VALIDATED REPORT — comissões LIQUIDADAS (valores oficiais)
//
//  Diferença vs conversionReport:
//    conversionReport → valores ESTIMADOS (totalCommission), oscilam
//    validatedReport  → valores VALIDADOS (após auditoria Shopee), definitivos
//
//  Requer SHOPEE_VALIDATION_ID configurado como secret. Sem ele, função
//  retorna vazio sem quebrar.
//
//  Como obter validationId:
//    1. Acessar https://affiliate.shopee.com.br
//    2. Ir em "Billing Information" / "Informações de Faturamento"
//    3. Cada período de validação tem um ID único listado
//    4. firebase functions:secrets:set SHOPEE_VALIDATION_ID
// ═══════════════════════════════════════════════════════════════════════════

function buildValidatedQuery(validationId, scrollId) {
  const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
  const validationClause = validationId ? `validationId: ${validationId}, ` : "";
  return `{
    validatedReport(
      ${validationClause}
      limit: ${SHOPEE_PAGE_LIMIT}${scrollClause}
    ) {
      nodes {
        conversionId
        purchaseTime
        clickTime
        totalCommission
        netCommission
        shopeeCommissionCapped
        sellerCommission
        mcnManagementFee
        utmContent
        orders {
          orderId
          orderStatus
          items {
            itemId
            itemName
            completeTime
            actualAmount
            refundAmount
            qty
            itemTotalCommission
            fraudStatus
            shopId
            shopName
          }
        }
      }
      pageInfo { hasNextPage scrollId }
    }
  }`;
}

async function shopeeValidatedPullAll(validationId) {
  const allNodes = [];
  const seenKeys = new Set();
  let duplicates = 0;
  let scrollId = null;
  let hasNext = true;
  let pageCount = 0;
  let scrollRestarts = 0;

  while (hasNext && pageCount < SHOPEE_MAX_PAGES) {
    pageCount++;
    if (!scrollId) await waitNoScrollInterval("shopee-validated");
    const query = buildValidatedQuery(validationId, scrollId);
    let data;
    try {
      data = await shopeeFetch(query);
    } catch (err) {
      const msg = String(err?.message || err);
      if (pageCount === 1 || !/scroll|11001|params/i.test(msg)) {
        console.warn(`[shopee-validated] erro: ${msg}`);
        return { allNodes: [], pageCount, duplicates };
      }
      scrollRestarts++;
      if (scrollRestarts > SHOPEE_MAX_SCROLL_RESTARTS) {
        console.warn(`[shopee-validated] scroll_expired_restart limite (${scrollRestarts}) — abortando`);
        break;
      }
      console.warn(`[shopee-validated] scroll_expired_restart pág ${pageCount} (${scrollRestarts}/${SHOPEE_MAX_SCROLL_RESTARTS})`);
      scrollId = null;
      hasNext = true;
      pageCount = 0;
      await waitNoScrollInterval("shopee-validated_restart");
      continue;
    }
    const report = data?.validatedReport || {};
    const nodes = report.nodes || [];

    let pageNew = 0;
    for (const node of nodes) {
      const cid = String(node?.conversionId || "").trim();
      const orderId = String(node?.orders?.[0]?.orderId || "").trim();
      const key = (cid && orderId)
        ? `${cid}__${orderId}`
        : (cid || `__noid_${node?.purchaseTime || ""}_${orderId}`);
      if (key && seenKeys.has(key)) { duplicates++; continue; }
      if (key) seenKeys.add(key);
      allNodes.push(node);
      pageNew++;
    }

    const pi = report.pageInfo || {};
    hasNext = pi.hasNextPage === true;
    const novoScrollId = pi.scrollId || null;
    console.log(`[shopee-validated] página ${pageCount}: +${nodes.length} (${pageNew} novas, ${nodes.length - pageNew} dup) | total: ${allNodes.length}`);

    if (hasNext && novoScrollId === scrollId && novoScrollId !== null) break;
    scrollId = novoScrollId;
    if (hasNext && !scrollId) break;
    if (hasNext) await shopeeSleep(SHOPEE_PAGE_DELAY_MS);
  }

  if (duplicates > 0) console.warn(`[shopee-validated] ⚠️ ${duplicates} duplicatas removidas`);
  return { allNodes, pageCount, duplicates, scrollRestarts };
}

function agruparValidatedPorData(nodes) {
  const dayMap = {};

  for (const node of nodes) {
    const conversionId = String(node.conversionId || "").trim();
    const totalCommissionConv = parseFloat(node.totalCommission || "0") || 0;
    const netCommissionConv = parseFloat(node.netCommission || "0") || 0;
    const mcnFeeConv = parseFloat(node.mcnManagementFee || "0") || 0;
    const orders = node.orders || [];
    if (!orders.length) continue;

    // Para validatedReport, usa completeTime do primeiro item válido
    let dataValidacao = null;
    for (const ord of orders) {
      for (const it of (ord.items || [])) {
        if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
        const ct = it.completeTime;
        const ctDate = ct ? formatUnixToBRTDate(ct) : null;
        if (ctDate) { dataValidacao = ctDate; break; }
      }
      if (dataValidacao) break;
    }
    if (!dataValidacao) {
      const pt = node.purchaseTime;
      dataValidacao = pt ? formatUnixToBRTDate(pt) : null;
    }
    if (!dataValidacao) continue;

    let refundTotal = 0;
    let actualTotal = 0;
    let qtyTotal = 0;
    for (const ord of orders) {
      for (const it of (ord.items || [])) {
        if (String(it.fraudStatus || "").toUpperCase() === "FRAUD") continue;
        const qty = parseInt(it.qty, 10) || 1;
        refundTotal += parseFloat(it.refundAmount || "0") || 0;
        actualTotal += parseFloat(it.actualAmount || "0") || 0;
        qtyTotal += qty;
      }
    }

    if (!dayMap[dataValidacao]) {
      dayMap[dataValidacao] = {
        data: dataValidacao,
        conversoes_validadas: 0,
        comissao_total_validada: 0,
        comissao_liquidada: 0,
        mcn_fee_total: 0,
        faturamento_liquidado: 0,
        refund_total: 0,
        itens_liquidados: 0,
        _conversoesVistas: new Set(),
      };
    }

    if (conversionId && dayMap[dataValidacao]._conversoesVistas.has(conversionId)) continue;
    if (conversionId) dayMap[dataValidacao]._conversoesVistas.add(conversionId);

    const d = dayMap[dataValidacao];
    d.conversoes_validadas += 1;
    d.comissao_total_validada += totalCommissionConv;
    d.comissao_liquidada += netCommissionConv;
    d.mcn_fee_total += mcnFeeConv;
    d.faturamento_liquidado += (actualTotal - refundTotal);
    d.refund_total += refundTotal;
    d.itens_liquidados += qtyTotal;
  }

  for (const date in dayMap) delete dayMap[date]._conversoesVistas;
  return dayMap;
}

async function runShopeeValidatedSync({ label = "validated_sync" }) {
  const startedAt = Date.now();
  const validationId = (process.env.SHOPEE_VALIDATION_ID || "").trim();
  const metaRef = db.collection("config").doc("validated_sync");

  if (!validationId) {
    console.warn("[shopee-validated] SHOPEE_VALIDATION_ID não configurado — pulando");
    await metaRef.set({
      validationIdConfigured: false,
      lastRunAt: FieldValue.serverTimestamp(),
      lastLabel: label,
      lastStatus: "skipped",
      lastReason: "no_validation_id",
      lastError: null,
    }, { merge: true });
    return { skipped: true, reason: "no_validation_id" };
  }

  const importRef = db.collection("importacoes").doc();
  const importacaoId = importRef.id;
  console.log(`[shopee-validated] início ${label} | validationId=${validationId} | importacaoId=${importacaoId}`);

  const { allNodes, pageCount } = await shopeeValidatedPullAll(validationId);
  const dayMap = agruparValidatedPorData(allNodes);

  let batch = db.batch();
  let count = 0;
  const flush = async (force = false) => {
    if (count >= 50 || (force && count > 0)) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  };

  let gravados = 0;
  for (const [date, totais] of Object.entries(dayMap)) {
    const ref = db.collection("shopee_validated_daily").doc(date);
    batch.set(ref, {
      ...totais,
      validationId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    count++; gravados++;
    await flush();
  }

  batch.set(importRef, {
    tipo: "shopee_validated",
    fonte: "api_backend",
    validationId,
    status: "sucesso",
    linhasProcessadas: allNodes.length,
    diasGravados: gravados,
    duracaoMs: Date.now() - startedAt,
    paginas: pageCount,
    importadoEm: FieldValue.serverTimestamp(),
  });
  count++;
  await flush(true);

  console.log(`[shopee-validated] fim ${label} | nodes=${allNodes.length} | dias=${gravados} | ${Date.now() - startedAt}ms`);

  await metaRef.set({
    validationIdConfigured: true,
    validationId: String(validationId),
    lastRunAt: FieldValue.serverTimestamp(),
    lastLabel: label,
    lastStatus: gravados > 0 ? "ok" : "empty",
    lastNodes: allNodes.length,
    lastDiasGravados: gravados,
    lastImportacaoId: importacaoId,
    lastError: null,
  }, { merge: true });

  return { importacaoId, nodes: allNodes.length, diasGravados: gravados, paginas: pageCount };
}

// Fechamento validado desativado no app — não exportar schedule (evita exigir SHOPEE_VALIDATION_ID).
// exports.shopeeValidatedDailySync = onSchedule(...)

// HTTP manual desativado junto com o menu Fechamento no front.
// exports.shopeeValidatedBackfillNow = onRequest(...)

/**
 * shopeeDiagnostico — endpoint de diagnóstico cru.
 *
 * Puxa TODOS os nodes do conversionReport para um dia (sem dedup,
 * sem agregação, sem filtros), e devolve estatísticas matemáticas
 * para comparar com o painel da Shopee.
 *
 * Uso:
 *   curl -X POST "https://shopeediagnostico-XXXXX-rj.a.run.app/?date=2026-06-02" \
 *        -H "Authorization: Bearer SEU_META_SYNC_SECRET"
 */
exports.shopeeDiagnostico = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "southamerica-east1",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const dateStr = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: "date inválido (use YYYY-MM-DD)" });
    }

    // Range em BRT (UTC-3) — igual ao sync de produção
    const startTs = Math.floor(new Date(`${dateStr}T00:00:00-03:00`).getTime() / 1000);
    const endTs = Math.floor(new Date(`${dateStr}T23:59:59-03:00`).getTime() / 1000);

    const rawNodes = [];
    let scrollId = null;
    let hasNext = true;
    let pageCount = 0;
    const SHOPEE_LIMIT = 500;
    const MAX_PAGES = 50;
    const erros = [];

    try {
      while (hasNext && pageCount < MAX_PAGES) {
        pageCount++;
        if (!scrollId) await waitNoScrollInterval(`diag_${dateStr}`);
        const scrollClause = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : "";
        const query = `{
          conversionReport(
            limit: ${SHOPEE_LIMIT},
            purchaseTimeStart: ${startTs},
            purchaseTimeEnd: ${endTs}${scrollClause}
          ) {
            nodes {
              conversionId
              purchaseTime
              totalCommission
              netCommission
              shopeeCommissionCapped
              sellerCommission
              mcnManagementFee
              linkedMcnName
              orders {
                orderId
                orderStatus
                shopType
                items {
                  itemId
                  itemName
                  actualAmount
                  qty
                  itemTotalCommission
                  itemSellerCommission
                  itemShopeeCommissionCapped
                  fraudStatus
                  displayItemStatus
                }
              }
            }
            pageInfo { hasNextPage scrollId }
          }
        }`;

        let data;
        try {
          data = await shopeeFetch(query);
        } catch (err) {
          erros.push({ pagina: pageCount, erro: String(err?.message || err) });
          break;
        }

        const report = data?.conversionReport || {};
        const nodes = report.nodes || [];
        for (const n of nodes) rawNodes.push(n);

        const pi = report.pageInfo || {};
        hasNext = pi.hasNextPage === true;
        scrollId = pi.scrollId || null;
        if (hasNext && !scrollId) break;
        if (hasNext) await shopeeSleep(200);
      }
    } catch (err) {
      erros.push({ erro_geral: String(err?.message || err) });
    }

    // ============ ANÁLISE MATEMÁTICA ============
    const conversionIds = new Set();
    const orderIds = new Set();
    const conversionIdOrderIdPairs = new Set();
    const duplicatasExatas = [];
    const multiOrderConversions = {};

    let totalCommissionSum = 0;
    let netCommissionSum = 0;
    let actualAmountSum = 0;
    let qtyTotal = 0;
    let itemTotalCommissionSum = 0;
    let itemSellerCommissionSum = 0;
    let itemShopeeCommissionCappedSum = 0;
    let nodesComMultiplosOrders = 0;
    let nodesComMultiplosItems = 0;
    let ordersTotal = 0;
    let itemsTotal = 0;

    const orderStatusCount = {};

    for (const n of rawNodes) {
      const cid = String(n?.conversionId || "").trim();
      const orders = n?.orders || [];
      ordersTotal += orders.length;
      if (orders.length > 1) nodesComMultiplosOrders++;

      if (cid) conversionIds.add(cid);

      for (const o of orders) {
        const ostatus = String(o?.orderStatus || "unknown").toUpperCase();
        orderStatusCount[ostatus] = (orderStatusCount[ostatus] || 0) + 1;
      }

      totalCommissionSum += Number(n?.totalCommission || 0);
      netCommissionSum += Number(n?.netCommission || 0);

      for (const o of orders) {
        const oid = String(o?.orderId || "").trim();
        if (oid) orderIds.add(oid);
        if (cid && oid) {
          const pair = `${cid}__${oid}`;
          if (conversionIdOrderIdPairs.has(pair)) {
            duplicatasExatas.push({ cid, oid });
          }
          conversionIdOrderIdPairs.add(pair);

          if (!multiOrderConversions[cid]) multiOrderConversions[cid] = new Set();
          multiOrderConversions[cid].add(oid);
        }

        const items = o?.items || [];
        itemsTotal += items.length;
        if (items.length > 1) nodesComMultiplosItems++;
        for (const it of items) {
          actualAmountSum += Number(it?.actualAmount || 0);
          qtyTotal += Number(it?.qty || 0);
          itemTotalCommissionSum += parseItemTotalCommission(it);
          itemSellerCommissionSum += Number(it?.itemSellerCommission || 0);
          itemShopeeCommissionCappedSum += Number(it?.itemShopeeCommissionCapped || 0);
        }
      }
    }

    const cidsComMultiplosOrderIds = Object.entries(multiOrderConversions)
      .filter(([, set]) => set.size > 1)
      .map(([cid, set]) => ({ cid, qtdOrderIds: set.size }));

    res.json({
      data: dateStr,
      range_brt: { start: startTs, end: endTs },
      paginas_buscadas: pageCount,
      erros,

      contagem: {
        nodes_brutos_da_api: rawNodes.length,
        conversionIds_unicos: conversionIds.size,
        orderIds_unicos: orderIds.size,
        pares_cid_oid_unicos: conversionIdOrderIdPairs.size,
        nodes_com_multiplos_orders: nodesComMultiplosOrders,
        nodes_com_multiplos_items: nodesComMultiplosItems,
        cids_com_multiplos_orderIds: cidsComMultiplosOrderIds.length,
        orders_total_flat: ordersTotal,
        items_total_flat: itemsTotal,
        duplicatas_exatas: duplicatasExatas.length,
      },

      totais_financeiros: {
        totalCommission_soma: Number(totalCommissionSum.toFixed(2)),
        netCommission_soma: Number(netCommissionSum.toFixed(2)),
        actualAmount_soma: Number(actualAmountSum.toFixed(2)),
        qty_total: qtyTotal,
        itemTotalCommission_soma: Number(itemTotalCommissionSum.toFixed(2)),
        itemSellerCommission_soma: Number(itemSellerCommissionSum.toFixed(2)),
        itemShopeeCommissionCapped_soma: Number(itemShopeeCommissionCappedSum.toFixed(2)),
      },

      status_count_order: orderStatusCount,

      amostra_cids_multi_orders: cidsComMultiplosOrderIds.slice(0, 10),
      amostra_duplicatas_exatas: duplicatasExatas.slice(0, 10),

      comparacao_painel: {
        painel_diz: {
          pedidos: 664,
          comissao_total: 1917.31,
          faturamento: 38251.16,
        },
        api_diz: {
          conversionIds_unicos: conversionIds.size,
          orderIds_unicos: orderIds.size,
          totalCommission: Number(totalCommissionSum.toFixed(2)),
          actualAmount: Number(actualAmountSum.toFixed(2)),
        },
        gap_pedidos_vs_orderIds: 664 - orderIds.size,
        gap_pedidos_vs_conversionIds: 664 - conversionIds.size,
        gap_comissao: Number((1917.31 - totalCommissionSum).toFixed(2)),
        gap_faturamento: Number((38251.16 - actualAmountSum).toFixed(2)),
      },
    });
  },
);

/**
 * shopeeBackfillRange — re-sincroniza um intervalo de datas, dia por dia,
 * em sequência, respeitando o limite de 31s entre queries da API Shopee.
 *
 * Cada dia leva ~100-120s. Para 34 dias = ~60 min de execução.
 * Como Cloud Function tem timeout de 540s (9 min), processa em "chunks"
 * de até 4 dias por invocação e retorna o cursor para continuar.
 */
exports.shopeeBackfillRange = onRequest(
  {
    secrets: ["META_SYNC_SECRET", "SHOPEE_APP_ID", "SHOPEE_SECRET"],
    timeoutSeconds: 540,
    memory: "1GiB",
    region: "southamerica-east1",
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const secret = (process.env.META_SYNC_SECRET || "").trim();
    const provided = String(req.get("authorization") || "").trim();
    if (!secret || provided !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: "use startDate e endDate em YYYY-MM-DD" });
    }

    const days = [];
    let cur = startDate;
    while (cur <= endDate) {
      days.push(cur);
      const [y, m, d] = cur.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    }

    const MAX_DIAS_POR_INVOCACAO = 4;
    const fatia = days.slice(0, MAX_DIAS_POR_INVOCACAO);
    const restante = days.slice(MAX_DIAS_POR_INVOCACAO);

    const processados = [];
    const erros = [];

    for (let i = 0; i < fatia.length; i++) {
      const dia = fatia[i];
      try {
        if (i > 0) await waitNoScrollInterval(`backfillRange_${dia}`);

        const startTs = Math.floor(new Date(`${dia}T00:00:00-03:00`).getTime() / 1000);
        const endTs = Math.floor(new Date(`${dia}T23:59:59-03:00`).getTime() / 1000);

        console.log(`[backfillRange] processando ${dia} (${startTs}..${endTs})`);

        const resultado = await runShopeeSync({
          startTs,
          endTs,
          label: `refresh_range_${dia}`,
          updateCursor: false,
          forceReplace: true,
          updateDaily: true,
          dailyOnly: true,
          dateFilter: { type: "dates", dates: new Set([dia]) },
        });

        processados.push({ dia, ...resultado });
      } catch (err) {
        const msg = String(err?.message || err);
        console.error(`[backfillRange] erro em ${dia}: ${msg}`);
        erros.push({ dia, erro: msg });
      }
    }

    res.json({
      processados,
      erros,
      proximo: restante[0] || null,
      continuar: restante.length > 0,
      restantes: restante.length,
      total_restante: restante,
    });
  },
);

// === Função temporária de contagem (REMOVER APÓS USO) ===
exports.contarDocs = require("./admin/contarDocs").contarDocs;
exports.rebuildMonthlyBuckets = require("./admin/rebuildMonthlyBuckets").rebuildMonthlyBuckets;

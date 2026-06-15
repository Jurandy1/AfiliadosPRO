#!/usr/bin/env node
/**
 * meta-shopee-dashboard-audit-range.cjs
 *
 * Auditoria conjunta: Shopee API + Meta Graph API + snapshot dashboard (sem gravar Firebase).
 *
 * Uso:
 *   node scripts/meta-shopee-dashboard-audit-range.cjs --start 2026-06-01 --end 2026-06-12
 *   node scripts/meta-shopee-dashboard-audit-range.cjs 01/06/2026 12/06/2026
 *   node scripts/meta-shopee-dashboard-audit-range.cjs --start 2026-06-12 --end 2026-06-12 \
 *     --dashboard output/shopee_dashboard.json --out output
 *
 * Meta: por padrão busca Graph API (igual metaBackfillDaily / meta_ads_daily).
 *   --meta arquivo.csv   → usa export em vez da API
 *   --no-meta-api        → pula Meta (só Shopee)
 *
 * Env (.env.local ou functions/.env.*):
 *   SHOPEE_APP_ID + SHOPEE_APP_SECRET (ou SHOPEE_SECRET)
 *   META_ACCESS_TOKEN + META_AD_ACCOUNT_IDS (ex.: act_123 ou 123456789)
 *   FIRESTORE_API_KEY — necessário com --firestore-compare
 *
 * Flags:
 *   --firestore-compare   compara audit vs shopee_daily live (Firestore REST)
 *   --nodes arquivo.json  reutiliza pull salvo pelo sync (evita drift entre execuções)
 */

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const ENV_PATHS = [
  path.join(__dirname, '..', 'functions', '.env.projetoafiliado-9ff07'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.local'),
  path.join(__dirname, '.env'),
]

function loadEnvFiles() {
  for (const p of ENV_PATHS) {
    if (!fsSync.existsSync(p)) continue
    for (const line of fsSync.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
  if (!process.env.SHOPEE_APP_SECRET && process.env.SHOPEE_SECRET) {
    process.env.SHOPEE_APP_SECRET = process.env.SHOPEE_SECRET
  }
}

loadEnvFiles()

const { normalizeSubId: metaNormalizeSubId } = require('../functions/lib/normalizeSubId')
const {
  aggregateShopeeRangePromosApp,
  aggregateShopeeRangeFromPull,
  dedupePullNodes,
  AGGREGATION_MODE,
} = require('../functions/lib/shopeePanelAppAgg')

const TIME_ZONE = 'America/Sao_Paulo'
const SHOPEE_BASE_URL = 'https://open-api.affiliate.shopee.com.br/graphql'
const DEFAULT_PAGE_LIMIT = Number(process.env.SHOPEE_PAGE_LIMIT || 200)
const META_API_VERSION = process.env.META_API_VERSION || 'v19.0'
const FIRESTORE_PROJECT =
  process.env.FIRESTORE_PROJECT || process.env.GCLOUD_PROJECT || 'projetoafiliado-9ff07'
const FIRESTORE_API_KEY = process.env.FIRESTORE_API_KEY || ''

function metaActId(id) {
  return String(id || '').startsWith('act_') ? String(id || '') : `act_${id}`
}

function parseMetaAccountIds(raw) {
  return String(raw || process.env.META_AD_ACCOUNT_IDS || '')
    .split(',')
    .flatMap((part) => {
      const m = String(part || '').match(/\d{5,}/g)
      return m && m[0] ? [m[0]] : []
    })
    .filter(Boolean)
}

async function metaFetchAll(url) {
  let next = url
  const out = []
  while (next) {
    const res = await fetch(next)
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) {
      const msg = json?.error?.message || `HTTP ${res.status}`
      throw new Error(msg)
    }
    if (Array.isArray(json.data)) out.push(...json.data)
    next = json?.paging?.next || null
  }
  return out
}

/** Meta Graph API — insights diários por anúncio (mesmo contrato do meta_ads_daily). */
async function fetchMetaFromGraphApi(range) {
  const token = String(process.env.META_ACCESS_TOKEN || '').trim()
  const accountIds = parseMetaAccountIds()

  if (!token) {
    throw new Error('META_ACCESS_TOKEN não definido (.env.local ou variável de ambiente)')
  }
  if (!accountIds.length) {
    throw new Error('META_AD_ACCOUNT_IDS não definido (.env.local ou variável de ambiente)')
  }

  const since = range.startDateKey
  const until = range.endDateKey
  const fields = [
    'ad_id',
    'ad_name',
    'adset_name',
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'ctr',
    'cpc',
    'reach',
    'date_start',
    'date_stop',
  ].join(',')

  const rows = []
  const errors = []

  console.log(`Buscando Meta Graph API ${since} → ${until} (${accountIds.length} conta(s))...`)

  for (const accountId of accountIds) {
    const params = new URLSearchParams({
      access_token: token,
      level: 'ad',
      fields,
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    })
    const url = `https://graph.facebook.com/${META_API_VERSION}/${metaActId(accountId)}/insights?${params}`

    try {
      const apiRows = await metaFetchAll(url)
      console.log(`  conta ${accountId}: ${apiRows.length} linhas`)
      for (const row of apiRows) {
        const dateKey = String(row.date_start || '').trim()
        if (!dateKey || !range.dateKeySet.has(dateKey)) continue
        rows.push({
          data: dateKey,
          date: dateKey,
          date_start: dateKey,
          ad_id: String(row.ad_id || ''),
          nomeAnuncio: String(row.ad_name || ''),
          ad_name: String(row.ad_name || ''),
          subid: metaNormalizeSubId(row.ad_name || ''),
          valorUsado: round2(parseFloat(row.spend || 0) || 0),
          spend: round2(parseFloat(row.spend || 0) || 0),
          cliquesTotal: parseInt(row.clicks || 0, 10) || 0,
          clicks: parseInt(row.clicks || 0, 10) || 0,
          _accountId: String(accountId),
          fonte: 'meta_graph_api_audit',
        })
      }
    } catch (err) {
      errors.push(`Conta ${accountId}: ${err?.message || String(err)}`)
    }
  }

  if (errors.length && rows.length === 0) {
    throw new Error(errors.join(' | '))
  }
  if (errors.length) {
    console.warn(`  avisos Meta: ${errors.join(' | ')}`)
  }

  return rows
}

function parseArgs(argv) {
  const flags = {}
  const positional = []

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]

    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }

    flags[key] = next
    i += 1
  }

  return { flags, positional }
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function parseApiNum(value) {
  const n = parseFloat(String(value ?? '0'))
  return Number.isFinite(n) ? n : 0
}

function parseLooseNum(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  let text = String(value ?? '').trim()
  if (!text) return 0

  text = text
    .replace(/\s+/g, '')
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/x$/i, '')
    .replace(/[^\d,.-]/g, '')

  if (!text || text === '-' || text === ',' || text === '.') return 0

  const hasComma = text.includes(',')
  const hasDot = text.includes('.')

  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.')
    } else {
      text = text.replace(/,/g, '')
    }
  } else if (hasComma) {
    text = text.replace(',', '.')
  }

  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateKey(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function formatDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const map = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = formatDateParts(date, timeZone)
  const utc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return utc - date.getTime()
}

function zonedToUtc(year, month, day, hour, minute, second, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone))
}

function parseDateInput(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('Data vazia.')

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    }
  }

  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)
  if (brMatch) {
    return {
      year: Number(brMatch[3]),
      month: Number(brMatch[2]),
      day: Number(brMatch[1]),
    }
  }

  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})T/.exec(raw)
  if (isoPrefix) {
    return {
      year: Number(isoPrefix[1]),
      month: Number(isoPrefix[2]),
      day: Number(isoPrefix[3]),
    }
  }

  const brPrefix = /^(\d{2})\/(\d{2})\/(\d{4})\b/.exec(raw)
  if (brPrefix) {
    return {
      year: Number(brPrefix[3]),
      month: Number(brPrefix[2]),
      day: Number(brPrefix[1]),
    }
  }

  throw new Error(`Data inválida: ${input}. Use YYYY-MM-DD ou DD/MM/YYYY.`)
}

function addUtcDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  date.setUTCDate(date.getUTCDate() + days)

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function compareDateParts(a, b) {
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month
  return a.day - b.day
}

function buildDateInfo(parts) {
  const dateKey = toDateKey(parts)
  const start = zonedToUtc(parts.year, parts.month, parts.day, 0, 0, 0, TIME_ZONE)
  const end = zonedToUtc(parts.year, parts.month, parts.day, 23, 59, 59, TIME_ZONE)

  return {
    dateKey,
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
    labelBr: `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`,
  }
}

function buildRange(flags, positional) {
  const startInput = flags.start || positional[0]
  const endInput = flags.end || positional[1] || startInput

  if (!startInput && !endInput) {
    const now = new Date()
    const today = formatDateParts(now, TIME_ZONE)
    const yesterday = addUtcDays(
      { year: today.year, month: today.month, day: today.day },
      -1
    )
    const info = buildDateInfo(yesterday)
    return {
      startDateKey: info.dateKey,
      endDateKey: info.dateKey,
      days: [info],
      dateKeySet: new Set([info.dateKey]),
    }
  }

  const startParts = parseDateInput(startInput)
  const endParts = parseDateInput(endInput)

  if (compareDateParts(startParts, endParts) > 0) {
    throw new Error('A data inicial não pode ser maior que a final.')
  }

  const days = []
  let current = startParts

  while (compareDateParts(current, endParts) <= 0) {
    days.push(buildDateInfo(current))
    current = addUtcDays(current, 1)
  }

  return {
    startDateKey: days[0].dateKey,
    endDateKey: days[days.length - 1].dateKey,
    days,
    dateKeySet: new Set(days.map((day) => day.dateKey)),
  }
}

async function readJsonIfExists(filePath) {
  if (!filePath) return {}
  const content = await fs.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

function normalizeSubId(raw, aliases) {
  const key = slugify(raw)
  return aliases[key] || key || '_sem_subid'
}

function normalizeShopeeSubId(utmContent, aliases) {
  let value = String(utmContent || '').trim()

  if (value.includes('-')) {
    const slot = value.split('-').find((part) => part.trim().length > 0)
    if (slot) value = slot.trim()
  }

  return normalizeSubId(value, aliases)
}

function normalizeMetaSubId(raw, aliases) {
  const cleaned = String(raw || '').trim()
  if (!cleaned) return aliases._blankMetaSubId || '_outros_canais'
  const sid = metaNormalizeSubId(cleaned) || slugify(cleaned)
  if (!sid) return aliases._blankMetaSubId || '_outros_canais'
  return aliases[sid] || sid
}

function buildShopeeQuery(startTs, endTs, scrollId, pageLimit) {
  const scrollArg = scrollId ? `, scrollId: ${JSON.stringify(scrollId)}` : ''

  return `query {
    conversionReport(
      limit: ${pageLimit},
      purchaseTimeStart: ${startTs},
      purchaseTimeEnd: ${endTs}${scrollArg}
    ) {
      nodes {
        purchaseTime
        conversionId
        utmContent
        totalCommission
        netCommission
        orders {
          orderId
          orderStatus
          items {
            itemId
            itemName
            shopId
            shopName
            qty
            actualAmount
            itemTotalCommission
            attributionType
            fraudStatus
            completeTime
          }
        }
      }
      pageInfo {
        hasNextPage
        scrollId
      }
    }
  }`
}

function buildShopeeAuth(appId, appSecret, body) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = crypto
    .createHash('sha256')
    .update(`${appId}${timestamp}${body}${appSecret}`)
    .digest('hex')

  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`
}

async function fetchShopeeDay(day, appId, appSecret, pageLimit) {
  if (!appId || !appSecret) {
    throw new Error('Defina SHOPEE_APP_ID e SHOPEE_APP_SECRET.')
  }

  const allNodes = []
  let scrollId = null
  let pages = 0

  console.log(`Buscando API Shopee ${day.labelBr} (${day.startTs}–${day.endTs})...`)

  while (true) {
    const body = JSON.stringify({
      query: buildShopeeQuery(day.startTs, day.endTs, scrollId, pageLimit),
    })

    const response = await fetch(SHOPEE_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildShopeeAuth(appId, appSecret, body),
      },
      body,
    })

    const text = await response.text()

    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`Shopee retornou algo não-JSON em ${day.dateKey}: ${text}`)
    }

    if (!response.ok) {
      throw new Error(`Shopee HTTP ${response.status} em ${day.dateKey}: ${text}`)
    }

    if (json.errors?.length) {
      throw new Error(
        `Shopee GraphQL em ${day.dateKey}: ${JSON.stringify(json.errors)}`
      )
    }

    const report = json?.data?.conversionReport
    if (!report) {
      throw new Error(`Resposta sem conversionReport em ${day.dateKey}.`)
    }

    const nodes = Array.isArray(report.nodes) ? report.nodes : []
    allNodes.push(...nodes)
    pages += 1

    console.log(`  página ${pages}: +${nodes.length} (total ${allNodes.length})`)

    if (!report.pageInfo?.hasNextPage || !report.pageInfo?.scrollId) {
      break
    }

    scrollId = report.pageInfo.scrollId
  }

  return {
    dateKey: day.dateKey,
    pages,
    rawNodes: allNodes.length,
    nodes: allNodes,
  }
}

async function fetchShopeeRangeComplete(range, appId, appSecret, pageLimit) {
  if (!appId || !appSecret) {
    throw new Error('Defina SHOPEE_APP_ID e SHOPEE_APP_SECRET.')
  }

  const startTs = range.days[0].startTs
  const endTs = range.days[range.days.length - 1].endTs
  const label = `${range.startDateKey} → ${range.endDateKey}`

  const merged = []
  const seen = new Set()
  let scrollId = null
  let pages = 0

  console.log(`Buscando API Shopee (pull único) ${label} (${startTs}–${endTs})...`)

  while (true) {
    const body = JSON.stringify({
      query: buildShopeeQuery(startTs, endTs, scrollId, pageLimit),
    })

    const response = await fetch(SHOPEE_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildShopeeAuth(appId, appSecret, body),
      },
      body,
    })

    const text = await response.text()

    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`Shopee retornou algo não-JSON: ${text}`)
    }

    if (!response.ok) {
      throw new Error(`Shopee HTTP ${response.status}: ${text}`)
    }

    if (json.errors?.length) {
      throw new Error(`Shopee GraphQL: ${JSON.stringify(json.errors)}`)
    }

    const report = json?.data?.conversionReport
    if (!report) {
      throw new Error('Resposta sem conversionReport.')
    }

    const nodes = Array.isArray(report.nodes) ? report.nodes : []
    pages += 1

    let added = 0
    for (const node of nodes) {
      const cid = String(node?.conversionId || '').trim()
      const orderId = String(node?.orders?.[0]?.orderId || '').trim()
      const key = cid && orderId
        ? `${cid}__${orderId}`
        : cid || `__noid_${node?.purchaseTime || ''}_${orderId}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(node)
      added += 1
    }

    console.log(
      `  página ${pages}: +${nodes.length} brutos, +${added} únicos (total ${merged.length})`
    )

    if (!report.pageInfo?.hasNextPage || !report.pageInfo?.scrollId) {
      break
    }

    scrollId = report.pageInfo.scrollId
  }

  return {
    pages,
    rawNodes: merged.length,
    pullUniqueNodes: merged.length,
    nodes: merged,
    duplicatesSkipped: seen.size - merged.length,
  }
}

async function loadPullSnapshot(nodesPath) {
  const abs = path.isAbsolute(nodesPath)
    ? nodesPath
    : path.join(process.cwd(), nodesPath)
  const raw = await fs.readFile(abs, 'utf8')
  const snap = JSON.parse(raw)

  if (!Array.isArray(snap.nodes)) {
    throw new Error(`--nodes: arquivo sem array "nodes": ${abs}`)
  }

  return {
    pages: snap.pages || 0,
    rawNodes: snap.rawNodes || snap.nodes.length,
    pullUniqueNodes: snap.pullUniqueNodes || snap.nodes.length,
    nodes: snap.nodes,
    pulledAt: snap.pulledAt || null,
    sourceFile: abs,
  }
}

function dedupeNodes(nodes) {
  const map = new Map()

  for (const node of nodes) {
    const conversionId = String(node?.conversionId || '')
    if (!conversionId) continue

    if (!map.has(conversionId)) {
      map.set(conversionId, {
        ...node,
        orders: Array.isArray(node.orders) ? [...node.orders] : [],
      })
      continue
    }

    const current = map.get(conversionId)
    const seenOrders = new Set(
      (current.orders || []).map((order) => String(order?.orderId || ''))
    )

    for (const order of Array.isArray(node.orders) ? node.orders : []) {
      const orderId = String(order?.orderId || '')
      if (!seenOrders.has(orderId)) {
        current.orders.push(order)
        seenOrders.add(orderId)
      }
    }

    if (parseApiNum(node?.netCommission) > parseApiNum(current?.netCommission)) {
      current.netCommission = node.netCommission
    }

    if (
      parseApiNum(node?.totalCommission) > parseApiNum(current?.totalCommission)
    ) {
      current.totalCommission = node.totalCommission
    }
  }

  return Array.from(map.values())
}

function isUnpaid(status) {
  return String(status || '').toUpperCase().includes('UNPAID')
}

function isCancelled(status) {
  const value = String(status || '').toUpperCase()
  return ['CANCEL', 'RETURN', 'REFUND', 'INVALID', 'REJECT', 'FAIL'].some((token) =>
    value.includes(token)
  )
}

function isCompleted(status) {
  const value = String(status || '').toUpperCase()
  return ['COMPLETE', 'COMPLETED', 'FINISH', 'SETTLED'].some((token) =>
    value.includes(token)
  )
}

function isFraudItem(item) {
  const value = String(item?.fraudStatus || '').toUpperCase().trim()

  if (!value) return false
  if (value === 'NORMAL' || value === 'OK' || value === 'NONE') return false

  return value.includes('FRAUD')
}

function isDireta(attr) {
  const value = String(attr || '').toUpperCase()
  return value.includes('SAME SHOP') || value.includes('SAME_SHOP')
}

function nodeCommission(node) {
  const net = parseApiNum(node?.netCommission)
  if (net > 0) return round2(net)

  const total = parseApiNum(node?.totalCommission)
  if (total > 0) return round2(total)

  const fallback = (node?.orders || [])
    .flatMap((order) => order?.items || [])
    .reduce((sum, item) => sum + parseApiNum(item?.itemTotalCommission), 0)

  return round2(fallback)
}

function splitCommission(validOrders, targetCommission) {
  let itemsBase = 0
  let valid = 0
  let completed = 0

  for (const order of validOrders) {
    itemsBase += (order.items || []).reduce(
      (sum, item) => sum + parseApiNum(item?.itemTotalCommission),
      0
    )
    valid += 1
    if (isCompleted(order.orderStatus)) completed += 1
  }

  const conversionCompleted = valid > 0 && completed === valid

  if (itemsBase <= 0) {
    return conversionCompleted
      ? { liquidated: round2(targetCommission), pending: 0 }
      : { liquidated: 0, pending: round2(targetCommission) }
  }

  const baseLiquidated = conversionCompleted ? itemsBase : 0
  const liquidated = round2((baseLiquidated / itemsBase) * targetCommission)

  return {
    liquidated,
    pending: round2(targetCommission - liquidated),
  }
}

function createShopeeAccumulator(key) {
  return {
    key,
    conversionsCompleted: 0,
    conversionsPending: 0,
    validOrders: new Set(),
    cancelledOrders: 0,
    unpaidOrders: 0,
    itemsSold: 0,
    directItems: 0,
    indirectItems: 0,
    gmv: 0,
    commissionLiquidated: 0,
    commissionPending: 0,
    commissionProjected: 0,
  }
}

function finalizeShopeeAccumulator(acc) {
  return {
    key: acc.key,
    conversionsCompleted: acc.conversionsCompleted,
    conversionsPending: acc.conversionsPending,
    validOrders: acc.validOrders.size,
    cancelledOrders: acc.cancelledOrders,
    unpaidOrders: acc.unpaidOrders,
    itemsSold: acc.itemsSold,
    directItems: acc.directItems,
    indirectItems: acc.indirectItems,
    gmv: round2(acc.gmv),
    commissionLiquidated: round2(acc.commissionLiquidated),
    commissionPending: round2(acc.commissionPending),
    commissionProjected: round2(acc.commissionProjected),
  }
}

function applyNodeToAccumulators(node, accumulators) {
  const validOrders = []

  for (const order of Array.isArray(node?.orders) ? node.orders : []) {
    const items = (Array.isArray(order?.items) ? order.items : []).filter(
      (item) => !isFraudItem(item)
    )

    if (!items.length) continue

    const orderStatus = String(order?.orderStatus || '')
    const orderId = String(order?.orderId || '')

    if (isUnpaid(orderStatus)) {
      for (const acc of accumulators) {
        if (orderId) acc.unpaidOrders += 1
      }
      continue
    }

    if (isCancelled(orderStatus)) {
      for (const acc of accumulators) {
        if (orderId) acc.cancelledOrders += 1
      }
      continue
    }

    validOrders.push({
      orderId,
      orderStatus,
      items,
    })

    for (const acc of accumulators) {
      if (orderId) {
        acc.validOrders.add(orderId)
      }

      for (const item of items) {
        const qty = Math.max(0, parseApiNum(item?.qty))
        const amount = parseApiNum(item?.actualAmount)

        acc.itemsSold += qty
        acc.gmv += amount

        if (isDireta(item?.attributionType)) {
          acc.directItems += qty
        } else {
          acc.indirectItems += qty
        }
      }
    }
  }

  if (!validOrders.length) return

  const commission = nodeCommission(node)
  if (commission <= 0) return

  const split = splitCommission(validOrders, commission)

  for (const acc of accumulators) {
    acc.commissionLiquidated += split.liquidated
    acc.commissionPending += split.pending
    acc.commissionProjected += commission

    if (split.liquidated > 0 && split.pending === 0) {
      acc.conversionsCompleted += 1
    } else {
      acc.conversionsPending += 1
    }
  }
}

function aggregateShopeeRange(dayResults, aliases, range, rangePull = null) {
  const normalizeSubId = (raw) => normalizeShopeeSubId(raw, aliases)

  const shopee = rangePull
    ? aggregateShopeeRangeFromPull(rangePull.nodes, range, {
        normalizeSubId,
        timeZone: TIME_ZONE,
        pages: rangePull.pages,
      })
    : aggregateShopeeRangePromosApp(dayResults, {
        normalizeSubId,
        timeZone: TIME_ZONE,
      })

  return {
    period: {
      startDateKey: range.startDateKey,
      endDateKey: range.endDateKey,
      days: range.days.map((day) => day.dateKey),
    },
    source: {
      ...shopee.source,
      uniqueConversions: shopee.source.conversionGroups,
      aggregationMode: AGGREGATION_MODE,
    },
    totals: shopee.totals,
    bySubId: shopee.bySubId,
    byDay: shopee.byDay,
  }
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []

  const parseLine = (line) => {
    const values = []
    let current = ''
    let quoted = false

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]

      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"'
          i += 1
          continue
        }
        quoted = !quoted
        continue
      }

      if (ch === ',' && !quoted) {
        values.push(current)
        current = ''
        continue
      }

      current += ch
    }

    values.push(current)
    return values
  }

  const headers = parseLine(lines[0]).map((value) => value.trim())

  return lines.slice(1).map((line) => {
    const cells = parseLine(line)
    const row = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  })
}

async function loadRowsFile(filePath) {
  if (!filePath) return []

  const content = await fs.readFile(filePath, 'utf8')

  if (filePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : parsed.data || parsed.rows || []
  }

  return parseCsv(content)
}

function pick(row, keys) {
  for (const key of keys) {
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      String(row[key]).trim() !== ''
    ) {
      return row[key]
    }
  }
  return ''
}

function extractRowDateKey(row) {
  const raw = pick(row, [
    'date',
    'Date',
    'data',
    'Data',
    'date_start',
    'dateStart',
    'day',
    'Dia',
  ])

  if (!raw) return null

  try {
    const parts = parseDateInput(raw)
    return toDateKey(parts)
  } catch {
    return null
  }
}

function aggregateMeta(rows, aliases, range, metaSource = 'unknown') {
  const bySubIdMap = new Map()
  const byDayMap = new Map()
  let usedRows = 0

  for (const row of rows) {
    const dateKey = extractRowDateKey(row)
    if (dateKey && !range.dateKeySet.has(dateKey)) {
      continue
    }

    usedRows += 1

    const rawSubId = pick(row, [
      'subid',
      'SubID',
      'sub_id',
      'nomeAnuncio',
      'Nome do anúncio',
      'Nome do Anúncio',
      'ad_name',
      'Ad name',
      'campaign_name',
      'Campaign name',
    ])

    const subid = normalizeMetaSubId(rawSubId, aliases)
    const spend = parseLooseNum(
      pick(row, [
        'valorUsado',
        'Valor usado',
        'Valor usado (BRL)',
        'amount_spent',
        'spend',
        'gasto',
      ])
    )

    const clicksAds = parseLooseNum(
      pick(row, [
        'cliques',
        'Cliques',
        'clicks',
        'inline_link_clicks',
        'link_clicks',
        'cliquesTotal',
      ])
    )

    const subCurrent = bySubIdMap.get(subid) || {
      subid,
      spend: 0,
      clicksAds: 0,
    }

    subCurrent.spend += spend
    subCurrent.clicksAds += clicksAds
    bySubIdMap.set(subid, subCurrent)

    if (dateKey) {
      const dayCurrent = byDayMap.get(dateKey) || {
        dateKey,
        spend: 0,
        clicksAds: 0,
      }
      dayCurrent.spend += spend
      dayCurrent.clicksAds += clicksAds
      byDayMap.set(dateKey, dayCurrent)
    }
  }

  const bySubId = Array.from(bySubIdMap.values())
    .map((row) => ({
      subid: row.subid,
      spend: round2(row.spend),
      clicksAds: round2(row.clicksAds),
    }))
    .sort((a, b) => b.spend - a.spend)

  const byDay = Array.from(byDayMap.values())
    .map((row) => ({
      dateKey: row.dateKey,
      spend: round2(row.spend),
      clicksAds: round2(row.clicksAds),
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))

  return {
    source: {
      metaRows: usedRows,
      metaSource,
    },
    totals: {
      spend: round2(bySubId.reduce((sum, row) => sum + row.spend, 0)),
      clicksAds: round2(bySubId.reduce((sum, row) => sum + row.clicksAds, 0)),
    },
    bySubId,
    byDay,
  }
}

function mergeAudit(shopee, meta, range) {
  const shopeeBySub = new Map(shopee.bySubId.map((row) => [row.subid, row]))
  const metaBySub = new Map(meta.bySubId.map((row) => [row.subid, row]))
  const allSubIds = Array.from(
    new Set([...shopeeBySub.keys(), ...metaBySub.keys()])
  )

  const bySubId = allSubIds
    .map((subid) => {
      const shopeeRow = shopeeBySub.get(subid)
      const metaRow = metaBySub.get(subid)

      const commissionLiquidated = round2(shopeeRow?.commissionLiquidated || 0)
      const commissionPending = round2(shopeeRow?.commissionPending || 0)
      const commissionProjected = round2(shopeeRow?.commissionProjected || 0)
      const spend = round2(metaRow?.spend || 0)

      const profitLiquidated = round2(commissionLiquidated - spend)
      const profitProjected = round2(commissionProjected - spend)

      return {
        subid,
        commissionLiquidated,
        commissionPending,
        commissionProjected,
        spend,
        profitLiquidated,
        profitProjected,
        roiLiquidated:
          spend > 0 ? round2((profitLiquidated / spend) * 100) : null,
        roiProjected:
          spend > 0 ? round2((profitProjected / spend) * 100) : null,
        roasLiquidated:
          spend > 0 ? round2(commissionLiquidated / spend) : null,
        roasProjected:
          spend > 0 ? round2(commissionProjected / spend) : null,
        gmv: round2(shopeeRow?.gmv || 0),
        ticketPerItem:
          (shopeeRow?.itemsSold || 0) > 0
            ? round2((shopeeRow?.gmv || 0) / shopeeRow.itemsSold)
            : 0,
        ticketPerOrder:
          (shopeeRow?.validOrders || 0) > 0
            ? round2((shopeeRow?.gmv || 0) / shopeeRow.validOrders)
            : 0,
        conversionsCompleted: Math.round(shopeeRow?.conversionsCompleted || 0),
        conversionsPending: Math.round(shopeeRow?.conversionsPending || 0),
        validOrders: Math.round(shopeeRow?.validOrders || 0),
        cancelledOrders: Math.round(shopeeRow?.cancelledOrders || 0),
        unpaidOrders: Math.round(shopeeRow?.unpaidOrders || 0),
        itemsSold: Math.round(shopeeRow?.itemsSold || 0),
        directItems: Math.round(shopeeRow?.directItems || 0),
        indirectItems: Math.round(shopeeRow?.indirectItems || 0),
        clicksAds: round2(metaRow?.clicksAds || 0),
        pedidosPorCliquesAds:
          (metaRow?.clicksAds || 0) > 0
            ? round2(((shopeeRow?.validOrders || 0) / metaRow.clicksAds) * 100)
            : null,
      }
    })
    .sort((a, b) => b.commissionProjected - a.commissionProjected || b.spend - a.spend)

  const shopeeByDay = new Map(shopee.byDay.map((row) => [row.dateKey, row]))
  const metaByDay = new Map(meta.byDay.map((row) => [row.dateKey, row]))

  const byDay = range.days.map((day) => {
    const shopeeRow = shopeeByDay.get(day.dateKey)
    const metaRow = metaByDay.get(day.dateKey)

    const commissionLiquidated = round2(shopeeRow?.commissionLiquidated || 0)
    const commissionPending = round2(shopeeRow?.commissionPending || 0)
    const commissionProjected = round2(shopeeRow?.commissionProjected || 0)
    const spend = round2(metaRow?.spend || 0)

    const profitLiquidated = round2(commissionLiquidated - spend)
    const profitProjected = round2(commissionProjected - spend)

    return {
      dateKey: day.dateKey,
      commissionLiquidated,
      commissionPending,
      commissionProjected,
      spend,
      profitLiquidated,
      profitProjected,
      roiLiquidated:
        spend > 0 ? round2((profitLiquidated / spend) * 100) : null,
      roiProjected:
        spend > 0 ? round2((profitProjected / spend) * 100) : null,
      roasLiquidated:
        spend > 0 ? round2(commissionLiquidated / spend) : null,
      roasProjected:
        spend > 0 ? round2(commissionProjected / spend) : null,
      validOrders: Math.round(shopeeRow?.validOrders || 0),
      cancelledOrders: Math.round(shopeeRow?.cancelledOrders || 0),
      unpaidOrders: Math.round(shopeeRow?.unpaidOrders || 0),
      itemsSold: Math.round(shopeeRow?.itemsSold || 0),
      directItems: Math.round(shopeeRow?.directItems || 0),
      indirectItems: Math.round(shopeeRow?.indirectItems || 0),
      gmv: round2(shopeeRow?.gmv || 0),
      clicksAds: round2(metaRow?.clicksAds || 0),
      pedidosPorCliquesAds:
        (metaRow?.clicksAds || 0) > 0
          ? round2(((shopeeRow?.validOrders || 0) / metaRow.clicksAds) * 100)
          : null,
    }
  })

  const investment = round2(meta.totals.spend)
  const commissionLiquidated = round2(shopee.totals.commissionLiquidated)
  const commissionPending = round2(shopee.totals.commissionPending)
  const commissionProjected = round2(shopee.totals.commissionProjected)
  const profitLiquidated = round2(commissionLiquidated - investment)
  const profitProjected = round2(commissionProjected - investment)

  return {
    period: {
      startDateKey: range.startDateKey,
      endDateKey: range.endDateKey,
      startLabelBr: range.days[0].labelBr,
      endLabelBr: range.days[range.days.length - 1].labelBr,
      days: range.days.map((day) => day.dateKey),
    },
    source: {
      ...shopee.source,
      ...meta.source,
    },
    dashboard: {
      investment,
      commissionLiquidated,
      commissionPending,
      commissionProjected,
      profitLiquidated,
      profitProjected,
      roiLiquidated:
        investment > 0 ? round2((profitLiquidated / investment) * 100) : null,
      roiProjected:
        investment > 0 ? round2((profitProjected / investment) * 100) : null,
      roasLiquidated:
        investment > 0 ? round2(commissionLiquidated / investment) : null,
      roasProjected:
        investment > 0 ? round2(commissionProjected / investment) : null,
      conversionsCompleted: shopee.totals.conversionsCompleted,
      conversionsPending: shopee.totals.conversionsPending,
      validOrders: shopee.totals.validOrders,
      cancelledOrders: shopee.totals.cancelledOrders,
      unpaidOrders: shopee.totals.unpaidOrders,
      activeSubIdsWithSales: bySubId.filter(
        (row) => row.commissionProjected > 0 || row.itemsSold > 0
      ).length,
      subIdsInPeriod: bySubId.filter(
        (row) => row.commissionProjected > 0 || row.itemsSold > 0 || row.spend > 0
      ).length,
      itemsSold: shopee.totals.itemsSold,
      directItems: shopee.totals.directItems,
      indirectItems: shopee.totals.indirectItems,
      gmv: shopee.totals.gmv,
      ticketPerItem:
        shopee.totals.itemsSold > 0
          ? round2(shopee.totals.gmv / shopee.totals.itemsSold)
          : 0,
      ticketPerOrder:
        shopee.totals.validOrders > 0
          ? round2(shopee.totals.gmv / shopee.totals.validOrders)
          : 0,
      pedidosPorCliquesAds:
        meta.totals.clicksAds > 0
          ? round2((shopee.totals.validOrders / meta.totals.clicksAds) * 100)
          : null,
    },
    bySubId,
    byDay,
  }
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (
      source?.[key] !== undefined &&
      source?.[key] !== null &&
      source[key] !== ''
    ) {
      return source[key]
    }
  }
  return undefined
}

function toRecordArray(value) {
  return Array.isArray(value) ? value : []
}

function mapShopeeDashboardJson(parsed) {
  if (!parsed?.totals) return null

  const t = parsed.totals
  return {
    metrics: {
      investment: t.spend,
      commissionLiquidated: t.commissionCompleted,
      commissionPending: t.commissionPending,
      commissionProjected: t.commissionTotal || t.commissionReal,
      profitLiquidated: round2((t.commissionCompleted || 0) - (t.spend || 0)),
      profitProjected: t.profit,
      roiLiquidated:
        (t.spend || 0) > 0
          ? round2((((t.commissionCompleted || 0) - (t.spend || 0)) / t.spend) * 100)
          : null,
      roiProjected: t.roiPct,
      roasLiquidated:
        (t.spend || 0) > 0 ? round2((t.commissionCompleted || 0) / t.spend) : null,
      roasProjected: t.roas,
      conversionsCompleted: t.completedOrders,
      conversionsPending: t.pendingOrders,
      validOrders: t.orders,
      cancelledOrders: t.cancelledOrders,
      unpaidOrders: t.unpaidOrders,
      activeSubIdsWithSales: t.activeSubIds,
      itemsSold: t.itemsSold,
      directItems: t.directItems,
      indirectItems: t.indirectItems,
      gmv: t.grossRevenue,
      ticketPerItem: t.avgTicketPerItem,
      ticketPerOrder: t.avgTicketPerOrder,
    },
    bySubId: (parsed.bySubId || []).map((row) => ({
      subid: slugify(row.name || row.subid || ''),
      commissionProjected: row.commissionTotal || row.commissionReal,
      spend: row.spend,
      validOrders: row.orders,
      itemsSold: row.itemsSold,
    })),
  }
}

async function loadDashboardSnapshot(dashboardPath) {
  if (!dashboardPath) return null

  const content = await fs.readFile(dashboardPath, 'utf8')

  if (!dashboardPath.toLowerCase().endsWith('.json')) {
    return {
      metrics: null,
      bySubId: parseCsv(content),
    }
  }

  const parsed = JSON.parse(content)

  const mapped = mapShopeeDashboardJson(parsed)
  if (mapped) return mapped

  const metricsSource =
    firstDefined(parsed, ['dashboard', 'kpis', 'metrics', 'summary']) ||
    (Array.isArray(parsed) ? null : parsed)

  const bySubId = toRecordArray(
    firstDefined(parsed, ['bySubId', 'subids', 'subIdRows', 'rows', 'campaigns'])
  )

  return {
    metrics: metricsSource && !Array.isArray(metricsSource) ? metricsSource : null,
    bySubId,
  }
}

function normalizeDashboardMetrics(metrics) {
  if (!metrics) return null

  const investment = parseLooseNum(
    firstDefined(metrics, [
      'investment',
      'investimento',
      'gastoMidia',
      'gasto_midia',
      'spend',
    ])
  )

  const commissionLiquidated = parseLooseNum(
    firstDefined(metrics, [
      'commissionLiquidated',
      'comissaoLiquidada',
      'comissao_concluida',
      'comissaoConcluida',
    ])
  )

  const commissionPending = parseLooseNum(
    firstDefined(metrics, [
      'commissionPending',
      'comissaoPendente',
      'comissao_pendente',
    ])
  )

  const commissionProjected = parseLooseNum(
    firstDefined(metrics, [
      'commissionProjected',
      'comissaoProjetada',
      'comissao_total',
      'comissaoTotal',
      'comissao_real',
      'comissaoReal',
    ])
  )

  const profitLiquidated = parseLooseNum(
    firstDefined(metrics, [
      'profitLiquidated',
      'lucroLiquidado',
      'lucro_realizado',
      'lucroRealizado',
    ])
  )

  const profitProjected = parseLooseNum(
    firstDefined(metrics, [
      'profitProjected',
      'lucroProjetado',
      'lucro',
      'lucroProjetado',
    ])
  )

  const roiLiquidated = firstDefined(metrics, [
    'roiLiquidated',
    'roiLiquidado',
    'roi_realizado',
    'roiRealizado',
  ])

  const roiProjected = firstDefined(metrics, [
    'roiProjected',
    'roiProjetado',
    'roi',
    'roiGeral',
  ])

  const roasLiquidated = firstDefined(metrics, [
    'roasLiquidated',
    'roasLiquidado',
    'roas_realizado',
  ])

  const roasProjected = firstDefined(metrics, [
    'roasProjected',
    'roasProjetado',
    'roas',
  ])

  const conversionsCompleted = parseLooseNum(
    firstDefined(metrics, [
      'pedidosConcluidos',
      'conversionsCompleted',
      'conversoesConcluidas',
      'conversoes_concluidas',
      'pedidos_completos',
    ])
  )

  const conversionsPending = parseLooseNum(
    firstDefined(metrics, [
      'pedidosPendentes',
      'conversionsPending',
      'conversoesPendentes',
      'conversoes_pendentes',
      'pedidos_pendentes',
    ])
  )

  const validOrders = parseLooseNum(
    firstDefined(metrics, [
      'validOrders',
      'pedidosValidados',
      'pedidos',
      'pedidos_validados',
    ])
  )

  const cancelledOrders = parseLooseNum(
    firstDefined(metrics, [
      'cancelledOrders',
      'pedidosCancelados',
      'pedidos_cancelados',
    ])
  )

  const unpaidOrders = parseLooseNum(
    firstDefined(metrics, [
      'unpaidOrders',
      'naoLiquidados',
      'pedidos_nao_pagos',
    ])
  )

  const activeSubIdsWithSales = parseLooseNum(
    firstDefined(metrics, [
      'activeSubIdsWithSales',
      'subidsAtivos',
      'subids_ativos',
      'subidsComVenda',
    ])
  )

  const itemsSold = parseLooseNum(
    firstDefined(metrics, [
      'itemsSold',
      'itensVendidos',
      'itens_vendidos',
      'vendas',
    ])
  )

  const directItems = parseLooseNum(
    firstDefined(metrics, [
      'directItems',
      'diretas',
      'vendas_diretas',
    ])
  )

  const indirectItems = parseLooseNum(
    firstDefined(metrics, [
      'indirectItems',
      'indiretas',
      'vendas_indiretas',
    ])
  )

  const gmv = parseLooseNum(
    firstDefined(metrics, [
      'gmv',
      'fatBruto',
      'faturamento',
      'faturamento_bruto',
      'gmv_total',
    ])
  )

  const ticketPerItem = parseLooseNum(
    firstDefined(metrics, [
      'ticketPerItem',
      'ticketPorItem',
      'ticket_medio',
    ])
  )

  const ticketPerOrder = parseLooseNum(
    firstDefined(metrics, [
      'ticketPerOrder',
      'ticketPorPedido',
    ])
  )

  const pedidosPorCliquesAds = firstDefined(metrics, [
    'pedidosPorCliquesAds',
    'taxaPedidosCliquesAds',
    'convRate',
  ])

  return {
    investment: round2(investment),
    commissionLiquidated: round2(commissionLiquidated),
    commissionPending: round2(commissionPending),
    commissionProjected: round2(
      commissionProjected || commissionLiquidated + commissionPending
    ),
    profitLiquidated: round2(profitLiquidated),
    profitProjected: round2(profitProjected),
    roiLiquidated:
      roiLiquidated === undefined ? null : round2(parseLooseNum(roiLiquidated)),
    roiProjected:
      roiProjected === undefined ? null : round2(parseLooseNum(roiProjected)),
    roasLiquidated:
      roasLiquidated === undefined
        ? null
        : round2(parseLooseNum(roasLiquidated)),
    roasProjected:
      roasProjected === undefined ? null : round2(parseLooseNum(roasProjected)),
    conversionsCompleted: Math.round(conversionsCompleted),
    conversionsPending: Math.round(conversionsPending),
    validOrders: Math.round(validOrders),
    cancelledOrders: Math.round(cancelledOrders),
    unpaidOrders: Math.round(unpaidOrders),
    activeSubIdsWithSales: Math.round(activeSubIdsWithSales),
    itemsSold: Math.round(itemsSold),
    directItems: Math.round(directItems),
    indirectItems: Math.round(indirectItems),
    gmv: round2(gmv),
    ticketPerItem: round2(ticketPerItem),
    ticketPerOrder: round2(ticketPerOrder),
    pedidosPorCliquesAds:
      pedidosPorCliquesAds === undefined
        ? null
        : round2(parseLooseNum(pedidosPorCliquesAds)),
  }
}

function normalizeDashboardSubIdRows(rows, aliases) {
  return rows
    .map((row) => {
      const rawKey = pick(row, [
        'subid',
        'SubID',
        'nome',
        'name',
        'campaign',
        'campaignName',
        'sub_id',
      ])

      const subid = normalizeSubId(rawKey, aliases)

      return {
        subid,
        commissionProjected: round2(
          parseLooseNum(
            pick(row, [
              'commissionProjected',
              'commission',
              'comissao',
              'Comissão',
              'comissoes',
              'comissoes_estimadas',
              'commissionTotal',
              'commissionReal',
            ])
          )
        ),
        spend: round2(
          parseLooseNum(
            pick(row, ['spend', 'gasto', 'Gasto'])
          )
        ),
        validOrders: Math.round(
          parseLooseNum(
            pick(row, [
              'validOrders',
              'pedidos',
              'Pedidos',
              'orders',
              'vendas',
              'Vendas',
            ])
          )
        ),
        itemsSold: Math.round(
          parseLooseNum(
            pick(row, [
              'itemsSold',
              'itens',
              'Itens',
              'itemsSold',
              'vendas',
              'Vendas',
            ])
          )
        ),
      }
    })
    .filter((row) => row.subid)
}

function compareMetrics(calculated, dashboardMetrics) {
  if (!dashboardMetrics) return null

  const rows = []

  for (const key of Object.keys(calculated)) {
    const calcValue = calculated[key]
    const dashValue = dashboardMetrics[key]

    if (dashValue === undefined || dashValue === null) continue

    let delta = null
    let match = false

    if (typeof calcValue === 'number' && typeof dashValue === 'number') {
      delta = round2(calcValue - dashValue)
      match = delta === 0
    } else {
      match = calcValue === dashValue
      delta = match ? 0 : null
    }

    rows.push({
      metric: key,
      calculated: calcValue,
      dashboard: dashValue,
      delta,
      match,
    })
  }

  return rows
}

function firestoreFieldNum(fields, key) {
  const v = fields?.[key]
  if (!v) return 0
  if (v.doubleValue != null) return Number(v.doubleValue)
  if (v.integerValue != null) return Number(v.integerValue)
  return 0
}

async function fetchFirestoreShopeeDay(dateKey) {
  if (!FIRESTORE_API_KEY) return null
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}` +
    `/databases/(default)/documents/shopee_daily/${dateKey}?key=${FIRESTORE_API_KEY}`
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Firestore shopee_daily/${dateKey}: ${res.status}`)
  }
  const doc = await res.json()
  const f = doc.fields || {}
  return {
    dateKey,
    commissionLiquidated: round2(firestoreFieldNum(f, 'comissao_concluida')),
    commissionPending: round2(firestoreFieldNum(f, 'comissao_pendente')),
    commissionProjected: round2(
      firestoreFieldNum(f, 'comissao_total') ||
        firestoreFieldNum(f, 'comissao_concluida') + firestoreFieldNum(f, 'comissao_pendente')
    ),
    validOrders: Math.round(firestoreFieldNum(f, 'pedidos')),
    cancelledOrders: Math.round(firestoreFieldNum(f, 'pedidos_cancelados')),
    unpaidOrders: Math.round(firestoreFieldNum(f, 'pedidos_nao_pagos')),
    conversionsCompleted: Math.round(firestoreFieldNum(f, 'pedidos_concluidos')),
    conversionsPending: Math.round(firestoreFieldNum(f, 'pedidos_pendentes')),
    itemsSold: Math.round(firestoreFieldNum(f, 'vendas')),
    gmv: round2(firestoreFieldNum(f, 'faturamento') || firestoreFieldNum(f, 'gmv_total')),
    aggregationMode: f.aggregation_mode?.stringValue || '',
  }
}

async function loadFirestoreShopeeMetrics(range) {
  const byDay = []
  for (const day of range.days) {
    byDay.push((await fetchFirestoreShopeeDay(day.dateKey)) || {
      dateKey: day.dateKey,
      missing: true,
    })
  }

  const present = byDay.filter((row) => !row.missing)
  const totals = {
    commissionLiquidated: 0,
    commissionPending: 0,
    commissionProjected: 0,
    validOrders: 0,
    cancelledOrders: 0,
    unpaidOrders: 0,
    conversionsCompleted: 0,
    conversionsPending: 0,
    itemsSold: 0,
    gmv: 0,
  }

  for (const row of present) {
    totals.commissionLiquidated += row.commissionLiquidated
    totals.commissionPending += row.commissionPending
    totals.commissionProjected += row.commissionProjected
    totals.validOrders += row.validOrders
    totals.cancelledOrders += row.cancelledOrders
    totals.unpaidOrders += row.unpaidOrders
    totals.conversionsCompleted += row.conversionsCompleted
    totals.conversionsPending += row.conversionsPending
    totals.itemsSold += row.itemsSold
    totals.gmv += row.gmv
  }

  totals.commissionLiquidated = round2(totals.commissionLiquidated)
  totals.commissionPending = round2(totals.commissionPending)
  totals.commissionProjected = round2(totals.commissionProjected)
  totals.gmv = round2(totals.gmv)

  return { byDay, totals, daysPresent: present.length, daysMissing: byDay.length - present.length }
}

function compareFirestoreDayRows(calculatedByDay, firestoreByDay) {
  const calcMap = new Map(calculatedByDay.map((row) => [row.dateKey, row]))
  const fsMap = new Map(firestoreByDay.map((row) => [row.dateKey, row]))
  const keys = Array.from(new Set([...calcMap.keys(), ...fsMap.keys()])).sort()

  return keys.map((dateKey) => {
    const calc = calcMap.get(dateKey)
    const fs = fsMap.get(dateKey)
    if (!calc || !fs || fs.missing) {
      return { dateKey, status: fs?.missing ? 'missing_firestore' : 'missing_audit', match: false }
    }

    const metrics = ['commissionLiquidated', 'commissionPending', 'commissionProjected', 'validOrders', 'itemsSold', 'gmv']
    const deltas = {}
    let match = true
    for (const key of metrics) {
      const delta = round2((calc[key] || 0) - (fs[key] || 0))
      deltas[key] = delta
      if (delta !== 0) match = false
    }

    return { dateKey, match, deltas, firestore: fs, calculated: calc }
  })
}

function compareSubIdRows(calculatedRows, dashboardRows) {
  if (!dashboardRows?.length) return []

  const calculatedBySubId = new Map(
    calculatedRows.map((row) => [row.subid, row])
  )
  const dashboardBySubId = new Map(
    dashboardRows.map((row) => [row.subid, row])
  )

  const keys = Array.from(
    new Set([...calculatedBySubId.keys(), ...dashboardBySubId.keys()])
  ).sort()

  return keys.map((subid) => {
    const calc = calculatedBySubId.get(subid) || null
    const dash = dashboardBySubId.get(subid) || null

    const calcCommission = round2(calc?.commissionProjected || 0)
    const dashCommission = round2(dash?.commissionProjected || 0)
    const calcSpend = round2(calc?.spend || 0)
    const dashSpend = round2(dash?.spend || 0)
    const calcOrders = Math.round(calc?.validOrders || 0)
    const dashOrders = Math.round(dash?.validOrders || 0)
    const calcItems = Math.round(calc?.itemsSold || 0)
    const dashItems = Math.round(dash?.itemsSold || 0)

    return {
      subid,
      calculatedCommission: calcCommission,
      dashboardCommission: dashCommission,
      deltaCommission: round2(calcCommission - dashCommission),
      calculatedSpend: calcSpend,
      dashboardSpend: dashSpend,
      deltaSpend: round2(calcSpend - dashSpend),
      calculatedOrders: calcOrders,
      dashboardOrders: dashOrders,
      deltaOrders: calcOrders - dashOrders,
      calculatedItems: calcItems,
      dashboardItems: dashItems,
      deltaItems: calcItems - dashItems,
      onlyInCalculated: Boolean(calc && !dash),
      onlyInDashboard: Boolean(dash && !calc),
    }
  })
}

function toCsv(rows, columns) {
  const esc = (value) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`
    }
    return text
  }

  return [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => esc(row[column])).join(',')
    ),
  ].join('\n')
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const range = buildRange(flags, positional)
  const outDir = flags.out || path.join(process.cwd(), 'output')
  const aliases = await readJsonIfExists(flags.aliases)
  const dashboardSnapshot = await loadDashboardSnapshot(flags.dashboard)
  const pageLimit = Number(flags['page-limit'] || DEFAULT_PAGE_LIMIT)

  let metaRows = []
  let metaSource = 'none'

  if (flags.meta) {
    metaRows = await loadRowsFile(flags.meta)
    metaSource = 'file'
    console.log(`Meta: arquivo ${flags.meta} (${metaRows.length} linhas)`)
  } else if (flags['no-meta-api']) {
    metaSource = 'skipped'
    console.log('Meta: ignorado (--no-meta-api)')
  } else {
    try {
      metaRows = await fetchMetaFromGraphApi(range)
      metaSource = 'meta_graph_api'
    } catch (err) {
      console.warn(`Meta Graph API indisponível: ${err.message}`)
      metaSource = 'unavailable'
    }
  }

  const shopeeDayResults = []
  let rangePull = null

  if (flags['day-pull']) {
    for (const day of range.days) {
      const dayResult = await fetchShopeeDay(
        day,
        process.env.SHOPEE_APP_ID,
        process.env.SHOPEE_APP_SECRET,
        pageLimit
      )
      shopeeDayResults.push(dayResult)
    }
  } else if (flags.nodes) {
    rangePull = await loadPullSnapshot(flags.nodes)
    console.log(
      `Shopee: pull de arquivo (${rangePull.nodes.length} nodes` +
        `${rangePull.pulledAt ? `, ${rangePull.pulledAt}` : ''})`,
    )
  } else {
    rangePull = await fetchShopeeRangeComplete(
      range,
      process.env.SHOPEE_APP_ID,
      process.env.SHOPEE_APP_SECRET,
      pageLimit
    )
  }

  const shopee = aggregateShopeeRange(shopeeDayResults, aliases, range, rangePull)
  const meta = aggregateMeta(metaRows, aliases, range, metaSource)
  const report = mergeAudit(shopee, meta, range)

  const dashboardMetrics = normalizeDashboardMetrics(dashboardSnapshot?.metrics)
  const dashboardSubIds = normalizeDashboardSubIdRows(
    dashboardSnapshot?.bySubId || [],
    aliases
  )

  report.comparison = {
    metrics: compareMetrics(report.dashboard, dashboardMetrics),
    bySubId: compareSubIdRows(report.bySubId, dashboardSubIds),
  }

  if (flags['firestore-compare']) {
    if (!FIRESTORE_API_KEY) {
      console.warn('Firestore: defina FIRESTORE_API_KEY para --firestore-compare')
    } else {
      const firestore = await loadFirestoreShopeeMetrics(range)
      report.firestore = {
        totals: firestore.totals,
        daysPresent: firestore.daysPresent,
        daysMissing: firestore.daysMissing,
        byDay: firestore.byDay,
      }
      report.comparison.firestoreMetrics = compareMetrics(
        report.dashboard,
        firestore.totals
      )
      report.comparison.firestoreByDay = compareFirestoreDayRows(
        report.byDay.map((row) => ({
          dateKey: row.dateKey,
          commissionLiquidated: row.commissionLiquidated,
          commissionPending: row.commissionPending,
          commissionProjected: row.commissionProjected,
          validOrders: row.validOrders,
          itemsSold: row.itemsSold,
          gmv: row.gmv,
        })),
        firestore.byDay
      )
    }
  }

  report.source = {
    ...report.source,
    dashboardMetricsLoaded: Boolean(dashboardMetrics),
    dashboardSubIdsLoaded: dashboardSubIds.length,
    metaFile: flags.meta || null,
    metaSource,
    dashboardFile: flags.dashboard || null,
    shopeePullSource: flags.nodes
      ? 'file'
      : flags['day-pull']
        ? 'api_day'
        : 'api_range',
    shopeePullFile: rangePull?.sourceFile || null,
    shopeePullAt: rangePull?.pulledAt || null,
  }

  await fs.mkdir(outDir, { recursive: true })

  const fileSlug = `${range.startDateKey}__${range.endDateKey}`

  const jsonPath = path.join(outDir, `meta-shopee-audit-${fileSlug}.json`)
  const subIdsCsvPath = path.join(
    outDir,
    `meta-shopee-audit-subids-${fileSlug}.csv`
  )
  const byDayCsvPath = path.join(
    outDir,
    `meta-shopee-audit-days-${fileSlug}.csv`
  )
  const metricsCompareCsvPath = path.join(
    outDir,
    `meta-shopee-audit-dashboard-metrics-${fileSlug}.csv`
  )
  const subIdsCompareCsvPath = path.join(
    outDir,
    `meta-shopee-audit-dashboard-subids-${fileSlug}.csv`
  )

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')

  await fs.writeFile(
    subIdsCsvPath,
    toCsv(report.bySubId, [
      'subid',
      'commissionLiquidated',
      'commissionPending',
      'commissionProjected',
      'spend',
      'profitLiquidated',
      'profitProjected',
      'roiLiquidated',
      'roiProjected',
      'roasLiquidated',
      'roasProjected',
      'gmv',
      'ticketPerItem',
      'ticketPerOrder',
      'conversionsCompleted',
      'conversionsPending',
      'validOrders',
      'cancelledOrders',
      'unpaidOrders',
      'itemsSold',
      'directItems',
      'indirectItems',
      'clicksAds',
      'pedidosPorCliquesAds',
    ]),
    'utf8'
  )

  await fs.writeFile(
    byDayCsvPath,
    toCsv(report.byDay, [
      'dateKey',
      'commissionLiquidated',
      'commissionPending',
      'commissionProjected',
      'spend',
      'profitLiquidated',
      'profitProjected',
      'roiLiquidated',
      'roiProjected',
      'roasLiquidated',
      'roasProjected',
      'validOrders',
      'cancelledOrders',
      'unpaidOrders',
      'itemsSold',
      'directItems',
      'indirectItems',
      'gmv',
      'clicksAds',
      'pedidosPorCliquesAds',
    ]),
    'utf8'
  )

  await fs.writeFile(
    metricsCompareCsvPath,
    toCsv(report.comparison.metrics || [], [
      'metric',
      'calculated',
      'dashboard',
      'delta',
      'match',
    ]),
    'utf8'
  )

  await fs.writeFile(
    subIdsCompareCsvPath,
    toCsv(report.comparison.bySubId || [], [
      'subid',
      'calculatedCommission',
      'dashboardCommission',
      'deltaCommission',
      'calculatedSpend',
      'dashboardSpend',
      'deltaSpend',
      'calculatedOrders',
      'dashboardOrders',
      'deltaOrders',
      'calculatedItems',
      'dashboardItems',
      'deltaItems',
      'onlyInCalculated',
      'onlyInDashboard',
    ]),
    'utf8'
  )

  console.log('')
  console.log(
    `Audit Meta + Shopee — ${report.period.startLabelBr} até ${report.period.endLabelBr}`
  )
  console.log('------------------------------------------------------------')
  console.log(
    `Páginas API: ${report.source.shopeePages} | nodes brutos: ${report.source.rawNodes} | pull único: ${report.source.pullUniqueNodes || report.source.rawNodes} | grupos conversão: ${report.source.uniqueConversions}`
  )
  if (report.source.aggregationMode) {
    console.log(`Agregação Shopee: ${report.source.aggregationMode}`)
  }
  console.log(`Linhas Meta usadas: ${report.source.metaRows} (${report.source.metaSource})`)
  console.log(`Investimento: R$ ${report.dashboard.investment.toFixed(2)}`)
  console.log(
    `Comissão liquidada: R$ ${report.dashboard.commissionLiquidated.toFixed(2)} | pendente: R$ ${report.dashboard.commissionPending.toFixed(2)} | projetada: R$ ${report.dashboard.commissionProjected.toFixed(2)}`
  )
  console.log(
    `ROI liquidado: ${report.dashboard.roiLiquidated === null ? '—' : `${report.dashboard.roiLiquidated.toFixed(2)}%`} | ROI projetado: ${report.dashboard.roiProjected === null ? '—' : `${report.dashboard.roiProjected.toFixed(2)}%`}`
  )
  console.log(
    `Pedidos validados: ${report.dashboard.validOrders} | cancelados: ${report.dashboard.cancelledOrders} | unpaid: ${report.dashboard.unpaidOrders}`
  )
  console.log(
    `Itens: ${report.dashboard.itemsSold} | GMV: R$ ${report.dashboard.gmv.toFixed(2)} | SubIDs com venda: ${report.dashboard.activeSubIdsWithSales}`
  )

  if (report.comparison.metrics) {
    const metricMismatches = report.comparison.metrics.filter(
      (row) => row.match === false
    )
    console.log(
      `Comparação dashboard: ${report.comparison.metrics.length} KPIs comparados | ${metricMismatches.length} divergências`
    )

    for (const row of metricMismatches.slice(0, 12)) {
      console.log(
        `  ${row.metric}: calc=${row.calculated} | dashboard=${row.dashboard} | delta=${row.delta}`
      )
    }
  }

  if (report.comparison.bySubId?.length) {
    const subIdMismatches = report.comparison.bySubId.filter(
      (row) =>
        row.deltaCommission !== 0 ||
        row.deltaSpend !== 0 ||
        row.deltaOrders !== 0 ||
        row.deltaItems !== 0 ||
        row.onlyInCalculated ||
        row.onlyInDashboard
    )

    console.log(
      `Comparação SubIDs: ${report.comparison.bySubId.length} linhas | ${subIdMismatches.length} divergentes`
    )
  }

  if (report.comparison.firestoreMetrics) {
    const fsMismatches = report.comparison.firestoreMetrics.filter(
      (row) => row.match === false
    )
    console.log(
      `Comparação Firestore live: ${report.comparison.firestoreMetrics.length} KPIs | ${fsMismatches.length} divergências`
    )
    for (const row of fsMismatches.slice(0, 12)) {
      console.log(
        `  ${row.metric}: audit=${row.calculated} | firestore=${row.dashboard} | delta=${row.delta}`
      )
    }
    const dayMismatches = (report.comparison.firestoreByDay || []).filter(
      (row) => !row.match
    )
    if (dayMismatches.length) {
      console.log(
        `  Dias divergentes: ${dayMismatches.length}/${report.comparison.firestoreByDay.length} — re-sync: node scripts/shopee-promosapp-sync.cjs --start ${range.startDateKey} --end ${range.endDateKey}`
      )
    }
  }

  console.log('Saídas:')
  console.log(`  ${jsonPath}`)
  console.log(`  ${subIdsCsvPath}`)
  console.log(`  ${byDayCsvPath}`)
  console.log(`  ${metricsCompareCsvPath}`)
  console.log(`  ${subIdsCompareCsvPath}`)
}

main().catch((error) => {
  console.error('')
  console.error('Erro no audit:')
  console.error(error)
  process.exit(1)
})

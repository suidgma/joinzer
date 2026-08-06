/**
 * LINK-HEALTH SWEEP — probe every published venue's URLs and classify what came back.
 *
 * WHY: `big-house-pickleball-colorado-springs-co` was published, tiered `source_verified`, citing
 * its own website — and is a closed business. It was caught by luck. This is the mechanism that
 * would have caught it on purpose.
 *
 *   node scripts/link-health-sweep.mjs                              # every published row
 *   node scripts/link-health-sweep.mjs --access-type=membership,private
 *   node scripts/link-health-sweep.mjs --limit=50                   # cheap subset
 *   node scripts/link-health-sweep.mjs --urls-only                  # list targets, fetch nothing
 *   node scripts/link-health-sweep.mjs --out=path/to/report.json
 *
 * READ-ONLY, AND MECHANICALLY SO. This script issues SELECTs and nothing else. There is a unit test
 * (scripts/lib/__tests__/link-health-fence.test.ts) that reads this file and the classifier and
 * asserts neither contains a mutating supabase-js verb. A scope fence that can fail is worth more
 * than one asserted in prose. It does not publish, retire, or alter any row: retiring a venue is a
 * per-venue owner decision and this tool's output is the evidence for it, never the decision.
 *
 * It also makes NO Google Places call (that is spend, and needs its own approval) and NO Nominatim
 * call of any kind — nothing here geocodes.
 *
 * ADR-14: aggregator hosts are skipped outright. Fetching a competitor's compiled listing pages in
 * bulk is the exact posture that ADR names as a distinct legal-risk surface. As of this writing 0
 * published rows carry an aggregator URL, so the filter is a guard for the day one lands, not an
 * active exclusion.
 *
 * Politeness: 1,017 distinct URLs across 671 distinct hosts, so there is no single-endpoint budget
 * like Nominatim's. The risk is hammering one host, not the population. URLs are grouped by host,
 * serialized within a host with a delay between them, and only HOST_CONCURRENCY hosts run at once.
 * The worst-concentrated host in the corpus is www.phoenix.gov at 28 URLs.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { classify, USER_AGENT, DEAD_TRANSPORT_CODES } from './lib/link-health.mjs'
import { AGGREGATOR_HOST } from './lib/workbook-extract.mjs'

// ------------------------------------------------------------------------------------------------
// Config
// ------------------------------------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase env in .env.local'); process.exit(1)
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=')
const LIMIT = arg('limit') ? Number(arg('limit')) : null
const ACCESS_TYPES = arg('access-type') ? arg('access-type').split(',').map((s) => s.trim()).filter(Boolean) : null
const URLS_ONLY = process.argv.includes('--urls-only')
const OUT = arg('out') || `link-health/sweep-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`

const HOST_CONCURRENCY = Number(arg('concurrency') || 8)
const PER_HOST_DELAY_MS = Number(arg('host-delay') || 1000)
const REQUEST_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const MAX_BODY_BYTES = 256 * 1024
/** A resolver blip must never manufacture a closure. Failed transports get one more try, later. */
const DNS_RECHECK_DELAY_MS = 20_000

const PAGE = 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase() } catch { return null } }

// ------------------------------------------------------------------------------------------------
// Load (SELECT only)
// ------------------------------------------------------------------------------------------------
/**
 * PostgREST caps a response at 1000 rows and returns a SHORT result with NO error, so a truncated
 * read is indistinguishable from a complete one. Published crossed 1000 on 2026-08-05 and silently
 * truncated the sitemap and two metro pages. Two rules, both load-bearing:
 *   - terminate when a page comes back SHORT, never when the total "looks right";
 *   - order by a UNIQUE column, or .range() windows overlap and skip rows.
 */
async function loadPublishedRows() {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from('facility_listings')
      .select('id, slug, name, metro_area, city, state, access_type, verification_status, google_place_id, website, name_source_url')
      .eq('status', 'published')
      .order('slug', { ascending: true })
      .range(from, from + PAGE - 1)
    if (ACCESS_TYPES) q = q.in('access_type', ACCESS_TYPES)

    const { data, error } = await q
    // Dropping `error` here would turn any DB failure into an empty array and a clean-looking run.
    if (error) throw new Error(`facility_listings read failed at offset ${from}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break          // short page = last page. NOT "we have enough".
  }
  return rows
}

// ------------------------------------------------------------------------------------------------
// Fetch one URL
// ------------------------------------------------------------------------------------------------
/** Read at most MAX_BODY_BYTES then stop — a classifier only needs the head of the document. */
async function readCapped(res) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
      if (total >= MAX_BODY_BYTES) break
    }
  } catch { /* a truncated body is still classifiable */ }
  try { await reader.cancel() } catch { /* already closed */ }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Follow redirects by hand so the whole chain is evidence rather than an opaque final URL.
 * Returns { status, finalUrl, chain, html, errorCode }.
 */
async function probe(url) {
  let current = url
  const chain = []
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      clearTimeout(timer)
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc && hop < MAX_REDIRECTS) {
        const next = new URL(loc, current).toString()
        chain.push({ from: current, status: res.status, to: next })
        current = next
        continue
      }
      return { status: res.status, finalUrl: current, chain, html: await readCapped(res), errorCode: null }
    } catch (err) {
      clearTimeout(timer)
      const code = err?.cause?.code || (err?.name === 'AbortError' ? 'ABORT_ERR' : err?.code) || 'UNKNOWN'
      return { status: null, finalUrl: current, chain, html: '', errorCode: code }
    }
  }
  return { status: null, finalUrl: current, chain, html: '', errorCode: 'TOO_MANY_REDIRECTS' }
}

// ------------------------------------------------------------------------------------------------
// Run
// ------------------------------------------------------------------------------------------------
async function main() {
  console.log('link-health sweep — READ-ONLY. No database writes, no Places calls, no Nominatim.\n')

  const rows = await loadPublishedRows()
  console.log(`published rows loaded: ${rows.length}${ACCESS_TYPES ? ` (access_type in ${ACCESS_TYPES.join(',')})` : ''}`)

  // ---- Build the URL work list, deduped, with the row(s) that cite each URL ----------------
  const urlMap = new Map()   // url -> { url, host, rows: [{slug, field}] }
  const skippedAggregator = []
  for (const row of rows) {
    for (const field of ['website', 'name_source_url']) {
      const raw = (row[field] || '').trim()
      if (!raw) continue
      if (!/^https?:\/\//i.test(raw)) continue
      if (AGGREGATOR_HOST.test(raw)) { skippedAggregator.push({ slug: row.slug, field, url: raw }); continue }
      const host = hostOf(raw)
      if (!host) continue
      if (!urlMap.has(raw)) urlMap.set(raw, { url: raw, host, rows: [] })
      urlMap.get(raw).rows.push({ slug: row.slug, field })
    }
  }

  // How many published rows cite each host — the classifier uses this to tell a venue's own site
  // from a municipal one, which is what stops "courts closed for resurfacing" reaching bucket 1.
  const hostRowCount = new Map()
  for (const { host, rows: citing } of urlMap.values()) {
    const slugs = hostRowCount.get(host) || new Set()
    citing.forEach((c) => slugs.add(c.slug))
    hostRowCount.set(host, slugs)
  }

  let targets = [...urlMap.values()]
  if (LIMIT) targets = targets.slice(0, LIMIT)

  const byHost = new Map()
  for (const t of targets) {
    if (!byHost.has(t.host)) byHost.set(t.host, [])
    byHost.get(t.host).push(t)
  }

  console.log(`distinct URLs to probe : ${targets.length}`)
  console.log(`distinct hosts         : ${byHost.size}`)
  console.log(`aggregator URLs skipped (ADR-14): ${skippedAggregator.length}`)
  if (URLS_ONLY) {
    targets.forEach((t) => console.log(`  ${t.url}  [${t.rows.map((r) => `${r.slug}:${r.field}`).join(', ')}]`))
    return
  }
  console.log(`concurrency ${HOST_CONCURRENCY} hosts, ${PER_HOST_DELAY_MS}ms between requests to the same host\n`)

  // ---- Probe, grouped by host --------------------------------------------------------------
  const results = new Map()
  const groups = [...byHost.values()]
  let cursor = 0
  let done = 0
  const started = Date.now()

  const worker = async () => {
    for (;;) {
      const idx = cursor++
      if (idx >= groups.length) return
      const group = groups[idx]
      for (let i = 0; i < group.length; i++) {
        if (i > 0) await sleep(PER_HOST_DELAY_MS)
        const t = group[i]
        const observed = await probe(t.url)
        results.set(t.url, { target: t, observed })
        done++
        if (done % 100 === 0) {
          const rate = done / ((Date.now() - started) / 1000)
          console.log(`  … ${done}/${targets.length} probed (${rate.toFixed(1)}/s)`)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(HOST_CONCURRENCY, groups.length) }, worker))
  console.log(`probed ${done} URLs in ${((Date.now() - started) / 1000).toFixed(0)}s\n`)

  // ---- Second pass: re-resolve every transport failure before calling anything gone ---------
  const suspects = [...results.values()].filter(({ observed }) => observed.errorCode && DEAD_TRANSPORT_CODES.has(observed.errorCode))
  if (suspects.length) {
    console.log(`re-checking ${suspects.length} transport failure(s) after ${DNS_RECHECK_DELAY_MS / 1000}s — a single resolver failure is not evidence`)
    await sleep(DNS_RECHECK_DELAY_MS)
    for (const s of suspects) {
      const again = await probe(s.target.url)
      s.recheck = again
      s.dnsRecheckFailed = Boolean(again.errorCode && DEAD_TRANSPORT_CODES.has(again.errorCode))
      console.log(`  ${s.dnsRecheckFailed ? 'FAILED AGAIN' : 'recovered   '}  ${s.target.url}`)
      await sleep(500)
    }
    console.log('')
  }

  // ---- Classify ------------------------------------------------------------------------------
  const urlFindings = []
  for (const { target, observed, dnsRecheckFailed } of results.values()) {
    const verdict = classify({
      requestUrl: target.url,
      finalUrl: observed.finalUrl,
      status: observed.status,
      errorCode: observed.errorCode,
      html: observed.html,
      hostRowCount: (hostRowCount.get(target.host) || new Set()).size,
      dnsRecheckFailed: dnsRecheckFailed ?? null,
    })
    urlFindings.push({
      url: target.url,
      host: target.host,
      finalUrl: observed.finalUrl,
      status: observed.status,
      errorCode: observed.errorCode,
      redirects: observed.chain,
      citedBy: target.rows,
      ...verdict,
    })
  }

  // ---- Roll up to rows. A row is as bad as its worst URL. -----------------------------------
  const RANK = { gone: 3, broken: 2, blocked: 1, healthy: 0 }
  const findingsBySlug = new Map()
  for (const f of urlFindings) {
    for (const c of f.citedBy) {
      if (!findingsBySlug.has(c.slug)) findingsBySlug.set(c.slug, [])
      findingsBySlug.get(c.slug).push({ field: c.field, ...f })
    }
  }
  const rowReport = rows
    .filter((r) => findingsBySlug.has(r.slug))
    .map((r) => {
      const fs = findingsBySlug.get(r.slug)
      const worst = fs.reduce((acc, f) => (RANK[f.bucket] > RANK[acc] ? f.bucket : acc), 'healthy')
      return {
        slug: r.slug,
        name: r.name,
        metro_area: r.metro_area,
        city: r.city,
        state: r.state,
        access_type: r.access_type,
        verification_status: r.verification_status,
        google_place_id: r.google_place_id,
        has_place_id: Boolean(r.google_place_id),
        website: r.website,
        name_source_url: r.name_source_url,
        // One dead link takes out both "sources" when they are the same URL — which is the common case.
        single_url_row: Boolean(r.website && r.name_source_url && r.website.trim() === r.name_source_url.trim()),
        bucket: worst,
        findings: fs.map((f) => ({ field: f.field, url: f.url, status: f.status, errorCode: f.errorCode, bucket: f.bucket, signal: f.signal, evidence: f.evidence, confidence: f.confidence })),
      }
    })
    .sort((a, b) => RANK[b.bucket] - RANK[a.bucket] || a.slug.localeCompare(b.slug))

  // ---- Report --------------------------------------------------------------------------------
  const counts = (list, key) => list.reduce((m, x) => ({ ...m, [x[key]]: (m[x[key]] || 0) + 1 }), {})
  const COMMERCIAL = new Set(['membership', 'private'])
  const summary = {
    urls: counts(urlFindings, 'bucket'),
    rows: counts(rowReport, 'bucket'),
    commercialRowsByBucket: counts(rowReport.filter((r) => COMMERCIAL.has(r.access_type)), 'bucket'),
  }

  console.log('=== URL buckets ==='); console.table(summary.urls)
  console.log('=== ROW buckets (worst URL wins) ==='); console.table(summary.rows)
  console.log('=== ROW buckets, membership+private only ==='); console.table(summary.commercialRowsByBucket)

  for (const bucket of ['gone', 'broken', 'blocked']) {
    const list = rowReport.filter((r) => r.bucket === bucket)
    console.log(`\n---------- ${bucket.toUpperCase()} (${list.length} rows) ----------`)
    for (const r of list.slice(0, bucket === 'blocked' ? 40 : 200)) {
      console.log(`${COMMERCIAL.has(r.access_type) ? '*' : ' '} ${r.slug}  [${r.access_type}, ${r.metro_area}]  place_id=${r.has_place_id ? 'YES' : 'no'}`)
      r.findings.filter((f) => f.bucket === bucket).forEach((f) => console.log(`      ${f.field}: ${f.url}\n        → ${f.signal}: ${f.evidence}`))
    }
    if (bucket === 'blocked' && list.length > 40) console.log(`  … ${list.length - 40} more (see the JSON)`)
  }

  const artifact = {
    _meta: {
      run_at: new Date().toISOString(),
      read_only: true,
      filters: { access_type: ACCESS_TYPES, limit: LIMIT },
      published_rows_loaded: rows.length,
      urls_probed: urlFindings.length,
      distinct_hosts: byHost.size,
      aggregator_urls_skipped: skippedAggregator.length,
      summary,
      note: 'healthy = NOT PROVEN BROKEN. Soft-404s (HTTP 200 on a page that does not exist) are not detected and land in healthy. blocked is explicitly NOT a closure signal.',
    },
    rows: rowReport,
    urls: urlFindings,
    skippedAggregator,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 1))
  console.log(`\nartifact: ${OUT}`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })

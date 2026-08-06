/**
 * LINK-HEALTH CLASSIFIER — is a published venue's URL evidence that the venue is GONE?
 *
 * WHY THIS EXISTS. `big-house-pickleball-colorado-springs-co` was published, tiered
 * `source_verified`, and citing its own website — while being a closed business. It was caught by
 * luck during a re-research pass. 1,202 published venues carry no mechanism for detecting a
 * closure at all. ADR-17 accepted stale entries deliberately, but a closed business is a different
 * failure from a stale court count: it sends a player to a locked door.
 *
 * THIS MODULE IS PURE. No network, no database, no argv, no process.exit. Every decision the sweep
 * makes about what a response MEANS lives here, so it can be unit-tested against fixtures. The
 * runner (scripts/link-health-sweep.mjs) does the I/O and calls `classify()`. That split is the
 * same one publish-gate.mjs established, and for the same reason: logic trapped inside a script
 * that reads argv at module scope cannot be imported and therefore cannot be tested.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO RULES THIS MODULE EXISTS TO GET RIGHT
 *
 * 1. A 403 IS NOT A CLOSURE. It means "this host blocked an automated fetch", nothing more.
 *    Three documented live municipal sites refuse us and are perfectly alive:
 *      - cityofhenderson.com        403 to automated fetches; 10/10 succeeded via Firecrawl
 *      - cityofnorthlasvegas.com    403, same
 *      - townofcolonie.gov          402 to WebFetch; 200 to a browser-UA curl
 *      - leegov.com                 403 to WebFetch; 200 to curl with a browser UA
 *    A sweep that reports those as dead is worse than no sweep, because someone will act on it.
 *    So 401/402/403/405/406/407/408/409/423/429 and every 5xx classify `blocked` — a bucket that
 *    is LOUD and explicitly not a signal, never quietly folded into "broken".
 *
 * 2. CLOSURE LANGUAGE IS POSITION-WEIGHTED, NOT BOOLEAN. "Permanently closed" matched anywhere in
 *    a page body fires on municipal park pages ("courts closed for resurfacing"), news sidebars and
 *    review embeds. A boolean matcher would have shipped a bucket-1 list full of live public parks.
 *    So a hit only reaches `gone` when it is in the <title>/<meta description>/<h1> AND the host is
 *    the venue's own domain. A body-only hit, or any hit on a host shared by several published rows
 *    (i.e. a municipal site), is demoted to `broken`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * Soft-404 detection. leegov.com returns HTTP 200 with an EMPTY <title> for pages that do not
 * exist — 5 of 10 probed URLs were phantom 200s. Detecting that reliably is a different and much
 * harder problem than detecting closure, and getting it half-right would poison the healthy bucket
 * in the direction that costs trust. A soft-404 therefore lands in `healthy`. This is why `healthy`
 * means "NOT PROVEN BROKEN" and never "confirmed alive" — say it that way in any report.
 */

export const USER_AGENT =
  'Joinzer-link-health/1.0 (+https://www.joinzer.com; pickleball court directory link check)'

/** Page gone. Real, but on a live domain it is as likely a MOVED page as a closed venue → bucket 2. */
export const DEAD_STATUS = new Set([404, 410])

/**
 * "The host refused or failed to serve us." NOT evidence about the venue, in either direction.
 * 403 and 402 are here on measured evidence (see the header). 429 is rate limiting — our fault,
 * not theirs. 5xx is handled by range in `isInconclusiveStatus`.
 */
export const INCONCLUSIVE_STATUS = new Set([401, 402, 403, 405, 406, 407, 408, 409, 423, 429, 451])

export const isInconclusiveStatus = (status) =>
  typeof status === 'number' && (INCONCLUSIVE_STATUS.has(status) || status >= 500)

/**
 * Transport-layer outcomes, split by what they actually prove. This split IS the bucket-1/bucket-3
 * boundary, and it lives in `error.cause.code` — the HTTP status is null for all of them.
 */
/** The name does not resolve / nothing is listening. Strong — but only after a second resolve. */
export const DEAD_TRANSPORT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ERR_NAME_NOT_RESOLVED'])
/** TLS is broken. Often a lapsed account, often just a sloppy municipal renewal. Never bucket 1 alone. */
export const TLS_TRANSPORT_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_SSL_WRONG_VERSION_NUMBER',
])
/**
 * Everything transient. EAI_AGAIN is the one that looks like ENOTFOUND and is not: it is a
 * TEMPORARY resolver failure ("try again"), which is precisely the blip that must never be allowed
 * to manufacture a closure.
 */
export const TRANSIENT_TRANSPORT_CODES = new Set([
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ABORT_ERR',
])

/**
 * Lapsed-hosting and domain-parking signatures.
 *
 * The BLVD Pickleball precedent is the shape to catch: the custom domain AND the underlying
 * Squarespace subdomain both read "Squarespace — Website Expired". The whole hosting account had
 * lapsed, which is materially stronger than a broken page — a business that is still trading pays
 * its hosting bill.
 */
const PARKED_PATTERNS = [
  [/website\s+expired/i, 'hosting expired ("website expired")'],
  [/domain\s+(name\s+)?(has\s+)?expired/i, 'domain expired'],
  [/this\s+domain\s+(name\s+)?is\s+(parked|for\s+sale)/i, 'domain parked / for sale'],
  [/\bparked\s+(free\s+)?(by|at|with)\b/i, 'domain parking page'],
  [/account\s+suspended/i, 'hosting account suspended'],
  [/this\s+site\s+is\s+temporarily\s+unavailable/i, 'hosting over quota / suspended'],
  [/buy\s+this\s+domain/i, 'domain listed for sale'],
  [/future\s+home\s+of\s+something\s+quite\s+cool/i, 'empty cPanel default page'],
  [/welcome\s+to\s+nginx/i, 'bare server default — no site deployed'],
  [/^\s*default\s+web\s+site\s+page\s*$/im, 'bare IIS default — no site deployed'],
]

/** Hosts that only ever appear when a domain has been dropped into a resale marketplace. */
export const PARKING_HOST = /(^|\.)(hugedomains|dan|afternic|sedo|sedoparking|parkingcrew|bodis|undeveloped|namecheap-parking)\.(com|net|org)$/i

/**
 * Phrases that assert the BUSINESS is finished — not that a facility is shut today.
 * Kept narrow on purpose. Breadth here is paid for entirely in false positives.
 */
const CLOSURE_PATTERNS = [
  [/permanently\s+closed/i, 'permanently closed'],
  [/closed\s+(its\s+doors\s+)?permanently/i, 'closed permanently'],
  [/closed\s+for\s+good/i, 'closed for good'],
  [/no\s+longer\s+in\s+business/i, 'no longer in business'],
  [/out\s+of\s+business/i, 'out of business'],
  [/ceased\s+(operations|trading)/i, 'ceased operations'],
  [/has\s+closed\s+(its\s+doors|permanently|for\s+good)/i, 'has closed its doors'],
  // "we've" has NO space before the apostrophe — `we\s+'ve` never matches it. Contraction and the
  // spelled-out form need separate branches.
  [/we\s*(?:'|’)\s*ve\s+closed/i, "we've closed"],
  [/we\s+have\s+closed/i, 'we have closed'],
  [/we\s+are\s+(now\s+)?closed\s+(permanently|for\s+good|indefinitely)/i, 'we are closed permanently'],
  [/(is|are)\s+no\s+longer\s+(open|operating|accepting)/i, 'no longer open'],
  [/thank\s+you\s+(all\s+)?for\s+(the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(\w+\s+){0,2}years/i, 'thank you for N years'],
  [/after\s+\d+\s+(\w+\s+){0,2}years[,\s]+(we|the)\b[^.]{0,80}\bclos/i, 'after N years ... closing'],
  [/going\s+out\s+of\s+business/i, 'going out of business'],
]

/**
 * Qualifiers that make a nearby "closed" mean something entirely different. Checked in a window
 * around each candidate match, because these are the exact strings a public park page carries and
 * public parks are 884 of the 1,202 published rows.
 */
const CLOSURE_NEGATORS = [
  /temporar(ily|y)/i,
  /for\s+(the\s+)?(season|winter|summer|holidays?|maintenance|renovations?|resurfacing|repairs?|construction|cleaning|the\s+day|lunch)/i,
  /(will\s+)?re-?open/i,
  /closed\s+(on\s+)?(mon|tue|wed|thu|fri|sat|sun)/i,
  /closed\s+(today|tomorrow|now|daily|weekends?|holidays?)/i,
  /closed\s+\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /due\s+to\s+(weather|rain|snow|ice|storm)/i,
  /(court|pool|field|rink|track|restroom|playground|trail)s?\s+(are\s+|is\s+)?(currently\s+)?closed/i,
]

const NEGATOR_WINDOW = 140

/**
 * ASSET-BORNE CLOSURE — the signal that made the first version of this module miss its own control.
 *
 * `thebighousepickleball.com` announces its closure by swapping the hero graphic for a file named
 * `BHPB%20CLOSED.png`. The page's TEXT is untouched stale template copy — nav, pricing, "Become a
 * Member", "BOOK NOW" — so a text-only classifier reads it as a thriving business and always will.
 * The signal was in the response the entire time; `extractPageFields` was throwing away the <img>
 * tags before matching. Operators announce closure in the picture, because the picture IS the page.
 *
 * WHY A BARE `closed` TOKEN IS ALLOWED HERE AND NOWHERE ELSE. Prose gets the narrow phrase list —
 * "permanently closed", "no longer in business" — because a body full of words offers a hundred
 * innocent ways to say "closed". A filename is a deliberate, compressed authoring act: somebody
 * opened an image editor, made a sign, and named the file. `BHPB CLOSED.png` carries no qualifier
 * because it does not need one. The looser token is affordable ONLY because it is paired with the
 * same two guards the prose matcher uses — the venue's own domain, and the negator sweep — plus a
 * wider negator list below, since a filename has no sentence around it to disambiguate.
 */
const ASSET_BARE_CLOSED = /\bclosed\b/i

/**
 * Filenames lack sentence context, so order-independent qualifiers are needed: the prose negators
 * mostly key on "closed" appearing immediately before the qualifier, which `mondays-closed.png`
 * defeats by reversing it. These fire anywhere in the window.
 */
const ASSET_NEGATORS = [
  /\b(mon|tues|wednes|thurs|fri|satur|sun)day/i,
  /\b(weekend|holiday|season|winter|summer|spring|autumn|fall)/i,
  /\b(weather|rain|snow|ice|storm|wind)/i,
  /\b(hours?|schedule|calendar|timetable)\b/i,
  /\b(maintenance|renovat|resurfac|repair|construction|cleaning|upgrade|improvement)/i,
  /\btemporar/i,
  /\bre-?open/i,
  /\benclosed\b/i,
  /\b(disclosed|foreclosed|closed[- ]?captions?)\b/i,
  /\b(covid|pandemic)\b/i,
  /\b(alert|advisory)\b/i,
  // MEASURED FALSE POSITIVES, 2026-08-06 full sweep. Both were the closure of something that is
  // not the venue, on a town site the .gov test does not catch (ormondbeach.org, akron-pa.com):
  //   "City Hall Closed Notice"  -> a civic BUILDING closed, not the park
  //   "Road Closed"              -> a STREET closed, not the park
  // Named narrowly by subject rather than by guessing which hosts are municipal.
  /\b(hall|office|lobby|clubhouse|restroom|library|kitchen|cafe|concession)\b/i,
  /\b(road|street|avenue|blvd|boulevard|bridge|detour|sidewalk|parking|ramp|driveway|entrance|gate)\b/i,
]

/**
 * Find business-closure language, rejecting matches a nearby qualifier explains away.
 * Returns the first surviving match, or null.
 */
export function closureLanguage(text) {
  if (!text || typeof text !== 'string') return null
  for (const [pattern, label] of CLOSURE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    let m
    while ((m = re.exec(text)) !== null) {
      const from = Math.max(0, m.index - NEGATOR_WINDOW)
      const window = text.slice(from, m.index + m[0].length + NEGATOR_WINDOW)
      if (CLOSURE_NEGATORS.some((n) => n.test(window))) continue
      return {
        phrase: label,
        matched: m[0].replace(/\s+/g, ' ').trim(),
        index: m.index,
        excerpt: text.slice(from, m.index + m[0].length + 90).replace(/\s+/g, ' ').trim(),
      }
    }
  }
  return null
}

/**
 * Pull every image reference and its alt text out of raw HTML, percent-decoded and flattened so a
 * filename reads as words. `BHPB%20CLOSED.png` → `BHPB CLOSED png`; `enclosed-court.png` →
 * `enclosed court png`, which the `\b` in ASSET_BARE_CLOSED correctly refuses to match.
 *
 * The whole URL is scanned, not just the basename: the Big House graphic sits MID-PATH inside a CDN
 * transform (`…/BHPB%20CLOSED.png/:/cr=t:3.95%25,…`), so a basename parse returns `cr=t:3.95%,…`
 * and finds nothing.
 */
export function extractAssetText(html) {
  if (!html || typeof html !== 'string') return ''
  const values = new Set()
  const attrs = /\b(?:src|srcset|data-src|data-srcset|data-lazy-src|poster|alt)\s*=\s*["']([^"']{1,600})["']/gi
  let m
  while ((m = attrs.exec(html)) !== null) values.add(m[1])
  const og = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']{1,600})["']/gi
  while ((m = og.exec(html)) !== null) values.add(m[1])

  let text = [...values].join(' ')
  // Decode once; a malformed sequence must not throw and lose the whole page.
  try { text = decodeURIComponent(text.replace(/%(?![0-9a-f]{2})/gi, '%25')) } catch { /* use raw */ }
  return text
    .replace(/[-_+./\\:,?&=|#~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000)
}

/**
 * Closure language in an image reference. Accepts the strong prose phrases OR a bare `closed`
 * token, then applies both negator lists. Returns the first surviving hit, or null.
 */
export function closureInAssets(assetText) {
  if (!assetText || typeof assetText !== 'string') return null

  const survives = (index, length) => {
    const from = Math.max(0, index - NEGATOR_WINDOW)
    const window = assetText.slice(from, index + length + NEGATOR_WINDOW)
    return !CLOSURE_NEGATORS.some((n) => n.test(window)) && !ASSET_NEGATORS.some((n) => n.test(window))
  }

  // Strong prose first — "permanently-closed.png" should report the specific phrase, not "closed".
  const prose = closureLanguage(assetText)
  if (prose && survives(prose.index, prose.matched.length)) {
    return { phrase: prose.phrase, matched: prose.matched, excerpt: prose.excerpt, strength: 'phrase' }
  }

  const re = new RegExp(ASSET_BARE_CLOSED.source, 'gi')
  let m
  while ((m = re.exec(assetText)) !== null) {
    if (!survives(m.index, m[0].length)) continue
    const from = Math.max(0, m.index - 60)
    return {
      phrase: 'closed (image filename / alt text)',
      matched: m[0],
      excerpt: assetText.slice(from, m.index + m[0].length + 60).trim(),
      // A bare token is real evidence but weaker than a prose phrase — the first full sweep
      // returned 1 true positive and 2 false ones on this rule before the subject negators landed.
      strength: 'token',
    }
  }
  return null
}

/** Lapsed hosting / parked domain. Returns a reason string or null. */
export function parkedHosting(text) {
  if (!text || typeof text !== 'string') return null
  for (const [pattern, label] of PARKED_PATTERNS) if (pattern.test(text)) return label
  return null
}

/**
 * Multi-part public suffixes we actually encounter. The corpus is US municipal + US commercial, so
 * this is deliberately short rather than a full public-suffix list — a dependency for six strings
 * is not worth the supply-chain surface. `<name>.<2-letter-state>.us` is handled by rule below.
 */
const MULTI_PART_TLD = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za'])
const US_STATE = /^[a-z]{2}$/

/**
 * The domain a redirect target has to share to count as "the same place".
 * Comparing full hostnames would flag every www→apex and every CDN subdomain as a takeover.
 */
export function registrableDomain(hostOrUrl) {
  if (!hostOrUrl || typeof hostOrUrl !== 'string') return null
  let host = hostOrUrl
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try { host = new URL(host).hostname } catch { return null }
  }
  host = host.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '')
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host || null
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.') || null
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_PART_TLD.has(lastTwo)) return parts.slice(-3).join('.')
  // ci.lakewood.ca.us / parks.buffalo.ny.us → keep three labels so two towns in one state differ.
  if (parts.at(-1) === 'us' && US_STATE.test(parts.at(-2))) return parts.slice(-3).join('.')
  return lastTwo
}

/** Did the request land on a different registrable domain than we asked for? */
export function isUnrelatedRedirect(requestUrl, finalUrl) {
  const a = registrableDomain(requestUrl)
  const b = registrableDomain(finalUrl)
  if (!a || !b) return false
  return a !== b
}

/**
 * Is this host plausibly THE VENUE'S OWN site, as opposed to a municipal or shared one?
 *
 * Derived from the data rather than guessed: a host serving exactly one published row is a single
 * venue's site; a host serving several is a city/county/parks-department site where a closure
 * notice is about one facility among many. Government TLDs are excluded outright — a .gov is never
 * a commercial venue's own domain, and public park courts are the class that gets resurfaced and
 * renamed rather than closing.
 */
export function isVenueOwnHost({ hostname, hostRowCount }) {
  if (!hostname) return false
  const h = hostname.toLowerCase()
  if (/\.gov$/.test(h) || /\.gov\./.test(h) || /\.mil$/.test(h)) return false
  if (/\.k12\.[a-z]{2}\.us$/.test(h) || /\.[a-z]{2}\.us$/.test(h)) return false
  return hostRowCount === 1
}

/** Strip an HTML document to the fields the classifier weights, plus a flattened body. */
export function extractPageFields(html) {
  const empty = { title: '', metaDescription: '', headings: '', body: '', assets: '' }
  if (!html || typeof html !== 'string') return empty
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ')
  const metaDescription =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:(?:title|description)["'][^>]*content=["']([^"']*)["']/i)?.[1] ||
    ''
  const headings = [...stripped.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' '))
    .join(' | ')
  const body = stripped.replace(/<[^>]+>/g, ' ')

  const tidy = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim()
  return {
    title: tidy(title),
    metaDescription: tidy(metaDescription),
    headings: tidy(headings),
    body: tidy(body),
    // Read from the RAW html: `stripped` has already discarded the <img> tags this needs.
    assets: extractAssetText(html),
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', '#39': "'", '#8217': '’' }
const decodeEntities = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const key = name.toLowerCase()
    if (ENTITIES[key]) return ENTITIES[key]
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16))
    if (/^#/.test(name)) return String.fromCodePoint(parseInt(name.slice(1), 10))
    return whole
  })

export const BUCKET = { GONE: 'gone', BROKEN: 'broken', BLOCKED: 'blocked', HEALTHY: 'healthy' }

/**
 * Classify one observed URL.
 *
 * @param {object} o
 * @param {string}  o.requestUrl        the URL as stored on the row
 * @param {string} [o.finalUrl]         after following redirects
 * @param {number|null} [o.status]      HTTP status, or null when the request never completed
 * @param {string|null} [o.errorCode]   error.cause.code when it did not complete
 * @param {string} [o.html]             response body (may be truncated — that is fine)
 * @param {number} [o.hostRowCount]     how many published rows cite this host
 * @param {boolean|null} [o.dnsRecheckFailed]
 *        Second-pass resolve result for a transport failure. `true` = failed twice (trust it),
 *        `false` = recovered (it was a blip), `null` = not re-checked yet, so do NOT call it gone.
 * @returns {{bucket:string, signal:string, evidence:string, confidence:string}}
 */
export function classify(o) {
  const { requestUrl, finalUrl = o.requestUrl, status = null, errorCode = null, html = '', hostRowCount = 1, dnsRecheckFailed = null } = o || {}

  // ---- 1. The request never completed. The code, not the status, decides. -----------------
  if (errorCode) {
    if (TLS_TRANSPORT_CODES.has(errorCode)) {
      return r(BUCKET.BROKEN, 'tls-failure', `TLS error ${errorCode} — certificate broken; site may still be operating`, 'low')
    }
    if (DEAD_TRANSPORT_CODES.has(errorCode)) {
      if (dnsRecheckFailed === true) {
        return r(BUCKET.GONE, errorCode === 'ECONNREFUSED' ? 'connection-refused' : 'dns-nxdomain',
          `${errorCode} on two separate attempts — domain does not resolve / refuses connections`, 'high')
      }
      // Not yet re-checked, or it recovered. A single resolver failure proves nothing.
      return r(BUCKET.BLOCKED, 'transport-unconfirmed',
        dnsRecheckFailed === false
          ? `${errorCode} on first attempt but resolved on re-check — transient`
          : `${errorCode} (not re-checked — single failure is not evidence)`, 'low')
    }
    return r(BUCKET.BLOCKED, 'transport-transient', `${errorCode} — transient or blocked, not a closure signal`, 'none')
  }

  // ---- 2. The host refused us. Loudly not a signal. ---------------------------------------
  if (isInconclusiveStatus(status)) {
    return r(BUCKET.BLOCKED, 'http-blocked',
      `HTTP ${status} — the host refused or failed to serve an automated request. NOT evidence of closure.`, 'none')
  }

  // ---- 3. Page gone, domain alive. Could equally be a moved page. -------------------------
  if (typeof status === 'number' && DEAD_STATUS.has(status)) {
    return r(BUCKET.BROKEN, 'http-not-found', `HTTP ${status} on a live domain — page gone, venue status unknown`, 'medium')
  }

  const parkingRedirect = finalUrl && PARKING_HOST.test(safeHost(finalUrl))
  const unrelated = requestUrl && finalUrl && isUnrelatedRedirect(requestUrl, finalUrl)

  // A domain that now resolves to a resale marketplace was dropped by its owner.
  if (parkingRedirect) {
    return r(BUCKET.GONE, 'parked-redirect', `redirects to domain marketplace ${safeHost(finalUrl)} — domain released by its owner`, 'high')
  }

  const fields = extractPageFields(html)

  // ---- 4. Lapsed hosting. The BLVD pattern. -----------------------------------------------
  const parked = parkedHosting(`${fields.title} ${fields.headings} ${fields.body}`)
  if (parked) {
    return r(BUCKET.GONE, 'parked-hosting', `${parked} — hosting account lapsed (title: "${fields.title || '(none)'}")`, 'high')
  }

  // ---- 5. Closure language, position-weighted. --------------------------------------------
  const prominent = closureLanguage(`${fields.title} — ${fields.metaDescription} — ${fields.headings}`)
  const ownHost = isVenueOwnHost({ hostname: safeHost(finalUrl || requestUrl), hostRowCount })

  if (prominent && ownHost) {
    return r(BUCKET.GONE, 'closure-language-prominent',
      `"${prominent.phrase}" in title/meta/h1 on the venue's own domain — "${prominent.excerpt}"`, 'high')
  }
  if (prominent) {
    return r(BUCKET.BROKEN, 'closure-language-shared-host',
      `"${prominent.phrase}" prominent, but this host serves ${hostRowCount} published rows or is a government domain — may refer to another facility: "${prominent.excerpt}"`, 'medium')
  }

  // The Big House case: text says "Become a Member", the hero graphic is named CLOSED.png.
  // Same weighting as prose — own domain is the signal, a shared/municipal host is not.
  const asset = closureInAssets(fields.assets)
  if (asset && ownHost) {
    return r(BUCKET.GONE, 'closure-language-asset',
      `"${asset.phrase}" in an image reference on the venue's own domain — "${asset.excerpt}" (page TEXT may still read as open; operators announce closure in the graphic)`,
      asset.strength === 'phrase' ? 'high' : 'medium')
  }
  if (asset) {
    return r(BUCKET.BROKEN, 'closure-language-asset-shared-host',
      `"${asset.phrase}" in an image reference, but this host serves ${hostRowCount} published rows or is a government domain — may refer to another facility: "${asset.excerpt}"`, 'low')
  }
  const inBody = closureLanguage(fields.body)
  if (inBody) {
    return r(BUCKET.BROKEN, 'closure-language-body',
      `"${inBody.phrase}" in page body only (not title/meta/h1) — "${inBody.excerpt}"`, 'low')
  }

  // ---- 6. Landed somewhere else entirely. -------------------------------------------------
  if (unrelated) {
    return r(BUCKET.BROKEN, 'unrelated-redirect',
      `redirects to a different domain: ${registrableDomain(requestUrl)} → ${registrableDomain(finalUrl)} — sold, merged, or rebranded`, 'medium')
  }

  if (typeof status === 'number' && status >= 300 && status < 400) {
    return r(BUCKET.BROKEN, 'redirect-loop', `HTTP ${status} — redirect chain did not terminate`, 'low')
  }

  // NOT "confirmed alive" — see the module header on soft-404s.
  return r(BUCKET.HEALTHY, 'ok', `HTTP ${status} — not proven broken`, 'none')
}

const r = (bucket, signal, evidence, confidence) => ({ bucket, signal, evidence, confidence })
const safeHost = (u) => { try { return new URL(u).hostname } catch { return '' } }

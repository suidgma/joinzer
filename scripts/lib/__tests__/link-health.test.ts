/**
 * Tests for the link-health classifier.
 *
 * The weighting here is deliberate. Two rules carry essentially all the risk in this tool, and both
 * fail in the direction of a CONFIDENT WRONG ANSWER rather than a missing one:
 *
 *   1. 403-is-not-dead. Three documented live municipal sites refuse automated fetches. A sweep
 *      that reports them closed is worse than no sweep, because someone acts on it.
 *   2. The closure matcher. A boolean "permanently closed" match fires on every municipal page
 *      reading "courts closed for resurfacing" — and public parks are 884 of the 1,202 published
 *      rows, so the false-positive class is the MAJORITY of the corpus.
 *
 * So the closure tests below carry as many FALSE-POSITIVE fixtures as true-positive ones. A matcher
 * proven only against cases it should catch tells you nothing about the ones it must not.
 *
 * link-health.mjs is plain ESM with no types, so tsc widens its exports. Typed wrappers at the
 * boundary keep `tsc --noEmit` green without loosening it — same pattern as publish-gate.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  BUCKET,
  DEAD_STATUS,
  INCONCLUSIVE_STATUS,
  classify,
  closureLanguage,
  extractPageFields,
  isInconclusiveStatus,
  isUnrelatedRedirect,
  isVenueOwnHost,
  parkedHosting,
  registrableDomain,
} from '../link-health.mjs'

type Obs = Record<string, any>
type Verdict = { bucket: string; signal: string; evidence: string; confidence: string }

const run = classify as (o: Obs) => Verdict
const closure = closureLanguage as (t: string) => { phrase: string; excerpt: string } | null
const parked = parkedHosting as (t: string) => string | null
const regDomain = registrableDomain as (h: string) => string | null
const unrelated = isUnrelatedRedirect as (a: string, b: string) => boolean
const ownHost = isVenueOwnHost as (o: { hostname: string; hostRowCount: number }) => boolean
const fields = extractPageFields as (h: string) => { title: string; metaDescription: string; headings: string; body: string }
const inconclusive = isInconclusiveStatus as (s: number) => boolean
const B = BUCKET as { GONE: string; BROKEN: string; BLOCKED: string; HEALTHY: string }

const page = (opts: { title?: string; meta?: string; h1?: string; body?: string }) => `
<!doctype html><html><head>
<title>${opts.title ?? 'Some Venue'}</title>
${opts.meta ? `<meta name="description" content="${opts.meta}">` : ''}
</head><body>
${opts.h1 ? `<h1>${opts.h1}</h1>` : ''}
<p>${opts.body ?? 'Courts, lessons and open play.'}</p>
</body></html>`

// =================================================================================================
// RULE 1 — a blocked fetch is NEVER a closure signal
// =================================================================================================
describe('403 and friends are blocked, not dead', () => {
  // cityofhenderson.com and cityofnorthlasvegas.com 403 every automated fetch and are perfectly
  // alive — 10/10 succeeded through Firecrawl. townofcolonie.gov answers 402. leegov.com 403s.
  it.each([401, 402, 403, 405, 406, 407, 408, 409, 423, 429, 451, 500, 502, 503, 504, 599])(
    'HTTP %i classifies blocked with no confidence',
    (status) => {
      const v = run({ requestUrl: 'https://www.cityofhenderson.com/parks', status, html: '' })
      expect(v.bucket).toBe(B.BLOCKED)
      expect(v.confidence).toBe('none')
      expect(v.evidence).toMatch(/NOT evidence of closure/)
    },
  )

  it('never reports a blocked status as gone even when the body looks like a closure page', () => {
    // A WAF interstitial can contain anything. The status decides first.
    const v = run({
      requestUrl: 'https://www.cityofnorthlasvegas.com/parks/court',
      status: 403,
      html: page({ title: 'Permanently Closed' }),
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.BLOCKED)
    expect(v.bucket).not.toBe(B.GONE)
  })

  it('keeps 403 out of the dead-status set entirely', () => {
    expect((DEAD_STATUS as Set<number>).has(403)).toBe(false)
    expect((INCONCLUSIVE_STATUS as Set<number>).has(403)).toBe(true)
    expect(inconclusive(403)).toBe(true)
    expect(inconclusive(200)).toBe(false)
    expect(inconclusive(404)).toBe(false)
  })
})

describe('transport failures split by what they prove', () => {
  it('calls NXDOMAIN gone ONLY after a second resolve also failed', () => {
    const v = run({ requestUrl: 'https://gone.example', errorCode: 'ENOTFOUND', dnsRecheckFailed: true })
    expect(v.bucket).toBe(B.GONE)
    expect(v.confidence).toBe('high')
    expect(v.evidence).toMatch(/two separate attempts/)
  })

  it('refuses to call a single unconfirmed NXDOMAIN gone', () => {
    const v = run({ requestUrl: 'https://blip.example', errorCode: 'ENOTFOUND', dnsRecheckFailed: null })
    expect(v.bucket).toBe(B.BLOCKED)
    expect(v.evidence).toMatch(/not re-checked/)
  })

  it('demotes a DNS failure that recovered on re-check', () => {
    const v = run({ requestUrl: 'https://blip.example', errorCode: 'ENOTFOUND', dnsRecheckFailed: false })
    expect(v.bucket).toBe(B.BLOCKED)
    expect(v.evidence).toMatch(/transient/)
  })

  it('treats EAI_AGAIN as transient, never as a dead domain', () => {
    // EAI_AGAIN looks like ENOTFOUND and means the opposite: a TEMPORARY resolver failure.
    const v = run({ requestUrl: 'https://slow.example', errorCode: 'EAI_AGAIN', dnsRecheckFailed: true })
    expect(v.bucket).toBe(B.BLOCKED)
    expect(v.confidence).toBe('none')
  })

  it.each(['ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ABORT_ERR'])(
    '%s is blocked, not a signal',
    (code) => {
      expect(run({ requestUrl: 'https://x.example', errorCode: code }).bucket).toBe(B.BLOCKED)
    },
  )

  it('puts an expired certificate in broken, not gone', () => {
    const v = run({ requestUrl: 'https://oldcert.example', errorCode: 'CERT_HAS_EXPIRED' })
    expect(v.bucket).toBe(B.BROKEN)
    expect(v.evidence).toMatch(/may still be operating/)
  })

  it('calls a refused connection gone once confirmed twice', () => {
    const v = run({ requestUrl: 'https://x.example', errorCode: 'ECONNREFUSED', dnsRecheckFailed: true })
    expect(v.bucket).toBe(B.GONE)
    expect(v.signal).toBe('connection-refused')
  })
})

describe('404 is broken, not gone', () => {
  it.each([404, 410])('HTTP %i lands in broken — a moved page looks identical', (status) => {
    const v = run({ requestUrl: 'https://www.city.gov/parks/old', status })
    expect(v.bucket).toBe(B.BROKEN)
    expect(v.evidence).toMatch(/venue status unknown/)
  })
})

// =================================================================================================
// RULE 2 — closure language is position-weighted, and the false-positive set is the majority case
// =================================================================================================
describe('closure language — TRUE positives', () => {
  it.each([
    ['permanently closed', 'This location is permanently closed.'],
    ['no longer in business', 'Sadly we are no longer in business.'],
    ['out of business', 'The club has gone out of business.'],
    ['ceased operations', 'The facility ceased operations in March.'],
    ['has closed its doors', 'Big House Pickleball has closed its doors for good.'],
    ["we've closed", "After much thought, we've closed."],
    ['thank you for N years', 'Thank you for 7 wonderful years of pickleball!'],
    ['no longer open', 'The courts are no longer accepting reservations.'],
  ])('detects %s', (_label, text) => {
    expect(closure(text)).not.toBeNull()
  })

  it('reports the phrase and a readable excerpt', () => {
    const hit = closure('Big House Pickleball is permanently closed as of January 2026.')
    expect(hit?.phrase).toBe('permanently closed')
    expect(hit?.excerpt).toMatch(/Big House Pickleball is permanently closed/)
  })
})

describe('closure language — FALSE positives that must NOT fire', () => {
  // These are the strings a live municipal parks page actually carries. 884 of 1,202 published
  // rows are public park courts, so this is the majority of the corpus, not an edge case.
  it.each([
    ['resurfacing', 'The pickleball courts are closed for resurfacing through April.'],
    ['renovation', 'Tennis and pickleball courts closed for renovation.'],
    ['season', 'The pool and courts are closed for the season.'],
    ['maintenance', 'Courts closed for maintenance this week.'],
    ['temporarily', 'This facility is temporarily closed.'],
    ['temporarily + permanent word nearby', 'The center is temporarily closed and will reopen permanently staffed in May.'],
    ['weekday hours', 'The recreation center is closed Mondays and Tuesdays.'],
    ['closed today', 'Note: the park is closed today due to weather.'],
    ['clock hours', 'Open 6:00 am, closed 9:00 pm daily.'],
    ['weather', 'Courts closed due to rain.'],
    ['reopening', 'Permanently closed? No — we reopen in June after construction.'],
    ['restrooms', 'Restrooms are currently closed; courts remain open.'],
  ])('does not fire on: %s', (_label, text) => {
    expect(closure(text)).toBeNull()
  })

  it('does not fire on an empty or non-string input', () => {
    expect(closure('')).toBeNull()
    expect(closure(undefined as unknown as string)).toBeNull()
  })
})

describe('closure language — position and host weighting', () => {
  const closureTitle = page({ title: 'Big House Pickleball — Permanently Closed', body: 'Thanks to our members.' })

  it('reaches GONE in the title on the venue own domain', () => {
    const v = run({
      requestUrl: 'https://thebighousepickleball.com/',
      finalUrl: 'https://thebighousepickleball.com/',
      status: 200,
      html: closureTitle,
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.GONE)
    expect(v.signal).toBe('closure-language-prominent')
    expect(v.confidence).toBe('high')
  })

  it('DEMOTES the identical page to broken on a government host', () => {
    // A .gov saying "permanently closed" is about a facility, not a business.
    const v = run({
      requestUrl: 'https://www.phoenix.gov/parks/some-court',
      finalUrl: 'https://www.phoenix.gov/parks/some-court',
      status: 200,
      html: closureTitle,
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.BROKEN)
    expect(v.signal).toBe('closure-language-shared-host')
  })

  it('DEMOTES the identical page on a host shared by several published rows', () => {
    const v = run({
      requestUrl: 'https://thepicklr.com/locations/somewhere',
      finalUrl: 'https://thepicklr.com/locations/somewhere',
      status: 200,
      html: closureTitle,
      hostRowCount: 11,
    })
    expect(v.bucket).toBe(B.BROKEN)
    expect(v.evidence).toMatch(/serves 11 published rows/)
  })

  it('DEMOTES a body-only hit even on the venue own domain', () => {
    const v = run({
      requestUrl: 'https://someclub.com/',
      finalUrl: 'https://someclub.com/',
      status: 200,
      html: page({ title: 'Some Club', body: 'Our sister location is permanently closed but we are open daily.' }),
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.BROKEN)
    expect(v.signal).toBe('closure-language-body')
    expect(v.confidence).toBe('low')
  })

  it('leaves a live municipal courts page healthy', () => {
    const v = run({
      requestUrl: 'https://www.phoenix.gov/parks/pickleball',
      finalUrl: 'https://www.phoenix.gov/parks/pickleball',
      status: 200,
      html: page({ title: 'Pickleball Courts | City of Phoenix', body: 'Courts closed for resurfacing through April. Open daily 6am-10pm.' }),
      hostRowCount: 28,
    })
    expect(v.bucket).toBe(B.HEALTHY)
  })
})

// =================================================================================================
// Lapsed hosting — the BLVD Pickleball pattern
// =================================================================================================
describe('parked / expired hosting', () => {
  it('catches the Squarespace expired page (BLVD Pickleball pattern)', () => {
    // Custom domain AND the underlying Squarespace subdomain both read this. The whole hosting
    // account lapsed — materially stronger than a broken page: a trading business pays its bill.
    const v = run({
      requestUrl: 'https://blvdpickleball.com/',
      finalUrl: 'https://blvdpickleball.com/',
      status: 200,
      html: page({ title: 'Website Expired', body: 'This website has expired. Squarespace — if you are the site owner, log in to renew.' }),
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.GONE)
    expect(v.signal).toBe('parked-hosting')
    expect(v.confidence).toBe('high')
  })

  it.each([
    ['account suspended', 'Account Suspended — contact your hosting provider'],
    ['domain expired', 'This domain has expired. Renew now.'],
    ['for sale', 'This domain name is for sale.'],
    ['cPanel default', 'Future home of something quite cool.'],
    ['nginx default', 'Welcome to nginx! If you see this page, the web server is successfully installed.'],
    ['over quota', 'This site is temporarily unavailable. Please contact the administrator.'],
  ])('catches %s', (_l, body) => {
    expect(parked(body)).not.toBeNull()
  })

  it('does not fire on an ordinary venue page', () => {
    expect(parked('Welcome to Riverside Pickleball. Eight dedicated courts, open play daily.')).toBeNull()
  })

  it('treats a redirect into a domain marketplace as gone', () => {
    const v = run({
      requestUrl: 'https://oldclub.com/',
      finalUrl: 'https://www.hugedomains.com/domain_profile.cfm?d=oldclub.com',
      status: 200,
      html: page({ title: 'oldclub.com is for sale' }),
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.GONE)
    expect(v.signal).toBe('parked-redirect')
  })
})

// =================================================================================================
// Redirects and domain identity
// =================================================================================================
describe('registrableDomain', () => {
  it.each([
    ['https://www.phoenix.gov/parks', 'phoenix.gov'],
    ['https://phoenix.gov/', 'phoenix.gov'],
    ['http://parks.co.slco.org/x', 'slco.org'],
    ['https://club.example.co.uk/a', 'example.co.uk'],
    ['https://www.ci.lakewood.ca.us/parks', 'lakewood.ca.us'],
    ['https://sub.deep.example.com', 'example.com'],
    ['example.com', 'example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(regDomain(input)).toBe(expected)
  })

  it('handles junk without throwing', () => {
    expect(regDomain('')).toBeNull()
    expect(regDomain('not a url')).toBe('not a url')
  })

  it('does not treat www vs apex, or http vs https, as unrelated', () => {
    expect(unrelated('http://www.example.com/a', 'https://example.com/b')).toBe(false)
    expect(unrelated('https://example.com/a', 'https://cdn.example.com/a')).toBe(false)
  })

  it('flags a genuine cross-domain landing', () => {
    expect(unrelated('https://oldvenue.com/', 'https://bigchain.com/locations')).toBe(true)
  })

  it('classifies an unrelated redirect as broken, not gone', () => {
    const v = run({
      requestUrl: 'https://oldvenue.com/',
      finalUrl: 'https://bigchain.com/locations',
      status: 200,
      html: page({ title: 'Big Chain Fitness' }),
      hostRowCount: 1,
    })
    expect(v.bucket).toBe(B.BROKEN)
    expect(v.signal).toBe('unrelated-redirect')
  })
})

describe('isVenueOwnHost', () => {
  it('accepts a single-row commercial host', () => {
    expect(ownHost({ hostname: 'thebighousepickleball.com', hostRowCount: 1 })).toBe(true)
  })
  it('rejects government domains outright', () => {
    expect(ownHost({ hostname: 'www.phoenix.gov', hostRowCount: 1 })).toBe(false)
    expect(ownHost({ hostname: 'parks.ci.lakewood.ca.us', hostRowCount: 1 })).toBe(false)
  })
  it('rejects a host serving several published rows', () => {
    expect(ownHost({ hostname: 'thepicklr.com', hostRowCount: 11 })).toBe(false)
  })
})

// =================================================================================================
// HTML field extraction
// =================================================================================================
describe('extractPageFields', () => {
  it('pulls title, meta description and headings, and decodes entities', () => {
    const f = fields(`<html><head><title>Ace &amp; Dink &mdash; Closed</title>
      <meta name="description" content="Thanks for 10 years"></head>
      <body><h1>Good&nbsp;bye</h1><p>Body text</p></body></html>`)
    expect(f.title).toBe('Ace & Dink — Closed')
    expect(f.metaDescription).toBe('Thanks for 10 years')
    expect(f.headings).toBe('Good bye')
    expect(f.body).toMatch(/Body text/)
  })

  it('strips script and style so their contents cannot trigger a match', () => {
    const f = fields(`<html><body><script>var s="permanently closed";</script>
      <style>.x{content:"out of business"}</style><p>Open daily</p></body></html>`)
    expect(f.body).not.toMatch(/permanently closed/)
    expect(f.body).not.toMatch(/out of business/)
    expect(closure(f.body)).toBeNull()
  })

  it('survives empty and malformed input', () => {
    expect(fields('').title).toBe('')
    expect(fields(undefined as unknown as string).body).toBe('')
    expect(fields('<html><body>no head').title).toBe('')
  })
})

describe('healthy is "not proven broken"', () => {
  it('returns healthy for an ordinary 200 with no signal', () => {
    const v = run({ requestUrl: 'https://club.com/', finalUrl: 'https://club.com/', status: 200, html: page({}), hostRowCount: 1 })
    expect(v.bucket).toBe(B.HEALTHY)
    expect(v.evidence).toMatch(/not proven broken/)
  })

  it('a soft-404 (200 + empty title) is knowingly healthy — documented limitation', () => {
    // leegov.com returns 200 with an empty <title> for pages that do not exist. Detecting that is
    // a different problem; a false negative here is the safe direction.
    const v = run({ requestUrl: 'https://www.leegov.com/parks/phantom', status: 200, html: '<html><head><title></title></head><body></body></html>', hostRowCount: 3 })
    expect(v.bucket).toBe(B.HEALTHY)
  })
})

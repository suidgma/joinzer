/**
 * The NAIP contact sheet — flag rules and HTML rendering.
 *
 * Kept separate from the fetching (scripts/lib/naip-imagery.mjs) and from the CLI
 * (scripts/naip-geocode-qa.mjs) so the two judgement calls in here — what counts as STALE, and what
 * counts as UNINFORMATIVE — are pure functions with unit tests, rather than branches buried in a
 * loop that only runs with a network and a database behind it.
 *
 * Everything here is side-effect free and dependency free. `renderContactSheet` returns a string.
 */

// ---------------------------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------------------------
/**
 * WHY THIS FLAG EXISTS: a 2019 crop of a venue built in 2026 is not evidence of anything. Without
 * this flag the tool's most confident-looking output — a clean aerial with no courts in it — is
 * generated precisely by our NEWEST and BEST venues, and a reviewer would "fix" correct coordinates.
 *
 * WHERE AN OPENING DATE COMES FROM. There is no opening-date column on facility_listings and this
 * slice does not add one. Two sources, in precedence order:
 *
 *   1. scripts/naip-qa-known-openings.json — a curated slug -> { opened, source } map. Authoritative.
 *   2. an automatic scan of the row's own `provenance` prose (see openingHintFromProvenance).
 *
 * The prose scan is what makes this flag work with no maintenance: Manlius Village Centre Field's
 * provenance already records "ribbon-cut July 2026" in a same-site adjudication note, written for an
 * entirely different purpose. Research prose is where opening dates already live in this system, so
 * that is where the scan looks.
 */

/** Months as they appear in research prose, long and abbreviated. */
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

/**
 * Words that mean "this venue came into existence", as opposed to merely being mentioned.
 *
 * `resurfaced` / `renovated` are deliberately ABSENT. A resurface changes how courts look, not
 * whether they are visible from 0.6 m, so flagging on one would send a reviewer to a crop that
 * answers the question perfectly well.
 */
const OPENING_WORDS = /\b(ribbon[- ]?cut(?:ting)?|grand opening|opened|opening|newly (?:built|opened|constructed)|new (?:pickleball )?courts|built|constructed|completed|unveiled|debuted|broke ground|groundbreaking)\b/i

/**
 * A bare 4-digit year, NOT part of a longer machine date.
 *
 * The lookarounds are the whole point. `provenance` is dense with ISO timestamps — `imported_at`,
 * `adjudicated_on`, `artifact_updated` — and `2026-08-06` would otherwise match as "the year 2026"
 * in any string that also happens to contain an opening word. Requiring the year to be free of an
 * adjacent digit, hyphen or slash keeps prose ("ribbon-cut July 2026") and rejects machine dates.
 */
const BARE_YEAR = /(?<![\d\-/])(19|20)\d{2}(?![\d\-/])/g

/** How close an opening word must sit to a year to be talking about it. Wide enough for
 *  "the Village built six outdoor public courts ... ribbon-cut July 2026", tight enough that two
 *  unrelated sentences in one long note do not cross-contaminate. */
const PROXIMITY_CHARS = 90

/**
 * Every string value inside an arbitrarily nested JSON value.
 * Keys are ignored — a key is a schema name, never prose.
 */
export function stringValues(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringValues(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringValues(v, out)
  return out
}

/**
 * The latest opening date this row's provenance prose asserts, or null.
 *
 * Returns `{ opened, snippet }` where `opened` is `YYYY` or `YYYY-MM`. LATEST rather than first,
 * because a note that mentions both a 2019 park and its 2026 courts is talking about a venue that
 * only exists as a pickleball venue from 2026 — the later date is the one the imagery has to clear.
 *
 * This is a HINT, not a fact, and the sheet labels it as one. It can miss (prose without a year) and
 * it can over-read (a sentence about a neighbouring venue). Both failure modes are acceptable
 * because the only consequence is which crops a human looks at first; the curated map in
 * scripts/naip-qa-known-openings.json overrides it wherever someone has checked.
 */
export function openingHintFromProvenance(provenance) {
  if (!provenance) return null
  let best = null
  for (const text of stringValues(provenance)) {
    if (!OPENING_WORDS.test(text)) continue
    for (const m of text.matchAll(BARE_YEAR)) {
      const year = Number(m[0])
      const from = Math.max(0, m.index - PROXIMITY_CHARS)
      const window = text.slice(from, m.index + m[0].length + PROXIMITY_CHARS)
      if (!OPENING_WORDS.test(window)) continue
      // A month immediately before the year makes the date tighter; "July 2026" beats "2026".
      const monthMatch = text.slice(Math.max(0, m.index - 12), m.index).match(/([A-Za-z]{3,9})[\s,]*$/)
      const month = monthMatch ? MONTHS[monthMatch[1].toLowerCase()] : null
      const opened = month ? `${year}-${String(month).padStart(2, '0')}` : String(year)
      if (!best || opened > best.opened) {
        best = { opened, snippet: text.slice(from, m.index + m[0].length + PROXIMITY_CHARS).trim() }
      }
    }
  }
  return best
}

/**
 * The last calendar day an opening expressed as `YYYY` or `YYYY-MM` could have happened on.
 *
 * THE COMPARISON USES THE END OF THE PERIOD, DELIBERATELY. If a venue opened some time in 2019 and
 * the flight was 2019-08-02, the crop may or may not show it — that is exactly the uncertainty this
 * flag exists to route to a human, so it flags. Using the start of the period instead would call
 * that case clean and hand the reviewer a crop whose emptiness proves nothing.
 */
export function endOfPeriod(opened) {
  const s = String(opened || '').trim()
  if (/^\d{4}$/.test(s)) return `${s}-12-31`
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number)
    return `${s}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

/**
 * Does the imagery predate the venue?
 *
 * `imageryDate` is the NEWEST source acquisition date at the point (see summarizeIdentify) — so a
 * `true` here means even the most recent flight over this coordinate happened before the venue could
 * have existed, regardless of which tile the mosaic drew from.
 */
export function stalenessVerdict({ imageryDate, opened, openedSource }) {
  if (!imageryDate || !opened) return { stale: false }
  const cutoff = endOfPeriod(opened)
  if (!cutoff) return { stale: false }
  if (imageryDate >= cutoff) return { stale: false }
  return {
    stale: true,
    opened,
    openedSource,
    reason: `imagery ${imageryDate} predates the venue's opening (${opened}${openedSource === 'provenance' ? ', read from research prose' : ''})`,
  }
}

// ---------------------------------------------------------------------------------------------
// Likely-uninformative
// ---------------------------------------------------------------------------------------------
/**
 * Crops unlikely to tell a reviewer anything, so attention goes where it pays.
 *
 * Three rules, each with a stated reason that renders on the cell:
 *
 *   no-imagery — `identify` returned no source catalog item. Outside NAIP coverage, or a gap. There
 *                is nothing to look at, and an empty grey square must not read as "no courts here".
 *   stale      — the flight predates the venue. Covered above; repeated here because "should I spend
 *                attention on this cell" is the question this list answers.
 *   indoor     — an indoor facility is a roof from above. The crop can confirm a BUILDING exists at
 *                the pin, which is weak evidence, and can never confirm courts.
 *
 * DELIBERATELY NOT ON THIS LIST: a `low` location_precision. That is the class where a gross error is
 * MOST likely, so routing attention away from it would defeat the tool. The sheet shows the precision
 * as a neutral badge instead, so a reviewer knows the pin is a street or centroid anchor by our own
 * record and reads "no courts at the crosshair" accordingly.
 */
export function uninformativeReasons({ imageryDate, indoor, stale }) {
  const reasons = []
  if (!imageryDate) reasons.push({ code: 'no-imagery', text: 'no NAIP source tile covers this point — nothing to review' })
  if (stale) reasons.push({ code: 'stale', text: 'imagery predates the venue — an empty crop proves nothing' })
  if (indoor === true) reasons.push({ code: 'indoor', text: 'indoor venue — a roof from above cannot confirm courts' })
  return reasons
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
/** HTML text escaping. Text nodes and quoted attribute values only — this is NOT a URL sanitizer.
 *  The only URLs this file builds come from numeric coordinates and from slugs, both of which are
 *  passed through encodeURIComponent at the point of use. */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const BLIND_SPOTS = [
  ['This CANNOT confirm court type.', 'Pickleball, tennis and generic hard court are not distinguishable at 0.6 m. A rectangle of the right shape is a court, not necessarily <em>this</em> court.'],
  ['This CANNOT see anything built after the flight date.', 'Every cell shows its own acquisition date. Dates vary by tile, not by metro — read the one on the cell.'],
  ['&ldquo;No courts visible&rdquo; is NOT &ldquo;bad coordinate&rdquo;.', 'Check the acquisition date beside the crop first. Without that check this tool generates false alarms on our newest and best venues — which is exactly backwards.'],
]

/**
 * The static contact sheet.
 *
 * Deliberately one self-contained file with no external assets beyond the sibling crop images: it is
 * opened with a double-click off a research directory, not served.
 */
export function renderContactSheet({ metro, venues, generatedAt, params, siteUrl = 'https://www.joinzer.com' }) {
  const flagged = venues.filter((v) => v.stale || v.uninformative.length)
  const stale = venues.filter((v) => v.stale)
  const dates = [...new Set(venues.map((v) => v.imageryDate).filter(Boolean))].sort()

  const cells = venues.map((v) => {
    const badges = []
    if (v.stale) badges.push(`<span class="badge stale">STALE — ${esc(v.stale.reason)}</span>`)
    for (const r of v.uninformative) {
      if (r.code === 'stale') continue // already stated above, in more detail
      badges.push(`<span class="badge dim">${esc(r.text)}</span>`)
    }
    if (v.precision && v.precision !== 'high') badges.push(`<span class="badge note">coordinate precision: ${esc(v.precision)}</span>`)
    if (v.imageryDates && v.imageryDates.length > 1) badges.push(`<span class="badge note">two flights cover this point: ${esc(v.imageryDates.join(', '))}</span>`)

    const classes = ['cell']
    if (v.stale) classes.push('is-stale')
    if (v.uninformative.length) classes.push('is-dim')
    if (!v.stale && !v.uninformative.length) classes.push('is-clean')

    const maps = `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`
    const page = `${siteUrl}/courts/${encodeURIComponent(v.slug)}`
    const img = v.cropFile
      ? `<img loading="lazy" src="${esc(v.cropFile)}" alt="NAIP aerial crop centred on ${esc(v.name)}"><span class="crosshair" aria-hidden="true"></span>`
      : `<span class="nocrop">no crop&nbsp;&mdash;&nbsp;${esc(v.cropError || 'not fetched')}</span>`

    return `
    <figure class="${classes.join(' ')}">
      <div class="frame">${img}</div>
      <figcaption>
        <h2>${esc(v.name)}</h2>
        <p class="slug"><a href="${esc(page)}" target="_blank" rel="noopener">${esc(v.slug)}</a></p>
        <dl>
          <dt>coordinate</dt><dd><a href="${esc(maps)}" target="_blank" rel="noopener">${esc(v.lat)}, ${esc(v.lng)}</a></dd>
          <dt>acquired</dt><dd>${v.imageryDate ? esc(v.imageryDate) : '<span class="unknown">unknown &mdash; no source tile</span>'}</dd>
          <dt>GSD</dt><dd>${v.gsd != null ? `${esc(v.gsd)} ${esc((v.gsdUnits || 'm').toLowerCase())}` : '<span class="unknown">unknown</span>'}</dd>
        </dl>
        ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
      </figcaption>
    </figure>`
  }).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>NAIP geocode QA — ${esc(metro)}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#16191d; --muted:#5b6470; --line:#dfe3e8;
          --stale:#b4530a; --stale-bg:#fff4e6; --dim:#5b6470; --dim-bg:#f1f3f5; --note-bg:#eef2f7; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14171a; --fg:#e8eaed; --muted:#9aa4b1; --line:#2a2f36;
            --stale:#ffb066; --stale-bg:#3a2408; --dim:#9aa4b1; --dim-bg:#22262b; --note-bg:#1e242b; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg);
         font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { max-width: 1100px; margin: 0 auto 28px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; font-size: 13px; }
  .warn { border:2px solid var(--stale); background:var(--stale-bg); border-radius:10px; padding:16px 18px; margin:0 0 20px; }
  .warn h2 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; margin:0 0 10px; color:var(--stale); }
  .warn ul { margin:0; padding-left:18px; }
  .warn li { margin:0 0 8px; }
  .warn li:last-child { margin-bottom:0; }
  .warn b { font-weight:650; }
  .stats { display:flex; flex-wrap:wrap; gap:8px 24px; padding:0; margin:0 0 16px; list-style:none; font-size:13px; color:var(--muted); }
  .stats b { color:var(--fg); font-variant-numeric: tabular-nums; }
  .filters { display:flex; flex-wrap:wrap; gap:14px; font-size:13px; padding:12px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  .filters label { cursor:pointer; user-select:none; }
  main { max-width: 1100px; margin: 0 auto; display:grid; gap:20px;
         grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  figure { margin:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--bg); }
  figure.is-stale { border-color: var(--stale); }
  .frame { position:relative; aspect-ratio:1; background:var(--dim-bg); display:grid; place-items:center; }
  .frame img { width:100%; height:100%; object-fit:cover; display:block; }
  figure.is-dim .frame img { opacity:.55; }
  .nocrop { color:var(--muted); font-size:12px; padding:12px; text-align:center; }
  /* The crosshair marks the exact published coordinate. Without it a reviewer cannot tell a
     right-club-wrong-campus error from a correct pin on a large site. */
  .crosshair { position:absolute; inset:0; pointer-events:none;
    background:
      linear-gradient(to right, transparent calc(50% - 11px), #ff2d55 calc(50% - 11px), #ff2d55 calc(50% - 4px), transparent calc(50% - 4px), transparent calc(50% + 4px), #ff2d55 calc(50% + 4px), #ff2d55 calc(50% + 11px), transparent calc(50% + 11px)) center / 100% 2px no-repeat,
      linear-gradient(to bottom, transparent calc(50% - 11px), #ff2d55 calc(50% - 11px), #ff2d55 calc(50% - 4px), transparent calc(50% - 4px), transparent calc(50% + 4px), #ff2d55 calc(50% + 4px), #ff2d55 calc(50% + 11px), transparent calc(50% + 11px)) center / 2px 100% no-repeat;
  }
  figcaption { padding:12px 14px 14px; }
  figcaption h2 { font-size:15px; margin:0 0 2px; }
  .slug { margin:0 0 10px; font-size:12px; }
  .slug a, dd a { color:inherit; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; margin:0; font-size:12px; }
  dt { color:var(--muted); }
  dd { margin:0; font-variant-numeric: tabular-nums; }
  .unknown { color:var(--muted); font-style:italic; }
  .badges { display:flex; flex-direction:column; gap:5px; margin-top:10px; }
  .badge { font-size:11.5px; line-height:1.35; padding:5px 8px; border-radius:6px; background:var(--note-bg); }
  .badge.stale { background:var(--stale-bg); color:var(--stale); font-weight:600; }
  .badge.dim { background:var(--dim-bg); color:var(--dim); }
  body.hide-clean .is-clean, body.hide-dim .is-dim, body.hide-stale .is-stale { display:none; }
  footer { max-width:1100px; margin:32px auto 0; padding-top:16px; border-top:1px solid var(--line);
           font-size:12px; color:var(--muted); }
</style>
</head>
<body>
<header>
  <h1>NAIP geocode QA &mdash; ${esc(metro)}</h1>
  <p class="sub">${venues.length} published venue${venues.length === 1 ? '' : 's'} &middot; generated ${esc(generatedAt)}</p>

  <div class="warn">
    <h2>What this cannot tell you</h2>
    <ul>
      ${BLIND_SPOTS.map(([h, b]) => `<li><b>${h}</b> ${b}</li>`).join('\n      ')}
    </ul>
  </div>

  <ul class="stats">
    <li>flagged: <b>${flagged.length}</b></li>
    <li>stale imagery: <b>${stale.length}</b></li>
    <li>likely uninformative: <b>${venues.filter((v) => v.uninformative.length).length}</b></li>
    <li>clean: <b>${venues.filter((v) => !v.stale && !v.uninformative.length).length}</b></li>
    <li>acquisition dates: <b>${dates.length ? esc(dates.join(', ')) : 'none'}</b></li>
  </ul>

  <div class="filters">
    <label><input type="checkbox" data-hide="hide-clean"> hide clean</label>
    <label><input type="checkbox" data-hide="hide-dim"> hide likely-uninformative</label>
    <label><input type="checkbox" data-hide="hide-stale"> hide stale</label>
  </div>
</header>

<main>
${cells}
</main>

<footer>
  <p>Imagery: USGS NAIP via The National Map (<code>imagery.nationalmap.gov</code>). Public domain &mdash;
     attribution requested, not required. Crops are ${esc(params.groundMeters)} m across at
     ${esc(params.size)} px (&asymp;${esc((params.groundMeters / params.size).toFixed(2))} m/px requested;
     the source GSD shown per cell is what the imagery actually is).</p>
  <p>Read-only audit artifact. This tool never writes to the database.</p>
</footer>

<script>
  for (const box of document.querySelectorAll('.filters input')) {
    box.addEventListener('change', () => document.body.classList.toggle(box.dataset.hide, box.checked));
  }
</script>
</body>
</html>
`
}

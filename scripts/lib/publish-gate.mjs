/**
 * THE PUBLISH GATE — one definition, shared by both scripts that enforce it.
 *
 * WHY THIS FILE EXISTS. There are two gates in this repo and they are never edited together:
 *   - scripts/import-metro-merged.mjs  --stage=publish  decides what a BATCH promotes to published
 *   - scripts/publish-facilities.mjs                    is a RECONCILING pass that both publishes
 *                                                       AND UN-publishes, per metro
 * Before this file, each carried its own private copy of the rules. Changing one without the other
 * means the reconciling pass silently reverts every row the batch just promoted — which is exactly
 * what would have happened to the 91 rows ADR-16 released. A shared module makes that class of drift
 * impossible rather than something a reviewer has to notice.
 *
 * `import-metro-merged.mjs` reads argv and calls process.exit at module scope, so nothing defined
 * inside it is importable and therefore nothing inside it is unit-testable. Extracting the gate here
 * is what lets it be tested at all — the same pattern reconcile-merge.mjs already established.
 *
 * ---------------------------------------------------------------------------------------------
 * THE GATE AND THE FENCE ARE TWO DIFFERENT QUESTIONS (ADR-17, owner 2026-08-05)
 *
 * The single most important structural point in this file, and the reason loosening the gate is
 * safe. Two questions used to be jammed into one filter expression, which is what made a
 * coverage-first gate look like it would mass-publish the backlog:
 *
 *   THE GATE  — "is this row good enough to be public?"        name + coordinate + city + slug.
 *                Lives here. Identical in both scripts. Deliberately permissive (ADR-17).
 *
 *   THE FENCE — "has anyone deliberately released this metro?"  verified_by IS NOT NULL.
 *                Stamped ONLY by an explicit `--stage=publish` run. Enforced by
 *                publish-facilities.mjs on the PUBLISH direction only — see `passesReleaseFence`.
 *
 * Keeping them separate means LOOSENING THE GATE CANNOT PUBLISH ANYTHING BY ITSELF. A held draft
 * carries verified_by = NULL, so no reconcile can promote it however permissive the gate becomes.
 * Deliberate, per-metro release stays the only path to production.
 *
 * The numbers that make this concrete, measured against production 2026-08-05: 868 draft rows exist
 * across 41 metros and 446 of them pass the gate below. Without the fence, one unrelated
 * `publish-facilities.mjs --metro=…` run would have published 232 of them (the remainder carry a
 * NULL metro_area and are unreachable by a metro-scoped script).
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT LEFT THE GATE, AND WHY (ADR-17)
 *
 *   access_type != 'unknown'        REMOVED. Many public park courts will never have a source that
 *                                   states access. The row publishes and the page says
 *                                   "Access unknown — call ahead".
 *   research_status === 'verified'  REMOVED as a positive requirement, replaced by the much narrower
 *                                   BLOCKING_RESEARCH_STATUS below. `probable` means "believed real,
 *                                   not confirmed by a controlling entity" (ADR-14) — that is an
 *                                   unproven venue, not a rejected one, and coverage-first publishes
 *                                   unproven venues.
 *   precision !== 'low'             REMOVED by ADR-16, which shipped first. Those rows publish behind
 *                                   a user-visible approximate-location label.
 *
 * WHAT JOINED IT
 *
 *   city                            publish-facilities.mjs already required it; the batch importer
 *                                   did not. A listing with no city breaks the city index and reads
 *                                   as incomplete. Shared now.
 *   a real name                     publish-facilities.mjs already required it via isGenericName; the
 *                                   batch importer only asserted presence. Shared now, which is what
 *                                   makes "name" in the ADR-17 gate mean something rather than
 *                                   restating a NOT NULL column.
 */

/** The precision value that means "this pin is a street band, not the building." */
export const APPROXIMATE_PRECISION = 'low'

/**
 * Does this coordinate need the approximate-location label?
 *
 * Shared so the importer, the reconciling pass, the loader's type and the render layer are all
 * answering the question with one function rather than four string comparisons that can drift.
 */
export function isApproximateLocation(precision) {
  return precision === APPROXIMATE_PRECISION
}

/**
 * Research verdicts that keep a row out of the directory — CORRECTNESS verdicts only.
 *
 * This set was deliberately narrowed by ADR-17. It used to include `pending`, `probable`,
 * `unresolved` and `unresolved_unnamed` — effectively every status that was not `verified`. Those
 * are statements about how *proven* a venue is, and coverage-first publishes unproven venues.
 *
 * What remains are statements about whether the row should exist at all:
 *   duplicate / not_venue / not_pickleball — the row is wrong, and publishing it is not "imperfect
 *                                            coverage", it is a defect. A duplicate in particular
 *                                            damages the directory more than a missing venue does.
 *   held                                   — an explicit human "not this one" (owner ruling
 *                                            2026-08-05). Unlike `probable` this is a decision that
 *                                            was already made, not an absence of evidence.
 *
 * NARROWING THIS SET IS WHAT KEEPS THE TWO SCRIPTS CONSISTENT. The batch importer now publishes
 * `probable` rows; if the reconciling pass still treated `probable` as blocking it would draft, on
 * its next run, exactly the rows the importer had just published — the divergence this shared module
 * exists to prevent.
 */
export const BLOCKING_RESEARCH_STATUS = new Set(['duplicate', 'not_venue', 'not_pickleball', 'held'])

/**
 * A name is "generic" if nothing distinctive remains after stripping pickleball/court/tennis terms,
 * numbers and stopwords — e.g. "Pickleball", "Pickle Ball", "Pickleball Courts", "8 Pickleball
 * Courts". Real venues keep a proper noun ("Chicken N Pickle", "PebbleCreek…", "The Picklr…").
 *
 * Moved here from publish-facilities.mjs by ADR-17 so both scripts apply one definition. This is the
 * "name" term of the gate: `facility_listings.name` is NOT NULL, so a presence check alone would be
 * a no-op, and the question a directory actually needs answered is whether the name identifies
 * anything.
 */
export function isGenericName(name) {
  const t = (name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pickleball|pickle|ball|courts?|tennis|the|a|an|of|at|and)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return t.length < 3
}

/**
 * THE FENCE. Has this row been deliberately released by an explicit publish run?
 *
 * `verified_by` is stamped by `import-metro-merged.mjs --stage=publish` and by nothing else. It is
 * NOT a quality signal and must never be read as one — a held draft and a published row can be
 * identical in every quality respect and differ only in whether an owner said go.
 *
 * Applied by publish-facilities.mjs to the PUBLISH direction ONLY. Deliberately not applied to the
 * un-publish direction: a fence that also drafted would un-publish the 19 live Stockton-Lodi rows
 * that predate the stamping convention. "The fence only ever withholds, never drafts" is the
 * invariant, and restricting it to one direction is what makes that literally true.
 *
 * Note this is `verified_by` ALONE. `enrichment_version` used to satisfy the same expression, which
 * would let a Gemini-enriched raw OSM row ("Pickleball Backyard") publish itself on a metro reconcile
 * without anyone releasing it. Enrichment is something we did TO a row, not a decision about it.
 */
export function passesReleaseFence(row) {
  return row.verified_by != null
}

/** The gate, in words, printed by both scripts' run logs. Kept beside the code that implements it so
 *  a log can never describe a rule the code stopped applying. */
export const GATE_TEXT =
  'name (present + not generic) + coordinate present + city + slug' +
  "  [ADR-17 coverage-first: access_type 'unknown' PUBLISHES; research_status 'probable' PUBLISHES;" +
  " precision 'low' publishes with an approximate-location label per ADR-16;" +
  ` blocked only by ${[...BLOCKING_RESEARCH_STATUS].join('/')}; court_count is NOT a gate condition]`

/**
 * Every reason this row may not publish. Empty array = it publishes.
 *
 * NOTE WHAT IS ABSENT: there is no `precision === 'low'` clause (ADR-16), no `access_type` clause and
 * no positive `research_status === 'verified'` requirement (ADR-17). `lat == null` remains, and those
 * are different rows from low-precision ones — "we do not know where this is" cannot be fixed by
 * labelling a pin that does not exist.
 *
 * @param hasCandidate  Integrity guard, not a quality condition. The batch importer passes the real
 *   answer, because a batch row with no candidate row means the run itself is malformed. The
 *   reconciling pass always leaves it `true`, deliberately: absence of a staging row is not evidence
 *   against a listing there (raw OSM drafts and parity imports legitimately have none), and blocking
 *   on it would un-publish live rows.
 * @param research_status  `null` when the row has no candidate. Never blocking on its own.
 */
export function gateReasons({ name, lat, lng, city, slug, research_status, hasCandidate = true }) {
  const reasons = []
  if (!hasCandidate) reasons.push('no linked candidate')
  if (!name || !String(name).trim()) reasons.push('no name')
  else if (isGenericName(name)) reasons.push('generic name')
  if (lat == null || lng == null) reasons.push('no coordinate')
  if (!city) reasons.push('no city')
  if (!slug) reasons.push('no slug')
  if (research_status != null && BLOCKING_RESEARCH_STATUS.has(research_status)) {
    reasons.push(`research_status=${research_status}`)
  }
  return reasons
}

/**
 * The confidence tier a row carries (ADR-18). Tiers DESCRIBE a row; they do not gate it.
 *
 *   human_verified  — a person confirmed it (set by hand, never by this pipeline)
 *   source_verified — a controlling entity confirms it: research_status='verified'
 *   listed          — named with an address by a credible local source, and it geocoded
 *
 * `listed` is the tier ADR-17 creates demand for. Coverage-first publishes rows no controlling
 * entity has confirmed, and calling those `source_verified` would be a lie told by a column. The
 * mapping is mechanical off the candidate's research_status so it cannot be applied inconsistently.
 */
export function verificationStatusFor(researchStatus) {
  return researchStatus === 'verified' ? 'source_verified' : 'listed'
}

/** Every tier this pipeline is allowed to write, for assertions. `human_verified` is excluded
 *  deliberately — it is a human's word, and no script may claim it on a human's behalf. */
export const PIPELINE_VERIFICATION_STATUS = new Set(['source_verified', 'listed'])

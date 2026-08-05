/**
 * THE PUBLISH GATE — one definition, shared by both scripts that enforce it.
 *
 * WHY THIS FILE EXISTS. There are two gates in this repo and they are never edited together:
 *   - scripts/import-metro-merged.mjs  --stage=publish  decides what a BATCH promotes to published
 *   - scripts/publish-facilities.mjs                    is a RECONCILING pass that both publishes
 *                                                       AND UN-publishes, per metro
 * Before this file, each carried its own private copy of the coordinate-precision rule. Changing one
 * without the other means the reconciling pass silently reverts every row the batch just promoted —
 * which is exactly what would have happened to the 91 rows ADR-16 releases. A shared module makes
 * that class of drift a compile-time impossibility rather than something a reviewer has to notice.
 *
 * `import-metro-merged.mjs` reads argv and calls process.exit at module scope, so nothing defined
 * inside it is importable and therefore nothing inside it is unit-testable. Extracting the gate here
 * is what lets it be tested at all — the same pattern reconcile-merge.mjs already established.
 *
 * ADR-16 (owner, 2026-08-04) — a `low`-precision coordinate NO LONGER HOLDS A ROW. It publishes with
 * a user-visible approximate-location label. The rule it replaces (owner, 2026-07-28) held those rows
 * back entirely. **A MISSING coordinate is still a hold** — the two were never the same fact, and the
 * label can only be honest about a pin that exists.
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

/** The gate, in words, printed by both scripts' run logs. Kept beside the code that implements it so
 *  a log can never describe a rule the code stopped applying. */
export const GATE_TEXT = `coordinate present + slug + access_type != unknown + candidate research_status='verified'  (precision 'low' PUBLISHES with an approximate-location label per ADR-16; court_count is NOT a gate condition)`

/**
 * Every reason this row may not publish. Empty array = it publishes.
 *
 * NOTE WHAT IS ABSENT: there is no `precision === 'low'` clause any more. That is the whole of
 * ADR-16 on the importer side. `lat == null` remains, and those are different rows — 115 of the 348
 * held drafts have no coordinate at all and stay held, because "we do not know where this is" cannot
 * be fixed by labelling a pin that does not exist.
 */
export function gateReasons({ lat, lng, precision, slug, access_type, research_status, hasCandidate = true }) {
  const reasons = []
  if (!hasCandidate) reasons.push('no linked candidate')
  if (lat == null || lng == null) reasons.push('no coordinate')
  if (!slug) reasons.push('no slug')
  if (!access_type || access_type === 'unknown') reasons.push('access_type unknown')
  if (research_status !== 'verified') reasons.push(`research_status=${research_status}`)
  // `precision` is still accepted and still meaningful — it decides whether the published row wears
  // the label — it simply no longer blocks. Referenced here so the parameter is not mistaken for dead
  // weight and quietly dropped by the next reader.
  void precision
  return reasons
}

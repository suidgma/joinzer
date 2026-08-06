/**
 * `distinct_from_live` — adjudicating a distinct venue that sits near a PUBLISHED, non-OSM neighbour.
 *
 * THE GAP. import-metro-merged.mjs checks every incoming venue against every pre-existing listing in
 * the envelope and fails preflight inside `reconcile_radius_m` (200 m by default):
 *
 *     X is 148 m from live listing "Y" (slug, published) — that is a RECONCILE decision for the
 *     owner, not an INSERT
 *
 * Both existing escape hatches key on the NEIGHBOUR'S `osm_id`: a `reconciles` entry matched by
 * `r.osm_id === rec.osm_id`, and an `also_at_site` entry looked up in ALSO_AT_SITE_BY_OSM — which
 * additionally asserts the neighbour is still `status='draft'`. So when the neighbour is a PUBLISHED
 * row that came from our own research, its `osm_id` is NULL and neither hatch can even name it.
 *
 * Tampa's Bryan Glazer Family JCC is the live cost: 522 N Howard Ave 33606, two indoor membership
 * courts on the JCC multi-sports floor, sitting 148 m from published `vila-brothers-park-tampa-fl`
 * (700 N Armenia Ave 33609, two outdoor public city courts). Different streets, zips, operators and
 * court types — Howard and Armenia are parallel West Tampa streets a block and a half apart — and
 * the venue was deferred out of its batch because no config could say so.
 *
 * WHAT THIS IS NOT. It is not a radius change. `reconcile_radius_m` is METRO-WIDE, so lowering it to
 * admit one row would blind the guard to every other neighbour in the metro — precisely the failure
 * the guard exists to prevent. It is not a bypass flag either: it names ONE neighbour, by id, and
 * every claim it makes is re-asserted against live data on every run.
 *
 * FIVE VALIDATIONS keep it an adjudication rather than a silencer — the bar `same_site_pairs` and
 * `also_at_site` already set, plus one:
 *   1. a `candidate_key` absent from the artifact ABORTS (stale config) — mirrors `exclude`
 *   2. `verdict` MUST be 'two_venues'. A one-venue finding is a reconcile/exclude decision, and
 *      allow-listing it would publish a duplicate — the opposite of the fix
 *   3. `listing_id`, `slug`, `evidence_url`, `adjudicated_on` and `distinguishers` are MANDATORY
 *   4. the neighbour is re-read LIVE and its slug must still match — a re-slugged row may no longer
 *      be the thing that was adjudicated. Deliberately NO `status='draft'` assertion, unlike
 *      also_at_site: the published case is the entire point
 *   5. an entry that stops tripping the guard is REPORTED as no longer load-bearing, never carried
 *      silently
 *
 * AND THE ONE THAT IS NEW: `distinguishers` is a CLOSED VOCABULARY, and the two members that can be
 * compared exactly are VERIFIED against data preflight already holds. A claim that the zips differ
 * when they do not is fatal. Prose in a machine-comparable position is how this codebase has been
 * bitten before — `expected_publish.hold` takes machine reasons because rationale prose there
 * produced seven false failures on a correct Jacksonville split.
 */

/**
 * The ways two venues can be distinct, as machine-comparable claims.
 *
 * `verified: true` means preflight can settle the claim from columns it already reads, so a false
 * claim ABORTS. The rest are DECLARED — recorded, reported, and resting on the adjudicator's word,
 * which is what an evidence_url is for.
 *
 * `different_street` is deliberately NOT verified. Comparing address strings can only be permissive
 * in the direction of accepting a claim ("700 N Armenia Ave" vs "700 North Armenia Avenue" normalize
 * differently while naming one street), and a check that can rubber-stamp a false claim is worse
 * than an honest declaration, because it reads as proof.
 */
export const DISTINGUISHERS = {
  different_street: { verified: false, label: 'different street' },
  different_zip: { verified: true, label: 'different ZIP code' },
  different_operator: { verified: false, label: 'different operator' },
  different_access_type: { verified: true, label: 'different access type' },
  different_court_type: { verified: false, label: 'different court type (indoor/outdoor, dedicated/shared)' },
  different_building: { verified: false, label: 'different building on one site' },
}

/** Columns the envelope proximity query must select for the verified distinguishers to be checkable.
 *  Exported so a widening here cannot be silently left out of the query — the same reasoning as
 *  RECONCILE_TARGET_COLUMNS being derived from PRESERVE_ON_RECONCILE. */
export const DISTINCT_NEIGHBOUR_COLUMNS = ['zip', 'address', 'access_type']

/**
 * Parse and validate `config.distinct_from_live`. Pure — throws on the first malformed entry rather
 * than accumulating, because a malformed adjudication is a config bug and there is nothing to weigh.
 *
 * @param entries   config.distinct_from_live
 * @param context   { configPath, artifactKeys: Set<string>, reconciles: [] }
 * @returns Map<listing_id, entry>  — keyed by the neighbour's listing id, which is what the live
 *          envelope query returns and what `also_at_site` keys by osm_id for the same reason
 */
export function parseDistinctFromLive(entries, { configPath = 'config', artifactKeys, reconciles = [] } = {}) {
  const byListing = new Map()
  for (const d of entries || []) {
    const where = `distinct_from_live entry ${JSON.stringify(d.candidate_key ?? '(no candidate_key)')}`
    for (const k of ['candidate_key', 'listing_id', 'slug', 'verdict', 'evidence_url', 'adjudicated_on']) {
      if (!d[k]) throw new Error(`${configPath}: ${where} is missing "${k}" — this entry waves a venue past the live-proximity guard, so it must carry the neighbour it is distinct FROM, its verdict, its evidence and its date.`)
    }
    if (d.verdict !== 'two_venues') {
      throw new Error(`${configPath}: ${where} has verdict "${d.verdict}". Only 'two_venues' may be allow-listed — a one-venue finding is a reconcile or exclude decision for the owner, and waving it past the guard would publish a duplicate.`)
    }
    if (artifactKeys && !artifactKeys.has(d.candidate_key)) {
      throw new Error(`${configPath}: ${where} names a candidate_key the artifact does not contain — stale config, aborting.`)
    }
    const dist = d.distinguishers
    if (!Array.isArray(dist) || dist.length === 0) {
      throw new Error(`${configPath}: ${where} must carry a non-empty "distinguishers" array — stating WHAT makes the two venues distinct is the difference between an adjudication and a silenced assertion.`)
    }
    for (const k of dist) {
      if (!(k in DISTINGUISHERS)) {
        throw new Error(`${configPath}: ${where} lists distinguisher "${k}", which is not in the closed vocabulary (${Object.keys(DISTINGUISHERS).join(', ')}). Prose here cannot be checked against anything.`)
      }
    }
    if (new Set(dist).size !== dist.length) {
      throw new Error(`${configPath}: ${where} repeats a distinguisher — each may be claimed once.`)
    }
    // A row cannot be both reconciled ONTO and declared distinct FROM. That is two contradictory
    // verdicts about the same physical identity, and whichever ran second would silently win.
    const clash = reconciles.find((r) => r.candidate_key === d.candidate_key && r.listing_id === d.listing_id)
    if (clash) {
      throw new Error(`${configPath}: ${where} names listing_id ${d.listing_id}, which is also this candidate's reconcile target. A row cannot be both reconciled onto and distinct from.`)
    }
    if (byListing.has(d.listing_id)) {
      throw new Error(`${configPath}: ${where} names listing_id ${d.listing_id}, which another distinct_from_live entry already claims. One neighbour, one adjudication.`)
    }
    byListing.set(d.listing_id, d)
  }
  return byListing
}

/**
 * Settle one adjudication against the LIVE neighbour row and the incoming venue.
 *
 * Returns `{ ok, failures[], verified[], declared[] }`. `failures` is accumulated rather than thrown
 * because this runs inside preflight, which collects every failure before aborting — an operator
 * fixing one config should see all of its problems in one run, not one per run.
 */
export function verifyDistinctFromLive(entry, { venue, neighbour }) {
  const failures = []
  const verified = []
  const declared = []
  const where = `distinct_from_live ${entry.candidate_key} / ${entry.slug}`

  // The adjudication was made about a row with a particular slug. A re-slug may mean a rename, a
  // merge, or a different row entirely occupying that id — none of which the adjudicator saw.
  if (neighbour.slug !== entry.slug) {
    failures.push(`${where}: the live row ${entry.listing_id} is now slug "${neighbour.slug}", not "${entry.slug}" — the adjudication may no longer describe it. Re-adjudicate; do NOT just update the slug.`)
  }

  for (const k of entry.distinguishers) {
    const spec = DISTINGUISHERS[k]
    if (!spec.verified) { declared.push(k); continue }
    if (k === 'different_zip') {
      const a = venue.zip == null ? null : String(venue.zip).trim()
      const b = neighbour.zip == null ? null : String(neighbour.zip).trim()
      if (a == null || b == null) {
        failures.push(`${where}: claims different_zip but ${a == null ? 'the incoming venue' : 'the live neighbour'} has no zip — the claim cannot be true of data that is absent.`)
      } else if (a === b) {
        failures.push(`${where}: claims different_zip but both rows are ${a}. A distinguisher that is checkable is CHECKED.`)
      } else {
        verified.push(`different_zip: ${a} vs ${b}`)
      }
      continue
    }
    if (k === 'different_access_type') {
      const a = venue.access_type ?? null
      const b = neighbour.access_type ?? null
      if (a == null || b == null) {
        failures.push(`${where}: claims different_access_type but ${a == null ? 'the incoming venue' : 'the live neighbour'} has none.`)
      } else if (a === b) {
        failures.push(`${where}: claims different_access_type but both rows are "${a}". A distinguisher that is checkable is CHECKED.`)
      } else {
        verified.push(`different_access_type: ${a} vs ${b}`)
      }
    }
  }
  return { ok: failures.length === 0, failures, verified, declared }
}

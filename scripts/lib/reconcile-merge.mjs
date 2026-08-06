/**
 * Reconcile merge — a reconcile ENRICHES a dormant row, it does not blank it.
 *
 * Owner ruling 2026-07-31. The reconcile UPDATE in import-metro-merged.mjs applies listingFields(v)
 * wholesale, so before this EVERY field the research row left null overwrote a populated value on
 * the target. A reconcile exists to enrich a dormant record with researched facts, not to blank it:
 * where the incoming row has a null/empty value and the target has a populated one, the TARGET'S
 * value is kept. Where the incoming row has a value it wins — the research is newer and
 * better-evidenced, and that is the whole point of reconciling.
 *
 * THE CALLER MUST PASS THE LIVE ROW, NEVER THE CONFIG'S `osm_original` SNAPSHOT. That is not a
 * preference. `osm_original` was checked against live data on 2026-07-31 and is incomplete in 8 of
 * the 9 configured reconciles: it omits `zip` on 5 targets, `lighting` on 2, and Little Rock's entry
 * has no snapshot at all. Merging from it would have fixed Syracuse's dropped address while
 * silently re-introducing the identical loss on zip and lighting. Little Rock also shows why no
 * snapshot can ever be sufficient: its target carries a `google_place_id` written AFTER its
 * reconcile ran (the PR #479 backfill), which a snapshot taken at adjudication time cannot contain.
 * Only the live row knows what the row actually holds now.
 *
 * This lives in its own module because import-metro-merged.mjs executes on import (it reads argv and
 * exits), so nothing inside it can be unit-tested. Same split as workbook-extract.mjs.
 */

/**
 * Fields kept from the reconcile target when the incoming research row has nothing to say.
 * Nullable venue-fact and locator columns where a populated target value is a fact we already hold.
 *
 * NOT preserved, and each for its own reason:
 *   access_type          MUST keep overwriting. Targets carry 'unknown' and overwriting it is
 *                        exactly what makes them publishable. It is also unreachable by
 *                        construction — listingFields coerces null -> 'unknown' and the column is
 *                        NOT NULL DEFAULT 'unknown' — so no incoming-null state exists to trigger
 *                        preservation even by accident.
 *   name, slug           the reconcile's whole job on a generically-named OSM row ("Pickleball
 *                        Courts"); isGenericName() in scripts/lib/publish-gate.mjs would draft it
 *                        back. A preserved slug would describe the old name.
 *   source               the batch tag, and the one-statement rollback handle.
 *   status               always 'draft'; --stage=publish flips the gate-passers.
 *   metro_area           reconcile-controlled; it is what puts the row on /courts/in/<metro>.
 *   verification_status  reconcile-controlled.
 *   verified_at/by,      publish-stage controlled. `verified_by != null` is THE RELEASE FENCE in
 *   enrichment,          publish-facilities.mjs (ADR-17) — the sole thing standing between a held
 *   enriched_at,         draft and the public site — so preserving it would let a reconciled draft
 *   enrichment_version   inherit a release it never earned. `enrichment_version` is NO LONGER part of
 *                        that fence (it once was, and letting a Gemini-enriched OSM row satisfy it
 *                        was the bug that removed it), but it stays unpreserved regardless: it
 *                        describes work done to the target row, not to the incoming one.
 *   lat, lng             the stored coordinate is independently Nominatim-derived and
 *                        provenance.coordinate records that derivation, so preserving an OSM
 *                        coordinate would make the provenance node describe a coordinate that is not
 *                        in the row. They are also a coupled pair — preserving one is incoherent.
 *   name_source_url      it sources the NAME, and the reconcile renames the row; carrying it forward
 *                        would attribute the new name to a page that does not state it.
 *   country              `v.country || 'US'`, never null. A rule here would be dead code.
 *   provenance           built fresh by provenanceFor(); the merge writes its own node into it.
 *
 * Columns absent from listingFields entirely (id, osm_id, last_synced_at, nets_provided_count,
 * restrooms, parking, water_fountain, accessibility, created_at, updated_at) are never sent by
 * .update(fields) and so cannot be lost by this path at all.
 *
 * Two entries also fix a latent defect in passing: listingFields hardcodes `reservation_url: null`
 * and `location_id: null`, so both were nulled on every reconcile unconditionally. `location_id` is
 * the ADR-13 bridge to the operational `locations` table — nulling it severs a real link. No current
 * target carries either, so the exposure was latent rather than live.
 */
export const PRESERVE_ON_RECONCILE = [
  'address', 'city', 'state', 'zip', 'court_count', 'fee_type', 'reservation_policy',
  'reservation_url', 'indoor', 'lighting', 'surface', 'court_configuration', 'line_type',
  'net_setup', 'website', 'phone', 'public_notes', 'google_place_id', 'location_id',
]

/**
 * Everything the merge reads, plus the columns preflight's own target assertions need. Derived from
 * PRESERVE_ON_RECONCILE so a field added there cannot be silently left out of the SELECT — a column
 * that is not fetched reads as `undefined`, which looks exactly like "the target holds nothing" and
 * would blank it, i.e. the bug this whole mechanism exists to prevent.
 */
export const RECONCILE_TARGET_COLUMNS = ['id', 'osm_id', 'status', 'name', 'slug', 'access_type',
  'address_source', 'address_verified_at', 'lat', 'lng', ...PRESERVE_ON_RECONCILE].join(', ')

/**
 * Absent means null / undefined / empty string — NEVER merely falsy. `indoor: false` and
 * `lighting: false` are researched FACTS; treating them as absent would let a target `true`
 * overwrite them, and a boolean flipping the wrong way is invisible to every count and split table
 * in the importer.
 */
export const isAbsent = (x) => x === null || x === undefined || x === ''

/**
 * @param fields  listingFields(v) — what the research row wants to write
 * @param target  the LIVE reconcile target row, or null
 * @param rec     the config `reconciles[]` entry (for osm_id / listing_id in the provenance record)
 * @param nowIso  injected rather than read from the clock, so the result is deterministic in tests
 * @returns {{fields: object, preserved: object, targetSeen: boolean}}
 */
export function mergeOntoTarget(fields, target, rec, nowIso) {
  const merged = { ...fields }
  const preserved = {}
  if (!target) return { fields: merged, preserved, targetSeen: false }

  for (const f of PRESERVE_ON_RECONCILE) {
    if (!isAbsent(merged[f])) continue        // the research row has a value — it wins
    if (isAbsent(target[f])) continue         // nothing to keep
    merged[f] = target[f]
    preserved[f] = {
      value: target[f],
      origin: 'osm_listing',
      osm_id: rec.osm_id,
      listing_id: rec.listing_id,
      reason: 'the research row carried no value for this field and the reconcile target already held one, so the target value was kept rather than blanked',
      preserved_at: nowIso,
    }
  }

  // ADR-12: a preserved address is OSM-sourced and must say so. Not the research row's
  // address_source — that describes an address which is NOT in this row — and not the target's own
  // column, which is null on every current reconcile target because the OSM ingest never set it.
  // 'osm' is in the pinned six-value vocabulary, so this is a legitimate value, not a widening.
  if (preserved.address) {
    merged.address_source = 'osm'
    // We did not verify this address today. Stamping nowIso would assert that we did, which is the
    // same class of false claim as inheriting a source_url. Carry the target's own value.
    merged.address_verified_at = target.address_verified_at ?? null
    preserved.address.address_source_forced = 'osm'
    preserved.address.address_verified_at_kept = target.address_verified_at ?? null
    preserved.address.adr = 'ADR-12'
  }

  // Recorded even when empty, so a reader can tell "the merge ran and kept nothing" apart from "the
  // merge never ran". A silent merge is as bad as a silent overwrite.
  if (merged.provenance?.osm_reconcile) {
    merged.provenance.osm_reconcile.merge_policy = 'incoming_wins_unless_null'
    merged.provenance.osm_reconcile.preserved_fields = preserved
  }
  // The ODbL marker claims only the COORDINATE is OSM-derived. Once an OSM address rides along on
  // the same row that is no longer the whole truth, and attribution has to describe what was
  // actually taken.
  if (preserved.address && merged.provenance?.odbl) {
    merged.provenance.odbl += ' The ADDRESS on this row is ALSO OSM-derived: it was preserved from the reconciled OSM record because the research row carried none (address_source=\'osm\').'
  }

  return { fields: merged, preserved, targetSeen: true }
}

/**
 * Metres between two points. Duplicated from geocode-nominatim.mjs and import-metro-merged.mjs
 * DELIBERATELY, character for character: this module is imported by the importer, and importing the
 * geocoder here would drag the whole cache/fetch surface into a path that must never make a request.
 * The formula is asymmetric (it takes the cosine of the FIRST argument's latitude), so all three
 * copies must evaluate their arguments in the same order or a distance quoted in one place and
 * recomputed in another disagrees by ~0.07% — enough to break a re-derivation check.
 */
const metresBetween = (aLat, aLng, bLat, bLng) => {
  const dLat = (aLat - bLat) * 111320
  const dLng = (aLng - bLng) * 111320 * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

/** How far a re-derived distance may sit from the one written into a `coordinate_trade` before the
 *  acknowledgement is treated as stale. Same tolerance workbook_crosscheck already uses, for the
 *  same reason: a stored number is re-derived, never trusted. */
const TRADE_DISTANCE_TOLERANCE_M = 2

/**
 * Does this reconcile DESTROY or DEGRADE the coordinate on the row it rewrites?
 *
 * WHY THIS EXISTS. `listingFields` sends `lat: v.coordinates?.lat ?? null` and `mergeOntoTarget`
 * restores only fields in PRESERVE_ON_RECONCILE — from which lat/lng are deliberately absent, for
 * the reason stated at the top of this file. So the incoming coordinate ALWAYS wins, and two things
 * follow that nothing in the pipeline could see: reconciling an un-geocoded row writes NULL over a
 * good coordinate, and reconciling a worse-geocoded row writes a street band over a court-accurate
 * pin. Both were caught by a human reading source, twice.
 *
 * THE FIX IS NOT TO PRESERVE lat/lng. Adding them to PRESERVE_ON_RECONCILE would make
 * provenance.coordinate describe a coordinate the row does not hold — the invariant this module
 * exists to keep — and the pair is coupled, so preserving one is incoherent. The fix is to make the
 * pipeline SEE the trade and refuse to make it silently.
 *
 * THE TARGET'S OWN PRECISION IS UNAVAILABLE, so this does not ask for it. `location_precision` is
 * generated from `provenance -> 'coordinate' ->> 'precision'`, and a dormant OSM-ingested row has
 * `provenance = null` — verified across a 514-row live sample, every one NULL. What IS knowable is
 * that the target's coordinate is the centroid of a named OSM feature (the row carries an osm_id),
 * which beats a street band. Hence the rule keys on the INCOMING precision, not on a comparison.
 *
 * Two verdicts, split by whether a legitimate case exists:
 *
 *   'destroys'  incoming has no coordinate, target has one. FATAL, no acknowledgement accepted.
 *               There is no legitimate case: it deletes a coordinate AND leaves a row the gate then
 *               blocks — strictly worse on both axes. Offering an override here would build exactly
 *               the bypass this mechanism exists to avoid.
 *
 *   'degrades'  incoming is `low`, target has a coordinate. Requires an explicit `coordinate_trade`
 *               on the reconcile entry. A legitimate case demonstrably exists — Orlando's owner
 *               accepted precisely this trade, because the target had metro_area NULL and so
 *               published nothing, and protecting its precision would have kept a 14-court flagship
 *               dark to guard a pin nobody could see. A hard refusal would have blocked a correct
 *               decision.
 *
 * The acknowledgement cannot be pasted blind: `distance_m` and `incoming_precision` are RE-DERIVED
 * here and a divergence is fatal, so an ack that was true when it was written stops being accepted
 * the moment the data moves.
 *
 * @returns {{verdict: 'ok'|'destroys'|'degrades', distance_m: number|null, incoming_precision: string|null,
 *            fatal: string|null, trade: object|null, report: string}}
 */
export function assertReconcileCoordinate({ incoming, target, rec, nowIso = null }) {
  const inLat = incoming?.lat ?? null
  const inLng = incoming?.lng ?? null
  const incoming_precision = incoming?.provenance?.coordinate?.precision ?? null
  const tLat = target?.lat ?? null
  const tLng = target?.lng ?? null
  const targetHas = tLat != null && tLng != null
  const distance_m = (inLat != null && inLng != null && targetHas)
    ? Math.round(metresBetween(inLat, inLng, tLat, tLng))
    : null
  const where = `reconcile ${rec?.candidate_key ?? '(unknown)'} (${rec?.osm_id ?? '?'})`
  const base = { distance_m, incoming_precision, trade: null }

  if (!targetHas) {
    return { ...base, verdict: 'ok', fatal: null, report: `${where}: target holds no coordinate — nothing to overwrite.` }
  }
  if (inLat == null || inLng == null) {
    return {
      ...base,
      verdict: 'destroys',
      fatal: `${where}: the research row has NO coordinate and the reconcile target holds one (${tLat},${tLng}). `
        + `The UPDATE would write NULL over it — lat/lng are deliberately not preserved by the merge, so the incoming value always wins. `
        + `That destroys a good coordinate AND leaves a row the publish gate blocks. There is no acknowledgement for this: `
        + `either geocode the research row, adopt the target's coordinate via venue_facts.<key>.coordinate, or drop the reconcile. `
        + `Never reconcile a row that failed to geocode.`,
      report: `${where}: WOULD NULL the target's coordinate.`,
    }
  }

  const report = `${where}: incoming ${incoming_precision ?? 'unknown'} at ${inLat},${inLng} vs target ${tLat},${tLng} — ${distance_m} m apart.`
  if (incoming_precision !== 'low') {
    return { ...base, verdict: 'ok', fatal: null, report }
  }

  // Degrading. An acknowledgement is required, and it must still be TRUE.
  const t = rec?.coordinate_trade
  if (!t || t.acknowledged !== true) {
    return {
      ...base,
      verdict: 'degrades',
      fatal: `${where}: the research row's coordinate is precision 'low' (a street band) and the reconcile target holds a coordinate `
        + `${distance_m} m away that came from a named OSM feature. The UPDATE would replace the better pin with the worse one.\n`
        + `      The better fix is usually to ADOPT the target's coordinate — add venue_facts.${rec?.candidate_key}.coordinate naming its OSM feature.\n`
        + `      If the trade is deliberate, record it on the reconcile entry (it is re-derived on every run, so it cannot be stale):\n`
        + `        "coordinate_trade": { "acknowledged": true, "incoming_precision": "low", "distance_m": ${distance_m}, `
        + `"reason": "<why the worse pin is acceptable>", "adjudicated_by": "<who>", "adjudicated_on": "<YYYY-MM-DD>" }`,
      report: `${report} DEGRADES, unacknowledged.`,
    }
  }
  for (const k of ['reason', 'adjudicated_by', 'adjudicated_on']) {
    if (!t[k]) {
      return { ...base, verdict: 'degrades', fatal: `${where}: coordinate_trade is missing "${k}" — an acknowledged trade must say who accepted it, when, and why.`, report }
    }
  }
  if (t.incoming_precision !== incoming_precision) {
    return { ...base, verdict: 'degrades', fatal: `${where}: coordinate_trade says incoming_precision "${t.incoming_precision}" but the row is "${incoming_precision}" — the acknowledgement no longer describes this data. Re-adjudicate.`, report }
  }
  if (!(Math.abs(Number(t.distance_m) - distance_m) <= TRADE_DISTANCE_TOLERANCE_M)) {
    return { ...base, verdict: 'degrades', fatal: `${where}: coordinate_trade says distance_m ${t.distance_m} but it recomputes to ${distance_m} — the acknowledgement no longer describes this data. Re-adjudicate.`, report }
  }
  return {
    ...base,
    verdict: 'degrades',
    fatal: null,
    trade: {
      ...t,
      distance_m,
      incoming_precision,
      superseded: { lat: tLat, lng: tLng },
      recoverable_from: 'provenance.osm_reconcile.osm_original',
      acknowledged_at: nowIso,
    },
    report: `${report} DEGRADES — acknowledged by ${t.adjudicated_by} on ${t.adjudicated_on}: ${t.reason}`,
  }
}

export const preservedSummary = (preserved) => {
  const keys = Object.keys(preserved)
  return keys.length ? keys.map((k) => `${k}=${JSON.stringify(preserved[k].value)}`).join('  ') : null
}

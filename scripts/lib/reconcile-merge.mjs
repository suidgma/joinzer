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
 *                        Courts"); isGenericName() in publish-facilities.mjs would draft it back.
 *                        A preserved slug would describe the old name.
 *   source               the batch tag, and the one-statement rollback handle.
 *   status               always 'draft'; --stage=publish flips the gate-passers.
 *   metro_area           reconcile-controlled; it is what puts the row on /courts/in/<metro>.
 *   verification_status  reconcile-controlled.
 *   verified_at/by,      publish-stage controlled. `verified_by != null` is the reconcile-gate trust
 *   enrichment,          signal in publish-facilities.mjs and `enrichment_version != null` is the
 *   enriched_at,         other; preserving either would let a reconciled draft inherit a trust
 *   enrichment_version   signal it never earned and quietly defeat that gate.
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
  'address_source', 'address_verified_at', ...PRESERVE_ON_RECONCILE].join(', ')

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

export const preservedSummary = (preserved) => {
  const keys = Object.keys(preserved)
  return keys.length ? keys.map((k) => `${k}=${JSON.stringify(preserved[k].value)}`).join('  ') : null
}

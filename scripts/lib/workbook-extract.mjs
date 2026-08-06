/**
 * Venue-research workbook -> candidates artifact.
 *
 * Turns one metro's 15-tab Google Sheets research workbook into the candidates JSON that
 * scripts/import-metro-merged.mjs consumes — the same artifact shape the hand-built Little Rock
 * import used, so the generic importer can be validated against a known-good published batch.
 *
 * INPUT ROUTE (stated plainly, because the brief asked): there is no Google service account wired
 * into this repo, and adding one would be a new dependency plus a new secret. Instead the tabs are
 * pulled by an operator/agent through the Google Sheets MCP and dumped to a plain JSON file shaped
 * exactly like the MCP response — `{ "<tab name>": [[row], [row], ...] }` — which this script then
 * reads. Nothing here talks to Google. A `--csv-dir` fallback reads `<Tab Name>.csv` exports of the
 * same tabs, for the case where the MCP is unavailable and exports are supplied by hand.
 *
 * WHAT IT HANDLES (the three known workbook defects):
 *
 *  1. NO TRUSTWORTHY COORDINATES. The Import Ready tab has no lat/lng at all. Where the Venues tab
 *     does carry coordinate columns they are structurally corrupt (Little Rock: from ~row 8 every
 *     column from `phone` rightward shifted one place right, so the latitude column held a phone
 *     number, the longitude column held the latitude, and the longitude fell out of the row
 *     entirely). Even realigned, half were >1 km off. So **every venue is geocoded independently**
 *     via scripts/lib/geocode-nominatim.mjs and a workbook coordinate is NEVER persisted — it is
 *     recorded only as coordinate.workbook_crosscheck with a delta the importer re-derives.
 *
 *  2. NON-SCHEMA ENUMS THAT VARY PER WORKBOOK. The workbook vocabulary is not the live CHECK
 *     vocabulary and differs between metros (`shared_use` in one, `shared-use` in another). Every
 *     mapping is declared in the MAPPINGS table below, is applied verbatim, and is recorded in the
 *     artifact's `_meta.enum_mappings_applied`. **An unmapped value aborts the extract** — it is
 *     never silently nulled, because a silent null is a fact quietly deleted.
 *
 *  3. ADR-14 EVIDENCE TIERING. A venue whose evidence is aggregator-only cannot reach
 *     research_status='verified'; it is downgraded to `probable` here and the publish gate then
 *     holds it draft automatically. Aggregator URLs are also stripped out of the user-facing
 *     columns (website / name_source_url) and kept in provenance only — never republished.
 *
 * ALSO CORRECTED HERE (not flagged in the brief, found in the Toledo workbook): the workbook's own
 * `slug` column is a RESEARCH KEY (`tol-oh-inez-nash-park`), not a directory URL slug. Publishing it
 * verbatim would produce /courts/tol-oh-inez-nash-park, permanently, and diverge from every metro
 * already live. Slugs are therefore GENERATED as `<name>-<city>-<state>`, matching the convention of
 * all 321 published rows; the workbook value is retained in provenance.workbook_slug.
 *
 * Usage:
 *   node scripts/lib/workbook-extract.mjs --metro=toledo --raw=metro-research/toledo/tabs.json
 *   node scripts/lib/workbook-extract.mjs --metro=toledo --csv-dir=metro-research/toledo/csv
 *   node scripts/lib/workbook-extract.mjs --metro=toledo --raw=... --no-geocode   (shape check only)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { geocodeVenue, lookupOsmFeature, houseNumberOf, flushCache, liveRequestCount, cacheStats, metresBetween, geocodeCachePath } from './geocode-nominatim.mjs'

/**
 * How far an adopted OSM feature may sit from the point recorded at adjudication time.
 *
 * DELIBERATELY TIGHT. `expect_lat`/`expect_lng` are authored FROM the same `/lookup` response the
 * run resolves, so agreement should be exact; the allowance exists only so a minor geometry edit — a
 * mapper redrawing a pitch polygon by a few metres — does not abort a metro. Anything larger is a
 * different feature or a moved one, and the honest response is to re-adjudicate.
 *
 * NOTE THIS IS NOT THE SAME NUMBER AS THE CONFIG'S OWN SNAPSHOT ACCURACY. Orlando's
 * `reconciles[].osm_original` records lat 28.7078188 / lng -81.2750719 for way/1165951096, which is
 * 34.6 m from what `/lookup` returns for the same feature — the stored row carries the OSM ingest's
 * centroid, Nominatim computes its own. That gap is precisely why a config-stated coordinate is a
 * CROSS-CHECK and never the source, and why `expect_*` must be authored from the lookup rather than
 * copied out of a snapshot.
 */
const ADOPT_CROSSCHECK_MAX_M = 25

/**
 * How far an adopted OSM feature may sit from the coordinate the query ladder already produced.
 *
 * SAME VALUE, SAME QUESTION AND SAME EVIDENCE AS the same-site name pass's `same_site_name_max_m`:
 * "is this named feature the same site as the one the address resolved to?" Against the same trap,
 * too — Harrisburg's "Koons Park" returns a single confident `leisure/park "Koons Park"` 14 km away
 * in another township, name-matching exactly and classifying `high`, so no precision rule can catch
 * it and only distance can.
 *
 * NOT CONFIG-OVERRIDABLE, unlike its same-site sibling. A per-metro knob here would be the
 * relaxation lever this whole mechanism exists to make unnecessary: the point of adoption is to state
 * a fact the guard then honours, not to widen the guard until a fact fits through it. A rejection
 * holds the row, which is the safe direction. Orlando's AdventHealth adoption sits at 407 m — 2.5x
 * headroom — so the constant is not fitted to the case that motivated it.
 */
const ADOPT_ANCHOR_MAX_M = 1000

// =============================================================================================
// LIVE CHECK VOCABULARIES — re-verified against pg_constraint on the production project
// (gkbibpneusfnwkjedwbi) 2026-07-31. These are the ONLY values the database will accept.
// Keep in lockstep with scripts/import-metro-merged.mjs, which asserts on the same sets.
// =============================================================================================
export const LIVE = {
  research_status: new Set(['pending', 'verified', 'probable', 'unresolved', 'unresolved_unnamed', 'duplicate', 'not_venue', 'not_pickleball', 'held', 'published']),
  access_type: new Set(['public', 'private', 'membership', 'school', 'hoa', 'unknown']),
  fee_type: new Set(['free', 'fee', 'membership', 'unknown']),
  reservation_policy: new Set(['none', 'drop_in', 'reservation_recommended', 'reservation_required', 'unknown']),
  address_source: new Set(['official_page', 'osm', 'county_open_data', 'manual_research', 'organizer', 'unknown_legacy']),
  court_configuration: new Set(['dedicated', 'shared_multi_use', 'mixed', 'unknown']),
  line_type: new Set(['permanent_painted', 'temporary_provided', 'byo_required', 'none', 'mixed', 'unknown']),
  net_setup: new Set(['permanent', 'portable_provided', 'shared_tennis_net', 'byo_required', 'none', 'mixed', 'unknown']),
  surface: new Set(['concrete', 'asphalt', 'paved', 'hard', 'hard_court', 'acrylic', 'sport_court', 'tartan', 'ground', 'artificial_turf', 'rubber', 'wood', 'grass', 'clay', 'ice', 'other']),
  confidence: new Set(['low', 'medium', 'high']),
  parking: new Set(['lot', 'street', 'none', 'unknown']),
  verification_status: new Set(['unverified', 'source_verified', 'human_verified']),
}

// =============================================================================================
// THE MAPPING TABLE — workbook vocabulary -> live vocabulary.
//
// Every entry is a deliberate, defensible translation, not a guess. `null` on the right-hand side
// means "this workbook value carries no information the column can honestly hold" and the raw string
// is preserved in provenance.fields.<field>.workbook_value. A value absent from the table entirely
// ABORTS the extract.
//
// Keys are normalized first: lowercased, trimmed, and every run of non-alphanumerics collapsed to a
// single underscore. That is what makes `shared_use`, `shared-use` and `Shared Use` one entry
// instead of three, which matters because the workbooks disagree with each other on this.
// =============================================================================================
/**
 * Generation B has NO research_status column — it has `status`, a record-state flag whose observed
 * values are `active` and `draft`. Mapping either to `verified` wholesale would let 8 metros bypass
 * the ADR-14 evidence bar in a single table row, so the status is decided from the evidence the row
 * actually carries: a non-aggregator (controlling-entity) source URL, or nothing.
 *
 * This is a second, independent enforcement of the rule the aggregator-only downgrade already
 * applies further down; the two agree by construction and neither is load-bearing alone. When the
 * evidence is absent or aggregator-only the answer is `probable` — the publish gate holds the row and
 * promotion later is a one-field update, which is the cheap direction to be wrong in.
 */
function recordStateStatus(token, ctx) {
  const good = ctx.nonAggregatorUrls || []
  const agg = ctx.aggregatorUrls || []
  if (good.length) {
    return {
      value: 'verified',
      branch: `${token}_with_controlling_source`,
      reason: `workbook status="${token}" is a record-state flag, not an evidence claim; promoted to verified because the row cites ${good.length} non-aggregator source(s): ${good.join(', ')}`,
    }
  }
  return {
    value: 'probable',
    branch: `${token}_without_controlling_source`,
    reason: agg.length
      ? `workbook status="${token}" but every source is a tier-4 aggregator (${agg.join(', ')}) — ADR-14 bars 'verified' on aggregator evidence alone, so it rests at 'probable' and the publish gate holds it`
      : `workbook status="${token}" but the row cites NO source URL at all — a record-state flag is not evidence, so it rests at 'probable' and the publish gate holds it`,
  }
}

export const MAPPINGS = {
  access_type: {
    public: 'public',
    // Walk-in commercial facility: anyone may enter and pay. `commercial` is not a live value; the
    // access question is "who may enter" (public) and the money question is fee_type='fee'. This is
    // the ADR-13 Vegas-parity encoding, applied to Toledo Pickle Co. / Pickle Zone / Premier Academy.
    commercial: 'public',
    // Municipal recreation programming — open to the public, typically a per-session drop-in fee.
    public_program: 'public',
    // CONDITIONAL (owner ruling 2026-07-31). `private_institution` is not a live value, and a flat
    // map to `school` would mislabel private clubs across the other 28 metros — University of
    // Toledo is not representative of what workbooks put in this column. So the branch is decided
    // per row from the venue's own identity, and which branch fired is recorded in
    // provenance.fields.access_type.mapping_branch so the decision is auditable per row.
    //   -> school   when the venue is genuinely an educational institution
    //   -> private  otherwise (the safer default: it claims less)
    // Token list is deliberately tight. "academy" is NOT an educational token here — a sports
    // academy is at least as common as a private school, and defaulting to `private` is the
    // instruction. A .edu host is treated as decisive on its own.
    private_institution: (ctx) => {
      const eduHost = /^https?:\/\/[^/]*\.edu(?::\d+)?(?:\/|$)/i.test(ctx.website || '')
      const hay = `${ctx.name || ''} ${ctx.controlling_entity || ''}`.toLowerCase()
      const eduWord = /\b(university|college|school|campus|institute|seminary|polytechnic)\b/.test(hay)
      if (eduHost) return { value: 'school', branch: 'school', reason: `.edu host on "${ctx.website}"` }
      if (eduWord) return { value: 'school', branch: 'school', reason: `educational token in name/controlling entity: "${ctx.name}" / "${ctx.controlling_entity || ''}"` }
      return { value: 'private', branch: 'private', reason: `no .edu host and no educational token in name/controlling entity — defaulted to private rather than school` }
    },
    school: 'school',
    university: 'school',
    college: 'school',
    membership: 'membership',
    member: 'membership',
    // Provo. "Public membership" is a membership facility that anyone may join — the access
    // question is answered by the membership requirement, not by who is eligible for it.
    public_membership: 'membership',
    // Chattanooga. A municipal rec center is publicly accessible; any door fee is fee_type's job.
    public_rec_center: 'public',
    // Chattanooga. A municipal park is publicly accessible; unambiguous.
    public_park: 'public',
    // Chattanooga — YMCA branches. Membership is required to enter; unambiguous.
    membership_rec_center: 'membership',
    // Chattanooga. AMBIGUOUS and deliberately unresolved. Unlike bare `commercial` (which the table
    // maps to public on the ADR-13 walk-in-and-pay reading), "club" carries a membership implication,
    // and this metro proves the token spans both: Pickleball Kingdom reads fee_type=paid (walk-in)
    // while Ace Pickleball Club reads fee_type=membership. One flat mapping cannot be right for both,
    // and deciding it from the fee column would be cross-column inference. So it rests at `unknown`,
    // which FAILS the publish gate and holds both rows draft rather than publishing a guessed access
    // class. Promoting either is an owner call.
    commercial_club: 'unknown',
    private: 'private',
    private_club: 'private',                 // Jackson — unambiguous
    // "Scheduled"/"resident" qualify WHEN or FOR WHOM, not the access class. Both are publicly
    // accessible facilities; the scheduling belongs to reservation_policy and residency is not a
    // dimension the schema models.
    scheduled_public: 'public',              // Jackson
    resident_public: 'public',               // Poughkeepsie
    school_public_limited: 'school',         // Provo — an institution with limited public access
    // AMBIGUOUS between two real values (membership vs public). Per the ruling-1 procedure this
    // rests at `unknown` — and because access_type='unknown' FAILS the publish gate, the row is
    // held draft rather than published under a guessed access class. The safe direction.
    membership_or_drop_in: 'unknown',        // Jackson
    membership_or_day_pass: 'unknown',       // Akron — membership vs pay-per-visit; holds the row
    // A university/college facility. `school` is the institutional value; the "when available"
    // qualifier is a scheduling fact, not an access class.
    institutional_public: 'school',          // Wichita
    institutional_public_when_available: 'school',   // Akron
    // Same shape as membership_or_guest_pass above, which already maps to membership.
    guest_pass_or_membership: 'membership',  // Wichita
    // ---- nine-stage generation, 2026-07-31 -------------------------------------------------
    // Spokane encodes access AND money in one token. Only the access half is representable in this
    // column; the money half stays fee_type's job and is deliberately NOT relocated there (that is
    // ruling 2 — a value is never moved to the column it appears to belong to). Raw kept in
    // provenance.fields.access_type.workbook_value either way.
    public_free: 'public',                   // Spokane
    paid_public: 'public',                   // Spokane
    // Drop-in with no membership gate: anyone may walk in and pay — the same ADR-13 encoding as
    // `commercial`. Note the mirror: membership_or_drop_in rests at `unknown` precisely BECAUSE
    // drop-in on its own is public, which is what makes the pair ambiguous.
    dropin: 'public',                        // Spokane
    membership_or_dropin: 'unknown',         // Spokane — spelling variant of membership_or_drop_in
    membership_or_guest: 'membership',       // Spokane — same shape as guest_pass_or_membership
    membership_or_program: 'unknown',        // Harrisburg — membership vs program(public): two real values
    // Augusta — Torch Fitness Center, Fort Eisenhower. "restricted" establishes only that the venue
    // is NOT open to the general public; it does not say which of private/membership/school it is.
    // Bare ambiguous tokens rest at `unknown` here exactly as `scheduled` and `reservation` do, and
    // because access_type='unknown' fails the publish gate the row is held draft rather than
    // published under a guessed access class. Promoting it to `private` is an owner call.
    restricted: 'unknown',                   // Augusta
    // Portland ME (generation C). Publicly accessible with a time restriction — school-hours or
    // seasonal. Same reading the table already applies to `scheduled_public` and `resident_public`:
    // the qualifier says WHEN or FOR WHOM, not what the access class is. Deliberately NOT `school`,
    // even though the rows carrying it are mostly school sites: the token itself names no
    // institution, and `school_public_limited` (which does) is the entry that maps that way.
    public_limited: 'public',                // Portland ME
    // Cape Coral — Bonita Beach Club. Unlike membership_or_drop_in / membership_or_day_pass, this
    // token does NOT name two competing access classes: "private" is the adjective describing how an
    // HOA amenity is accessed, and "hoa" is the class. The vocabulary's own definition of `hoa`
    // (facilities controlled by an HOA or community association, open to its residents) already
    // carries the "private" half, so mapping to `hoa` loses nothing and is strictly more specific
    // than `private`. This is the same correction the Vegas pass made by hand on five rows —
    // Canyon Gate, Desert Vista, Regency at Summerlin, Reverence and Siena were all stored `private`
    // where `hoa` was the better fit — applied here at extract time instead of after import.
    private_hoa: 'hoa',
    hoa: 'hoa',
    unknown: 'unknown',
  },
  fee_type: {
    free: 'free',
    paid: 'fee',           // `paid` is NOT a live value — this is the single most common workbook defect
    fee: 'fee',
    drop_in_fee: 'fee',
    day_pass: 'fee',
    day_fee: 'fee',                          // Portland ME (generation C) — unambiguous
    membership: 'membership',
    membership_or_guest_pass: 'membership',
    // Provo. Genuinely ambiguous between two real values (`fee` and `membership`) — asserting
    // either would be a guess, so it rests at `unknown` with the raw string kept in provenance.
    paid_or_membership: 'unknown',
    // All three unambiguously mean money changes hands. `fee` is the schema's word for that.
    court_fee: 'fee',                        // Ogden
    program_fee: 'fee',                      // Ogden
    fee_based: 'fee',                        // Des Moines ("fee-based" after normalization)
    paid_drop_in: 'fee',                     // Durham, Pensacola
    key_or_program_fee: 'fee',               // Pensacola
    reservation_fee: 'fee',                  // Wichita
    // "Free or program" — base access is free, the program is the paid extra. Same reading as the
    // ruling-1 example "Free / rentals and programs may vary" -> free.
    free_or_program: 'free',                 // Durham
    // Ambiguous between fee and free-under-a-program -> unknown, raw preserved.
    paid_or_program: 'unknown',              // Durham
    // ---- nine-stage generation, 2026-07-31 -------------------------------------------------
    fee_required: 'fee',                     // Lancaster — unambiguous
    rental_fee: 'fee',                       // Lancaster — unambiguous
    free_or_program_fee: 'free',             // Harrisburg — identical reading to Durham's
                                             // free_or_program: base access free, program the paid extra
    program_dependent: 'unknown',            // Fayetteville — free vs fee, two real values
    // A permit is an authorization, not a price — it may or may not carry one. The column cannot
    // honestly hold `free` or `fee`, so it rests at unknown with the raw kept in provenance.
    permit: 'unknown',                       // New Haven
    // `mixed` is legitimate vocabulary in FOUR other columns, so leaving it unmapped here would send
    // it down the contamination path as a wrong-column value — a false positive, because a mixed fee
    // structure is a real fee_type statement. Mapped in its own column for exactly the reason
    // net_setup.temporary is (see that entry). fee_type has no `mixed`, so it rests at unknown.
    mixed: 'unknown',                        // New Haven
    // Portland ME. Ambiguous between two real values (membership vs pay-per-visit), exactly like
    // paid_or_membership and membership_or_drop_in — rests at unknown, raw kept in provenance.
    membership_or_fee: 'unknown',            // Portland ME
    // ---- Huntsville, 2026-07-31 --------------------------------------------------------------
    // "low cost" is a price LEVEL, not an ambiguity: it states affirmatively that money changes
    // hands, and `fee` is the only word this column has for that. The schema has no cheap/expensive
    // tier to lose, and one of these rows (New Hope) says "$1 listed" in its own notes. Same reading
    // as court_fee / program_fee / drop_in_fee / day_pass, all of which already resolve to `fee`.
    low_cost: 'fee',                         // Huntsville
    // Membership OR a per-visit day fee — two real fee_type values, so no single one is assertable.
    // Identical shape to membership_or_fee and paid_or_membership above; NOT the same as
    // membership_or_guest_pass, where a guest pass is itself a membership mechanism.
    membership_or_day_fee: 'unknown',        // Huntsville
    unknown: 'unknown',
  },
  court_configuration: {
    dedicated: 'dedicated',
    shared_use: 'shared_multi_use',   // covers `shared_use`, `shared-use`, `Shared Use` after normalization
    shared: 'shared_multi_use',
    // Modesto/generation B. `shared_tennis` is ALSO net_setup vocabulary, so leaving it unmapped here
    // sends it down the contamination path as a wrong-column value — a false positive, because
    // "shared tennis" in a court_configuration column is a real and unambiguous statement about the
    // configuration (the pickleball courts share the tennis courts). Same fix, same reason, as
    // fee_type.mixed and net_setup.temporary: a token meaningful in two columns must be mapped in
    // BOTH, because the contamination path is only reached for values unmapped in their own column.
    shared_tennis: 'shared_multi_use',
    shared_multi_use: 'shared_multi_use',
    multi_use: 'shared_multi_use',
    hybrid: 'shared_multi_use',              // Akron — lines for more than one sport on one court
    // Scranton. The token names sharing with tennis outright, the same reading Modesto's prose
    // "converted tennis" already resolves to.
    shared_tennis_conversion: 'shared_multi_use',   // Scranton
    // Scranton. Genuinely ambiguous between two real values — rests at unknown, raw preserved.
    shared_or_dedicated: 'unknown',          // Scranton
    mixed: 'mixed',
    unknown: 'unknown',
  },
  // Some workbooks carry a reservation_policy column directly instead of the yes/no column.
  reservation_policy: {
    none: 'none',
    first_come: 'drop_in',
    first_come_first_served: 'drop_in',
    first_come_first_served_except_programs: 'drop_in',
    drop_in: 'drop_in',
    scheduled_drop_in: 'drop_in',
    scheduled_open_play: 'drop_in',
    open_play: 'drop_in',
    open_public: 'drop_in',                  // Akron
    first_come_when_not_programmed: 'drop_in',   // Akron — first-come IS the base policy
    reservable: 'reservation_recommended',
    recommended: 'reservation_recommended',
    reservation_recommended: 'reservation_recommended',
    reservation_available: 'reservation_recommended',
    required: 'reservation_required',
    reservation_required: 'reservation_required',
    registration_required: 'reservation_required',   // Akron
    not_reservable: 'none',                  // Ogden — unambiguous
    // Genuinely mixed or conditional state -> `unknown`, per the ruling-1 procedure. Each of these
    // says "sometimes", and the schema has no value for "sometimes".
    partially_reservable: 'unknown',         // Ogden
    reservable_for_events: 'unknown',        // Provo — reservable for events, unclear for open play
    scheduled: 'unknown',                    // Ogden — bare "scheduled" is ambiguous between
                                             // scheduled-open-play (drop_in) and by-reservation
    reservation: 'unknown',                  // Des Moines — ambiguous: required vs merely available
    // Poughkeepsie puts bare yes/no in a column NAMED reservation_policy. That is vocabulary
    // variance within the same semantic field, not a value in the wrong column — the two columns
    // are two encodings of one concept, so a value from either is legitimate in either. Mapped
    // identically to the reservation_required table below.
    yes: 'reservation_required',
    no: 'drop_in',
    not_required: 'drop_in',                 // Akron — same same-field vocabulary variance as yes/no
    // ---- nine-stage generation, 2026-07-31 -------------------------------------------------
    // All three are bare mechanism names that do not say whether the mechanism is REQUIRED or merely
    // AVAILABLE — the same ambiguity that already rests `scheduled` and `reservation` at unknown.
    registration: 'unknown',                 // Augusta
    scheduled_play: 'unknown',               // New Haven
    // ---- Scranton -------------------------------------------------------------------------
    // Each names two real mechanisms without saying which applies, the same shape as
    // permit_or_reservation. Rests at unknown; raw preserved.
    reservation_or_program: 'unknown',       // Scranton
    reservation_or_open_play: 'unknown',     // Scranton
    // Scranton. This token states an ACCESS/PAYMENT mode, not a reservation policy — it belongs to
    // the fee/access question. It is mapped here (rather than left to abort or to the contamination
    // path, which cannot see it because the exact token is in no other table) so the column says the
    // honest thing: this cell establishes NOTHING about reservations. The value is NOT relocated to
    // fee_type — that would be the inference ruling 2 forbids — and the raw string is kept in
    // provenance.fields.reservation_policy.
    membership_or_short_term: 'unknown',     // Scranton
    permit_or_reservation: 'unknown',        // New Haven — a permit is not a reservation; two distinct
                                             // mechanisms, so no single policy is established
    unknown: 'unknown',
  },
  // The `reservation_required` yes/no column found in the Import Ready template.
  // BLANK IS NOT "no" — a blank cell means the research did not establish a policy, so it maps to
  // null (not researched) rather than drop_in. 21 of Toledo's 23 rows are blank; inferring drop_in
  // there would fabricate a fact about 21 venues.
  reservation_required: {
    yes: 'reservation_required',
    y: 'reservation_required',
    true: 'reservation_required',
    required: 'reservation_required',
    no: 'drop_in',
    n: 'drop_in',
    false: 'drop_in',
    not_required: 'drop_in',
    unknown: 'unknown',
  },
  // `indoor` is a BOOLEAN column. `mixed` is genuinely unrepresentable in it — writing either value
  // asserts something false — so it maps to null with the raw string kept in provenance.
  indoor_outdoor: {
    outdoor: false,
    indoor: true,
    // `indoor` is a boolean; a venue that is both is unrepresentable in it. All of these normalize
    // to the same handling as Toledo's `mixed`: null the column, keep the raw string in provenance.
    // ("Indoor + Outdoor" normalizes to indoor_outdoor; "shared-use" to shared_use — case and
    // separator variance is absorbed by normKey so it stops being a per-workbook tax.)
    mixed: null,
    both: null,
    indoor_outdoor: null,
    indoor_and_outdoor: null,
    indoor_outdoor_mixed: null,
    unknown: null,
  },
  surface: {
    concrete: 'concrete',
    asphalt: 'asphalt',
    paved: 'paved',
    hard: 'hard',
    hard_court: 'hard_court',
    acrylic: 'acrylic',
    sport_court: 'sport_court',
    tartan: 'tartan',
    ground: 'ground',
    artificial_turf: 'artificial_turf',
    rubber: 'rubber',
    wood: 'wood',
    hardwood: 'wood',                        // Wichita — unambiguous
    grass: 'grass',
    clay: 'clay',
    ice: 'ice',
    other: 'other',
    // No honest mapping exists for these: `wood` invents a material the source did not state and
    // `other` conveys nothing a reader can use. Null the column, keep the raw string in provenance.
    // Scranton. Both name two things at once and neither resolves to one live material. `hard_tru`
    // is a brand token (Har-Tru is a green-clay system) sitting in a column whose vocabulary is
    // materials — reading it as `clay` asserts specificity from a trade name the schema does not
    // know, and reading it as `hard` contradicts the venue's own note. `wood_or_hard` names two
    // materials outright, which the table already resolves to null everywhere else. Raw preserved.
    hard_tru: null,                          // Scranton — owner-reversible if Har-Tru should read `clay`
    wood_or_hard: null,                      // Scranton
    // Huntsville. `mixed` is legitimate vocabulary in FOUR other columns (court_configuration,
    // line_type, net_setup, fee_type), so leaving it unmapped here sends it down the contamination
    // path as a wrong-column value — a FALSE POSITIVE, because a venue with indoor wood and outdoor
    // hard courts genuinely has a mixed surface. Fourth instance of the standing rule: a token
    // meaningful in two columns must be mapped in BOTH, because the contamination path is only
    // reached for values unmapped in their own column. (After net_setup.temporary, fee_type.mixed
    // and court_configuration.shared_tennis.) `surface` has no `mixed` in its CHECK set and IS
    // nullable, so it resolves to null with the raw kept — the same call as wood_or_hard.
    mixed: null,                             // Huntsville
    // Huntsville — Rocket City Pickleball Club. A trade name, not a material. CushionX is a
    // cushioned acrylic system; reading it as `acrylic` asserts a specificity the source did not
    // state and reading it as `hard` contradicts the cushioning the name claims. Same call as the
    // already-present `cushioned` and Scranton's `hard_tru` brand token: null, raw preserved.
    cushionx: null,                          // Huntsville
    gym: null,
    gym_floor: null,
    gymnasium: null,
    multi_sport: null,
    indoor: null,
    cushioned: null,
    unknown: null,
  },
  line_type: {
    permanent_painted: 'permanent_painted',
    painted: 'permanent_painted',
    permanent: 'permanent_painted',
    temporary_provided: 'temporary_provided',
    temporary: 'temporary_provided',
    taped: 'temporary_provided',
    // Scranton. Names two real values without saying which — the paid_or_membership shape.
    permanent_or_taped: 'unknown',           // Scranton
    byo_required: 'byo_required',
    byo: 'byo_required',
    none: 'none',
    mixed: 'mixed',
    unknown: 'unknown',
  },
  net_setup: {
    permanent: 'permanent',
    portable_provided: 'portable_provided',
    portable: 'portable_provided',
    mobile: 'portable_provided',             // Ogden, Des Moines — "mobile nets" = portable
    // Provo. "Temporary" is ALSO line_type vocabulary, so without this entry the contamination
    // detector flags it as a wrong-column value — a false positive, because temporary nets are a
    // perfectly real net_setup. A token meaningful in two columns must be mapped in BOTH; the
    // contamination path is only reached for values unmapped in their own column, which is what
    // keeps that fix precise rather than a blanket suppression.
    temporary: 'portable_provided',
    provided: 'portable_provided',
    rolling: 'portable_provided',            // Harrisburg — a rolling net is a portable net
    shared_tennis_net: 'shared_tennis_net',
    tennis: 'shared_tennis_net',
    shared_tennis: 'shared_tennis_net',
    tennis_net: 'shared_tennis_net',         // Harrisburg — unambiguous
    byo_required: 'byo_required',
    bring_your_own: 'byo_required',          // Portland ME — spelling variant, unambiguous
    byo: 'byo_required',
    none: 'none',
    mixed: 'mixed',
    unknown: 'unknown',
  },
  address_source: {
    official_page: 'official_page',
    official: 'official_page',
    city_page: 'official_page',
    official_venue_or_government: 'official_page',   // Spokane
    // Scranton. "official OR maintained" is ambiguous: a maintained source can be a third-party
    // directory, which is not an official page. Takes the weaker true claim, same reasoning as the
    // generation-B/C address_source default.
    official_or_maintained_source: 'manual_research',   // Scranton
    osm: 'osm',
    openstreetmap: 'osm',
    county_open_data: 'county_open_data',
    manual_research: 'manual_research',
    // ADR-14: an aggregator-sourced address files as manual_research — address_source has no
    // aggregator value and must not gain one.
    aggregator: 'manual_research',
    organizer: 'organizer',
    club: 'organizer',
    unknown_legacy: 'unknown_legacy',
    unknown: 'unknown_legacy',
  },
  research_status: {
    verified: 'verified',
    probable: 'probable',
    pending: 'pending',
    held: 'held',
    unresolved: 'unresolved',
    unresolved_unnamed: 'unresolved_unnamed',
    duplicate: 'duplicate',
    not_venue: 'not_venue',
    not_pickleball: 'not_pickleball',
    published: 'published',
    // `provisional` is explicitly NOT a valid status (ADR-14); `probable` is the value that means
    // "believed real, not confirmed".
    provisional: 'probable',
    // ---- generation B, 2026-07-31 (owner ruling) --------------------------------------------
    // Generation-B workbooks have NO research_status column. They have `status`, whose only observed
    // value is `active` — a record-state flag, not an evidence claim. Mapping it to `verified`
    // wholesale would let 8 metros bypass the ADR-14 evidence bar in one line, so the branch is
    // decided per row from the evidence the row actually carries:
    //   -> verified  when at least one NON-AGGREGATOR (controlling-entity) source URL is present
    //   -> probable  otherwise — including when the row cites nothing at all
    // This is a second, independent enforcement of the same rule the aggregator-only downgrade below
    // applies; the two agree by construction and neither is load-bearing alone. When in doubt the
    // answer is `probable`: the publish gate holds it, and promotion later is a one-field update.
    // Generation B's workbooks disagree on the record-state token: Modesto writes `active`, Port St.
    // Lucie writes `draft` (the facility_listings lifecycle value — every row reads `draft` because
    // none has been imported yet). NEITHER is an evidence claim, so both route through the SAME
    // resolver and the evidence bar is identical. One rule, two spellings.
    //
    // EXTENSION FLAG: the owner's ruling named `active`. `draft` is applied here on the ruling's own
    // stated rationale ("status was never an evidence claim; do not treat it as one") and it cannot
    // weaken the bar, because the bar is the controlling-entity-URL test below, unchanged. Reversible
    // in one line if the owner wants `draft` treated differently.
    active: (ctx) => recordStateStatus('active', ctx),
    draft: (ctx) => recordStateStatus('draft', ctx),
    draft_only: (ctx) => recordStateStatus('draft_only', ctx),   // Chattanooga (import_state column)
  },
  confidence: { high: 'high', medium: 'medium', med: 'medium', low: 'low' },
}

// =============================================================================================
// COLUMN ALIASES — the 29 workbooks are NOT one template. Every one surveyed has a different
// column layout for the same fields. These are pure synonym renames (same field, different label),
// NOT value mappings: recognizing that `postal_code` and `zip` are the same column is not the same
// kind of judgment as deciding what `paid` means, so it is safe to do globally. Anything genuinely
// ambiguous belongs in a per-metro `workbook.aliases` override in the metro config instead.
// =============================================================================================
export const COLUMN_ALIASES = {
  postal_code: 'zip', zip_code: 'zip', zipcode: 'zip',
  street_address: 'address', address_1: 'address', street: 'address',
  venue_name: 'name', facility_name: 'name',
  setting: 'indoor_outdoor', court_setting: 'indoor_outdoor',
  // `source_url` is the venue's website column on a PRIMARY tab (the only URL column madison,
  // melbourne, syracuse and winston-salem have) and the per-field CITATION column on an EVIDENCE
  // tab. This entry is correct for the first and wrong for the second, so the evidence tab pins it
  // back to itself — see EVIDENCE_ALIASES. Do not remove it here; 102 venues lose `website` if you do.
  website_url: 'website', url: 'website', source_url: 'website', provenance_url: 'website',
  reservations: 'reservation_required',
  latitude: 'lat', longitude: 'lng',
  venue_key: 'research_key',
  pickleball_courts: 'court_count',   // Melbourne
}

// =============================================================================================
// URL COLUMN ROLES
//
// Two columns on one tab can both look like "the URL", and they are TWO DIFFERENT FACTS:
//   · the venue's or operator's OWN SITE — what a reader clicks to visit the venue; and
//   · the CITATION that established the venue's identity — the evidence trail.
// COLUMN_ALIASES canonicalizes several spellings onto `website`, so a workbook carrying both
// lands them on one key, and tabToRows lets the LATER sheet column win — silently destroying the
// earlier one, and letting a BLANK cell overwrite a real URL. Ogden's two columns genuinely
// differ on 14 of its 31 rows, so which one wins is a real decision, not a tie.
//
// OWNER RULING 2026-08-01: both facts survive. Where a dedicated website column exists it wins
// `website`; a `source_url` column alongside it maps to `name_source_url`. Neither cross-fills
// the other — a populated column stands for its own field and the other stays null, because
// filling one from the other would assert a claim the workbook never made, in exactly the case
// where a researcher left a cell blank on purpose.
//
// THIS TABLE IS READ ONLY WHEN A COLLISION EXISTS (>=2 raw headers on one tab canonicalizing to
// `website`). A workbook with a single URL column is therefore unaffected BY CONSTRUCTION, not by
// a promise re-verified each run: madison (48 rows), melbourne (15), syracuse (15) and
// winston-salem (24) carry `source_url` as their ONLY URL column, and it must keep meaning
// `website` for those 102 venues. Same for pensacola (`provenance_url`), spokane
// (`primary_source_url`), lancaster (`name_source_url`) and portland-me (`verified_source_url`).
// =============================================================================================
export const URL_COLUMN_ROLE = {
  website: 'website', website_url: 'website', url: 'website',
  source_url: 'citation', provenance_url: 'citation', name_source_url: 'citation',
  primary_source_url: 'citation', verified_source_url: 'citation',
}

/**
 * Splits a `website` header collision into website + name_source_url, in place on `headers`.
 * Returns a description of what it did, or null when nothing collided (the common case).
 *
 * EVERY FAILURE ABORTS rather than picking a winner. This defect existed precisely because a
 * collision resolved quietly; a rule that resolves an *ambiguous* collision quietly would be the
 * same defect with a better name. Same posture as the research_status duplicate-header guard,
 * which this generalizes.
 */
function resolveUrlColumns(rawKeys, headers, tabLabel) {
  const collided = headers.map((h, i) => (h === 'website' ? i : -1)).filter((i) => i >= 0)
  if (collided.length < 2) return null

  const roleOf = (i) => URL_COLUMN_ROLE[rawKeys[i]] ?? null
  const named = (idx) => idx.map((i) => `"${rawKeys[i]}"`).join(', ') || 'none'

  const undeclared = collided.filter((i) => !roleOf(i))
  if (undeclared.length) {
    throw new Error(`${tabLabel}: ${collided.length} columns resolve to "website" (${named(collided)}) and ${named(undeclared)} has no declared role in URL_COLUMN_ROLE, so sheet column order would silently decide which URL a reader sees. Declare the role, or disambiguate with a per-metro "workbook.aliases" override.`)
  }
  const sites = collided.filter((i) => roleOf(i) === 'website')
  const cites = collided.filter((i) => roleOf(i) === 'citation')
  if (sites.length !== 1 || cites.length !== 1) {
    throw new Error(`${tabLabel}: cannot split the "website" collision — ${sites.length} website column(s) (${named(sites)}) and ${cites.length} citation column(s) (${named(cites)}). Exactly one of each is resolvable; anything else needs a per-metro "workbook.aliases" override.`)
  }
  if (headers.some((h, i) => h === 'name_source_url' && !collided.includes(i))) {
    throw new Error(`${tabLabel}: this tab already has its own "name_source_url" column, so re-pointing "${rawKeys[cites[0]]}" onto it would just repeat the collision one column over. Disambiguate with a per-metro "workbook.aliases" override.`)
  }

  headers[cites[0]] = 'name_source_url'
  return {
    tab: tabLabel,
    website_column: rawKeys[sites[0]],
    citation_column: rawKeys[cites[0]],
    reason: `both columns canonicalize to "website", so the later one won and destroyed the earlier (and a blank cell could overwrite a real URL). "${rawKeys[sites[0]]}" now feeds the user-facing website column; "${rawKeys[cites[0]]}" feeds name_source_url. Neither cross-fills the other.`,
  }
}

// =============================================================================================
// WORKBOOK GENERATIONS
//
// The 29 research workbooks are not one template; they are THREE, and the difference is structural
// rather than cosmetic — different tab names, a different primary tab, and in generation B's case a
// different way of stating research status altogether. Hand-writing nine alias maps would encode
// that structure nine times and get it subtly wrong somewhere, so each generation is declared ONCE
// here and selected by which primary tab the dump actually contains.
//
//   A  nine-stage      Import Ready / Venues / Evidence            20 metros (already imported/projected)
//   B  dry-run         Import Dry Run / Reviewed Venues / Field Evidence   8 metros
//   C  stage-9 (ME)    Import Candidates / Field Evidence          Portland ME only
//
// GENERATION A'S ENTRY MUST REPRODUCE THE PRE-ADAPTER BEHAVIOUR EXACTLY. That is asserted mechanically
// by rebuilding all 20 generation-A artifacts and requiring a zero-byte diff, which is what keeps this
// refactor from being a 20-metro data change wearing a refactor's clothes.
//
// `aliases` here are generation-SCOPED, deliberately. `status -> research_status` is right for
// generation B and would be wrong globally (generation A's `status`/`record_state` columns mean other
// things), so it must never reach COLUMN_ALIASES.
// =============================================================================================
export const GENERATIONS = {
  A: {
    id: 'A',
    label: 'nine-stage (Import Ready / Venues / Evidence)',
    primary_tab: 'Import Ready',
    venues_tab: 'Venues',
    evidence_tab: 'Evidence',
    aliases: {},
    // Ordered: the first non-blank wins. Generation A has exactly one, which is what the code did
    // before this table existed.
    source_url_columns: ['website'],
    // Generation A carries `indoor` and `lighting` TRUE/FALSE columns. Declared here as of the
    // 2026-08-01 slice; before that they were read by nothing and the fact was discarded on every
    // nine-stage batch.
    //
    // DECLARED IS NOT READ. Only 3 of the 20 generation-A workbooks actually have an `indoor` column
    // (des-moines, durham, lancaster) and 12 have a `lighting` column, so extractWorkbook
    // PRESENCE-GATES this map against the parsed headers before reading anything. Without that gate
    // every generation-A venue would gain a `lighting` node carrying a `source_url` for a column its
    // workbook never had — a fabricated provenance claim, not a cosmetic diff.
    boolean_columns: { indoor: 'indoor', lighting: 'lighting' },
    // Which parsed row the (never-authoritative) workbook coordinate cross-check is read from.
    coordinate_row: 'venues',
    address_source_default: null,
    metro_area_column: null,
    pickleball_confidence_column: null,
  },
  B: {
    id: 'B',
    label: 'dry-run (Import Dry Run / Reviewed Venues / Field Evidence)',
    primary_tab: 'Import Dry Run',
    venues_tab: 'Reviewed Venues',
    evidence_tab: 'Field Evidence',
    // `status` holds a record-state flag (`active`), NOT an evidence claim. It is aliased onto
    // research_status so it runs through the conditional resolver in MAPPINGS.research_status, which
    // is where the ADR-14 evidence bar is actually applied. See that entry.
    // The record-state column is spelled differently across this generation: Modesto/Port St. Lucie
    // write `status`, Chattanooga writes `import_state`. Neither is an evidence claim; both route
    // through the resolver in MAPPINGS.research_status. They have not been observed together, and if
    // they ever are, the duplicate-header guard aborts rather than letting column order pick silently.
    aliases: { status: 'research_status', import_state: 'research_status' },
    // `website` and `name_source_url` BOTH exist as columns, and Modesto carries the URL only in the
    // second. This is an ordered fallback rather than an alias precisely because an alias would let
    // whichever column comes last in the sheet overwrite the other — including overwriting a real
    // URL with an empty cell.
    source_url_columns: ['website', 'name_source_url'],
    boolean_columns: { indoor: 'indoor', lighting: 'lighting' },
    // Generation B carries lat/lng on the primary tab itself. Cross-check only — never a source.
    coordinate_row: 'primary',
    // No address_source column exists in this generation. `manual_research` is the honest cell: the
    // address came from directory research. `official_page` would assert we took it off the
    // controlling entity's own page, which the workbook nowhere states (ADR-12 pinned this vocabulary
    // so a source claim means something). A per-row signal, if one ever appears, still wins.
    address_source_default: 'manual_research',
    metro_area_column: 'metro_area',
    pickleball_confidence_column: null,
  },
  C: {
    id: 'C',
    label: 'stage-9 (Import Candidates / Field Evidence)',
    primary_tab: 'Import Candidates',
    venues_tab: null,
    evidence_tab: 'Field Evidence',
    // `reviewer_notes` is routed to provenance_note, NOT to public_notes. It is internal reviewer
    // commentary and public_notes renders on the venue page — that is the line between a directory
    // and a leaked worksheet. provenance is never rendered, so nothing is lost and nothing leaks.
    aliases: { identity_confidence: 'confidence', reviewer_notes: 'provenance_note' },
    source_url_columns: ['verified_source_url', 'website'],
    boolean_columns: {},
    coordinate_row: 'primary',
    address_source_default: 'manual_research',
    metro_area_column: 'metro_area',
    pickleball_confidence_column: 'pickleball_confidence',
    // WHOLE-COLUMN MISLABEL (owner ruling 2026-07-31). Generation C's `line_type` column holds
    // `dedicated`/`shared` on every row — court_configuration vocabulary — and the generation has no
    // court_configuration column at all. Reading that column as court_configuration is reading it
    // CORRECTLY, not relocating a value: the defect is systematic across every row AND the correct
    // column is absent, which is precisely what distinguishes it from the per-cell contamination that
    // ruling 2 governs. Both conditions are VERIFIED against the data before the alias is applied
    // (see verifyWholeColumnAlias); if either fails the alias is withheld and the values fall through
    // to the ordinary contamination path — nulled and flagged, never relocated.
    conditional_aliases: [{
      from: 'line_type',
      to: 'court_configuration',
      reason: 'generation C has no court_configuration column and every line_type cell holds court_configuration vocabulary (dedicated/shared) — a whole-column mislabel, not per-cell contamination',
    }],
  },
}

/** Picks the generation from the tabs actually present. A config may pin it with workbook.generation. */
export function detectGeneration(tabs, forced = null) {
  if (forced) {
    const g = GENERATIONS[forced]
    if (!g) throw new Error(`workbook.generation "${forced}" is not one of ${Object.keys(GENERATIONS).join('/')}`)
    if (!tabs[g.primary_tab]) throw new Error(`workbook.generation is pinned to "${forced}" but the dump has no "${g.primary_tab}" tab (tabs: ${Object.keys(tabs).join(', ')})`)
    return g
  }
  const hits = Object.values(GENERATIONS).filter((g) => Array.isArray(tabs[g.primary_tab]) && tabs[g.primary_tab].length)
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) {
    throw new Error(`ambiguous workbook generation — the dump contains more than one primary tab (${hits.map((g) => `${g.id}:"${g.primary_tab}"`).join(', ')}). Pin it with "workbook": { "generation": "A" } in the metro config.`)
  }
  throw new Error(`no known primary tab in the dump (looked for ${Object.values(GENERATIONS).map((g) => `"${g.primary_tab}"`).join(', ')}; got ${Object.keys(tabs).join(', ')})`)
}

/**
 * A workbook may file its venue table under a tab other than its generation's default.
 *
 * Huntsville (generation B) puts the venue table on "Reviewed Venues" and uses "Import Dry Run" for
 * a per-row SIMULATION LOG — research_key / name / simulation_action / target_table /
 * blocking_issue / dry_run_status — which carries no venue facts at all. Reading that log as the
 * primary tab does NOT abort, which is what makes it dangerous: it yields 30 venues with no address,
 * no public_notes and no source URL, and it lets research_status='verified' through completely
 * untested, because the ADR-14 aggregator check needs a URL in order to have anything to test. That
 * is precisely the bypass the evidence bar exists to prevent. So the tab ROLES are overridable per
 * metro, the same way `workbook.aliases` overrides column names.
 *
 * Two guards keep this from rotting into a silencer:
 *   1. a named tab that is not a non-empty array in the dump ABORTS — a stale override must never
 *      fall back silently to the generation default (mirrors the `exclude` / `same_site_pairs`
 *      staleness guards in the importer);
 *   2. the override is recorded in provenance via the workbook_adapter node, so which tab was read
 *      is auditable after the fact rather than implied.
 *
 * Absent from the config this is a no-op returning the generation entry unchanged, which is what
 * keeps every already-projected metro byte-identical.
 */
export function applyTabOverrides(gen, override, tabs) {
  if (!override) return gen
  const ROLES = { primary: 'primary_tab', venues: 'venues_tab', evidence: 'evidence_tab' }
  const out = { ...gen }
  const applied = []
  for (const [role, key] of Object.entries(ROLES)) {
    if (!Object.prototype.hasOwnProperty.call(override, role)) continue
    const name = override[role]
    if (name === null) {
      applied.push(`${role}: "${gen[key] ?? '—'}" -> none`)
      out[key] = null
      continue
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`workbook.tabs.${role} must be a tab name or null, got ${JSON.stringify(name)}`)
    }
    if (!Array.isArray(tabs[name]) || !tabs[name].length) {
      throw new Error(`workbook.tabs.${role} = "${name}" is not a non-empty tab in this dump (tabs: ${Object.keys(tabs).join(', ')}). A stale tab override ABORTS rather than silently falling back to generation ${gen.id}'s default "${gen[key]}".`)
    }
    applied.push(`${role}: "${gen[key] ?? '—'}" -> "${name}"`)
    out[key] = name
  }
  if (applied.length) out.tab_overrides = applied
  return out
}

/**
 * Lets ONE metro supply the address_source fallback its own workbook cannot, without moving the
 * generation's default underneath every other metro that shares it.
 *
 * WHY THIS IS PER-METRO AND NOT A GENERATION CHANGE. Generations B and C already declare
 * `address_source_default: 'manual_research'`, on the reasoning recorded at those entries: when a
 * workbook does not say where an address came from, `manual_research` is the weaker TRUE claim, and
 * `official_page` would assert the address was taken off the controlling entity's own page — which
 * the workbook nowhere states. Generation A deliberately declares `null` because its workbooks
 * normally DO carry the column, and its entry must reproduce pre-adapter behaviour exactly (asserted
 * by a zero-byte diff across all 20 generation-A artifacts). Flipping generation A's default would
 * therefore silently restate the provenance of every generation-A row whose cell is blank, in 20
 * already-projected metros, to make two new ones pass. That is the wrong blast radius, so the
 * override is scoped to the config that needs it and every other metro is untouched BY CONSTRUCTION.
 *
 * The value is validated against the live CHECK vocabulary — a typo here would otherwise reach the
 * database as a silent null via the same path this exists to fill.
 */
export function applyAddressSourceDefault(gen, value) {
  if (value === undefined || value === null) return gen
  if (!LIVE.address_source.has(value)) {
    throw new Error(`workbook.address_source_default "${value}" is not live address_source vocabulary (one of ${[...LIVE.address_source].join(', ')})`)
  }
  return { ...gen, address_source_default: value, address_source_default_from_config: true }
}

/**
 * Proves the two preconditions the whole-column-alias ruling requires, against the real data:
 *   1. the destination column genuinely does NOT exist in this workbook, and
 *   2. EVERY non-blank cell in the source column is valid vocabulary for the destination.
 * Returns { ok, reason, checked }. A single row that fails condition 2 withholds the alias for the
 * whole column — because one bad cell means the column is not systematically mislabelled, it is
 * contaminated, and contamination is nulled-and-flagged rather than relocated.
 */
export function verifyWholeColumnAlias(parsed, { from, to }) {
  const headers = parsed.headers || []
  if (headers.includes(to)) return { ok: false, checked: true, reason: `destination column "${to}" already exists in this workbook, so "${from}" is not standing in for it — this is per-cell contamination, not a whole-column mislabel` }
  if (!headers.includes(from)) return { ok: false, checked: false, reason: `source column "${from}" is not present in this workbook` }
  const table = MAPPINGS[to] || {}
  const bad = []
  let nonBlank = 0
  for (const r of parsed.rows) {
    const raw = r[from]
    if (blank(raw)) continue
    nonBlank++
    if (!Object.prototype.hasOwnProperty.call(table, normKey(raw))) bad.push(`${r.research_key || r.venue_key || `row ${r._rowNumber}`}="${String(raw).trim()}"`)
  }
  if (!nonBlank) return { ok: false, checked: true, reason: `column "${from}" is entirely blank — nothing to re-read` }
  if (bad.length) return { ok: false, checked: true, reason: `${bad.length} of ${nonBlank} non-blank "${from}" cells are NOT ${to} vocabulary (${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', …' : ''}) — not a systematic mislabel, so the alias is withheld and these fall through to the contamination path` }
  return { ok: true, checked: true, reason: `all ${nonBlank} non-blank "${from}" cells are valid ${to} vocabulary and no "${to}" column exists` }
}

/**
 * A value that is genuinely UNREPRESENTABLE in a boolean is not the same thing as an unrecognized
 * one. A venue that is both indoor and outdoor cannot be written as true or false without asserting
 * a false half-truth — and MAPPINGS.indoor_outdoor ALREADY makes exactly this call for the
 * enum-shaped form of the very same column (`mixed: null`, `both: null`, `indoor_outdoor: null`,
 * `unknown: null`). This set applies that existing decision to the boolean-shaped form of the
 * column; it is not a new judgment. The raw string is kept in provenance and the row is reported in
 * extraction_notes, so nothing is deleted — the column simply declines to assert.
 *
 * Everything still unrecognized ABORTS, which is what keeps this from becoming a catch-all.
 */
const UNREPRESENTABLE_BOOLEAN = new Set(['mixed', 'both', 'indoor_outdoor', 'indoor_and_outdoor', 'indoor_outdoor_mixed', 'unknown'])

/**
 * PER-FIELD single-token extensions to the boolean vocabulary.
 *
 * Deliberately keyed by field rather than global: `lighted` means true in a `lighting` column and
 * means nothing at all in an `indoor` one, and a global true-set would happily resolve
 * `indoor="lighted"`. Same reasoning that keeps `reservation_policy` and `reservation_required` in
 * separate mapping tables.
 *
 * `qualifier: true` marks a value the boolean CANNOT fully express. The column still answers its own
 * question — `facility_listings.lighting` asks "does this venue have lighting", and
 * app/courts/[slug]/page.tsx renders a bare "Lighting" chip on `=== true` — but a flat chip would
 * overstate "partial". So the raw string is ALSO appended verbatim to public_notes, exactly as the
 * PROSE_RULES path does, and the page carries the qualifier next to the chip instead of a reader
 * turning up at night to find four of twelve courts lit.
 */
const BOOLEAN_TOKENS = {
  lighting: {
    // Augusta (4) + Durham (4). An affirmative statement in the column's own vocabulary: the venue
    // is lit. Nothing is lost, so it is not a qualifier.
    lighted: { value: true, branch: 'token_lighted', reason: '"lighted" is an affirmative statement in this column\'s own vocabulary — the venue has lighting' },
    // Durham (Duke East Campus). Partial lighting IS lighting, so the existence question the column
    // asks is answered `true`; what the boolean cannot carry is WHICH courts, so the raw is
    // preserved in public_notes and provenance rather than the fact being discarded.
    partial: { value: true, qualifier: true, branch: 'token_partial', reason: '"partial" states that lighting exists but not everywhere — the column asks whether the venue HAS lighting, so it resolves true, and the qualifier is preserved verbatim in public_notes so the chip is not read as "every court is lit"' },
  },
}

/**
 * PROSE in a boolean column, same shape and same discipline as PROSE_RULES. Only multi-token values
 * reach here (see isProse), so a single unrecognized token still ABORTS and this never becomes a
 * catch-all. Observed: Durham's "4 courts lighted" and "outdoor courts lighted".
 */
const BOOLEAN_PROSE = {
  lighting: [
    { test: /\blight(?:ed|ing|s)\b/i, value: true, qualifier: true, branch: 'prose_lighted', reason: 'the prose names lighting outright, so the venue has lighting; the count/scope it also carries is not representable in a boolean and is preserved verbatim' },
  ],
}

/**
 * Reads a TRUE/FALSE workbook column. A blank cell is NOT false — it means the research did not
 * establish the fact — so it maps to null. An unrecognized token ABORTS, exactly like an unmapped
 * enum: a silently-nulled boolean is a fact quietly deleted.
 *
 * The ladder mirrors mapEnum's exactly, and for the same reasons:
 *   1-2 canonical boolean tokens          3   UNREPRESENTABLE_BOOLEAN (mixed/both/...)
 *   4   own-column vocabulary extension   5   CONTAMINATION — valid vocabulary for a DIFFERENT column
 *   6   prose                             7   genuine gap -> abort
 *
 * Own-column BEFORE contamination is what stops a token that is legitimate here from being claimed
 * by another column's vocabulary — the standing "a token meaningful in two columns must be mapped in
 * BOTH" rule, applied to the boolean shape.
 *
 * Steps 4-6 are reachable ONLY by values that previously aborted, so they are a no-op on every
 * already-extracted metro by construction.
 */
export function readBoolean(field, raw, unmapped, key) {
  if (blank(raw)) return { value: null, raw: null }
  const nk = normKey(raw)
  const rawStr = String(raw).trim()
  if (['true', 'yes', 'y', '1', 't'].includes(nk)) return { value: true, raw: rawStr }
  if (['false', 'no', 'n', '0', 'f'].includes(nk)) return { value: false, raw: rawStr }
  if (UNREPRESENTABLE_BOOLEAN.has(nk)) return { value: null, raw: rawStr, unrepresentable: true }

  const own = BOOLEAN_TOKENS[field]
  if (own && Object.prototype.hasOwnProperty.call(own, nk)) {
    const e = own[nk]
    return {
      value: e.value, raw: rawStr, branch: e.branch, branch_reason: e.reason,
      qualifier: e.qualifier ? { field, raw: rawStr, resolved: e.value, branch: e.branch, reason: e.reason } : null,
    }
  }

  // The value is invalid here but IS legitimate vocabulary for another column — a workbook bug, not
  // a mapping gap. Null the field and flag it; NEVER relocate the value (ruling 2). Augusta's
  // lighting="permanent" is the documented one-column-left shift and Wichita's lighting="temporary"
  // sits on five indoor gyms; both are line_type/net_setup vocabulary and contaminationOwners finds
  // them with no new table.
  const owners = contaminationOwners(field, raw)
  if (owners) {
    return {
      value: null, raw: rawStr,
      contamination: { field, raw: rawStr, belongs_to: owners },
      branch: 'contaminated',
      branch_reason: `"${rawStr}" is not a boolean but IS valid vocabulary for ${owners.join('/')} — workbook column contamination. Field nulled; value NOT relocated.`,
    }
  }

  if (isProse(raw) && BOOLEAN_PROSE[field]) {
    const hit = BOOLEAN_PROSE[field].find((r) => r.test.test(rawStr))
    if (hit) {
      return {
        value: hit.value, raw: rawStr, branch: hit.branch,
        branch_reason: `prose "${rawStr}" unambiguously implies ${field}=${hit.value}; original preserved verbatim`,
        qualifier: hit.qualifier ? { field, raw: rawStr, resolved: hit.value, branch: hit.branch, reason: hit.reason } : null,
      }
    }
  }

  unmapped.push(`${key}: ${field} = "${rawStr}" is not a recognizable boolean (expected TRUE/FALSE/yes/no)`)
  return { value: null, raw: rawStr }
}

// =============================================================================================
// PROSE RULES (owner ruling 2026-07-31)
//
// Some workbooks put a sentence where the schema wants an enum:
//   Jackson   fee_type           "Free / rentals and programs may vary"
//   Madison   fee_type           "free / reservation fee may apply"
//   Durham    reservation_policy "mixed: open play + reservable"
//   Melbourne reservation_policy "Indoor drop-in; outdoor reservable"
//
// The rule, in order:
//   1. If the prose unambiguously implies exactly ONE schema value, take it.
//   2. If it describes genuinely mixed or conditional state, the value is `unknown`.
//   3. In BOTH cases the original prose is preserved verbatim — appended to public_notes and
//      recorded in provenance.fields.<field>.workbook_raw. We lose no information; we decline to
//      assert a precise value we do not have.
//
// A prose value is one that is not in the mapping table AND is not a single token. A single
// unrecognized token is a mapping gap and still ABORTS — prose handling must never become a
// catch-all that swallows genuinely unknown vocabulary.
// =============================================================================================
export const PROSE_RULES = {
  fee_type: [
    // "Free / rentals may vary", "free / reservation fee may apply" — the base access is free and
    // the caveat is a qualifier on ancillary services, not a contradiction of it.
    { test: /^\s*free\b/i, value: 'free', branch: 'prose_free_base' },
  ],
  reservation_policy: [
    // Fayetteville "reservations available". Not mixed or conditional — it states plainly that
    // reservations exist and are not required, which is exactly what reservation_recommended means
    // (and what the already-mapped singular `reservation_available` token resolves to). Anchored so
    // it cannot swallow the genuinely mixed cases like "first-come / programs".
    { test: /^\s*reservations?\s+available\s*$/i, value: 'reservation_recommended', branch: 'prose_reservation_available' },
  ],
  access_type: [
    // Fayetteville "private HOA" (Bella Vista POA venues). `hoa` is a live value and the prose names
    // it outright, so this is ruling-1 branch 1: take the value rather than resting at unknown.
    { test: /\bhoa\b/i, value: 'hoa', branch: 'prose_hoa' },
  ],
  court_configuration: [
    // ORDER MATTERS. A count-plus-count or semicolon-joined description is genuinely mixed, and
    // `mixed` is a real schema value — test it before the shared/hybrid keywords, because
    // "6 dedicated + 2 hybrid" contains "hybrid" and would otherwise read as purely shared.
    //
    // `[\w\s]+` rather than `\w+` (fixed 2026-08-01): the single-word form required <count> <ONE
    // word> `+`, so "3 indoor shared + 4 dedicated outdoor" fell straight past this rule to the
    // shared/gym keyword rule below and resolved `shared_multi_use` — the exact miss the ORDER
    // MATTERS comment above says this rule exists to prevent. The description names two different
    // configurations joined by `+`; that is `mixed`, and the count of words between the number and
    // the plus sign was never the thing that made it so.
    { test: /(\d+\s*[\w\s]+\s*\+)|;|\band\s+\d+/i, value: 'mixed', branch: 'prose_mixed_counts' },
    { test: /^\s*pickleball[- ]only/i, value: 'dedicated', branch: 'prose_pickleball_only' },
    { test: /shared|tennis|gym|hybrid|multi/i, value: 'shared_multi_use', branch: 'prose_shared' },
  ],
  net_setup: [
    // "permanent/tennis" names two different real values — ambiguous, so it rests at unknown.
    { test: /permanent\s*\/\s*tennis/i, value: 'unknown', branch: 'prose_ambiguous_two_values' },
    // Modesto "portable available". Ruling-1 branch 1: the prose names exactly one live value —
    // portable nets exist at the venue — which is the same claim the already-mapped single tokens
    // `portable` and `provided` make. Anchored at the start so it cannot swallow a two-value phrase.
    { test: /^\s*portable\b/i, value: 'portable_provided', branch: 'prose_portable_available' },
    { test: /tennis/i, value: 'shared_tennis_net', branch: 'prose_tennis_net' },
  ],
  // `surface` has NO 'unknown' in its CHECK set but IS nullable, and every observed generation-A case
  // names two materials ("wood/tile", "hard/concrete"). Asserting either would invent specificity the
  // source does not have, so that shape falls to null with the raw string kept — the same call the
  // Greensboro batch made for "gym floor"/"multi-sport".
  surface: [
    // Generation B fuses the SETTING and the MATERIAL into one cell: "outdoor hard",
    // "outdoor asphalt", "indoor wood". Only the material half is representable in `surface`.
    //
    // The material is resolved back through MAPPINGS.surface rather than written here, so there is
    // exactly one material vocabulary and a material this project has never seen ABORTS instead of
    // silently nulling (the resolver returns undefined and mapEnum treats that as a mapping gap).
    //
    // The setting half is NOT discarded and is NOT relocated into `indoor`: generation B carries its
    // own `indoor` boolean, and the prefix is used only to CROSS-CHECK it. A disagreement is
    // reported, never silently resolved. Where the boolean is blank the prefix stays a cross-check
    // observation and `indoor` remains null — filling one column from another column's cell is the
    // inference ruling 2 exists to prevent.
    {
      test: /^\s*(?:in|out)door\s+.+$/i,
      value: (raw) => {
        const nk = normKey(String(raw).trim().replace(/^\s*(?:in|out)door\s+/i, ''))
        return Object.prototype.hasOwnProperty.call(MAPPINGS.surface, nk) ? MAPPINGS.surface[nk] : undefined
      },
      branch: 'prose_setting_plus_material',
    },
  ],
}

/** The setting half of a fused "<setting> <material>" surface cell, or null when there isn't one.
 *  Cross-check input only — never a source for the `indoor` column. */
export function settingPrefixOf(raw) {
  const m = String(raw ?? '').trim().match(/^(in|out)door\b/i)
  return m ? m[1].toLowerCase() === 'in' : null
}
const PROSE_FALLBACK = {
  fee_type: 'unknown', reservation_policy: 'unknown', access_type: 'unknown',
  court_configuration: 'unknown', net_setup: 'unknown', surface: null,
}

const isProse = (raw) => /[\s/;:,+]/.test(String(raw ?? '').trim())

/**
 * CONTAMINATION INDEX — value -> the set of fields for which that value is legitimate vocabulary.
 * Built from both the live CHECK sets and every mapping table, so it covers workbook vocabulary as
 * well as schema vocabulary.
 *
 * This is what makes contamination detection MECHANICAL rather than per-metro hand-coding: a value
 * that is invalid for its own column but IS valid vocabulary for a different column is a workbook
 * bug (the value is in the wrong column), not a gap in our mapping table. That distinction matters
 * enormously, because a contaminated value looks individually valid and would sail through a naive
 * `if (!SET.has(v))` check against the wrong vocabulary, writing a real-but-wrong fact.
 * Observed: Des Moines fee_type="shared-use", Akron court_configuration="scheduled",
 * Portland ME line_type="dedicated".
 */
// Built lazily: normKey is declared further down and would be in its temporal dead zone if this
// were an IIFE evaluated at module load.
let _contaminationIndex = null
function contaminationIndex() {
  if (_contaminationIndex) return _contaminationIndex
  const idx = {}
  const add = (v, field) => {
    const k = normKey(v)
    if (!k) return
    ;(idx[k] ||= new Set()).add(field)
  }
  for (const [field, set] of Object.entries(LIVE)) for (const v of set) add(v, field)
  for (const [field, table] of Object.entries(MAPPINGS)) for (const k of Object.keys(table)) add(k, field)
  _contaminationIndex = idx
  return idx
}

/** Fields whose value belongs to another column entirely. Returns the owning fields, or null. */
function contaminationOwners(field, raw) {
  // A URL is never valid enum vocabulary for any column, so it cannot be found by the value index —
  // but it is unmistakably contamination rather than a mapping gap. Des Moines carries
  // `net_setup = "https://www.dsm.city/..."` on 4 rows; without this the run aborts as if the
  // mapping table were incomplete, which would be the wrong diagnosis and the wrong fix.
  if (/^https?:\/\//i.test(String(raw ?? '').trim()) && field !== 'website') return ['website']
  const owners = contaminationIndex()[normKey(raw)]
  if (!owners) return null
  const others = [...owners].filter((f) => f !== field)
  return others.length ? others : null
}

/** ADR-14 tier-4 aggregator hosts. Permitted as a private research input and as evidence; never a
 *  sole basis for `verified`, and never rendered on a Joinzer page. */
export const AGGREGATOR_HOST = /pickleheads|places2play|playpickleball|55places|maptons|pickleballunited|goodrun|pickleballcourt\.directory|playtimescheduler|mysaline|pickleballbrackets|globalpickleball/i

/** A document rather than a venue site: a PDF/office file, or a CivicPlus/Granicus document
 *  endpoint (agenda, minutes, alert archive, uploaded file).
 *
 *  This is the same error as putting an aggregator in `website` — a CITATION in the visitor-facing
 *  column — and URL_COLUMN_ROLE already draws that line. A meeting-minutes PDF is perfectly good
 *  evidence and belongs in a citation column; it is never the venue's website.
 *
 *  Matches on URL SHAPE, deliberately. The 2026-08-03 sweep flagged a document only when the page
 *  lacked venue vocabulary, so a PDF full of "park" and "recreation" passed as fine and seven bad
 *  rows survived — they were found afterwards by a pattern over the column. Content heuristics are
 *  not a substitute for checking the shape. */
export const DOCUMENT_URL = /\.(?:pdf|docx?|xlsx?|pptx?)(?:$|[?#])|\/(?:AgendaCenter|DocumentCenter|ShowDocument|ViewFile|Archive\.aspx|CivicAlerts\.asp)|\/(?:agenda|minutes|uploads)\//i

// =============================================================================================
// Small helpers
// =============================================================================================
const normKey = (v) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const blank = (v) => v == null || String(v).trim() === ''
const orNull = (v) => (blank(v) ? null : String(v).trim())

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The directory's slug convention, shared by all currently published rows: `<name>-<city>-<state>`. */
export function directorySlug({ name, city, state }) {
  return [slugify(name), slugify(city), String(state || '').toLowerCase()].filter(Boolean).join('-')
}

/**
 * Applies one mapping. Returns { value, raw, mapped } or throws an Unmapped marker the caller
 * collects — never returns a silent null for an unrecognized value.
 */
function mapEnum(field, raw, unmapped, key, ctx = {}) {
  if (blank(raw)) return { value: null, raw: null, mapped: false }
  const table = MAPPINGS[field]
  const nk = normKey(raw)
  const rawStr = String(raw).trim()

  if (!Object.prototype.hasOwnProperty.call(table, nk)) {
    // Path 1 — CONTAMINATION: the value is invalid here but is legitimate vocabulary for another
    // column, so it is a workbook bug, not a mapping gap. Null the field and flag it. Do NOT
    // relocate the value to the column it appears to belong to — that is inference, and inference
    // is what produces confident wrong facts. A missing fee_type is a gap; a wrong one is a lie.
    const owners = contaminationOwners(field, raw)
    if (owners) {
      return {
        value: null, raw: rawStr, mapped: false, changed: true,
        contamination: { field, raw: rawStr, belongs_to: owners },
        branch: 'contaminated',
        branch_reason: `"${rawStr}" is not valid for ${field} but IS valid vocabulary for ${owners.join('/')} — workbook column contamination. Field nulled; value NOT relocated.`,
      }
    }
    // Path 2 — PROSE: a sentence where the schema wants an enum. Resolved by PROSE_RULES, with the
    // original text preserved verbatim. Only multi-token values qualify; a single unrecognized
    // token stays an abort so this never becomes a catch-all for unknown vocabulary.
    if (isProse(raw) && PROSE_RULES[field]) {
      const hit = PROSE_RULES[field].find((r) => r.test.test(rawStr))
      // A rule's value may be a resolver, for prose that carries a token needing the field's own
      // mapping table (generation B's "outdoor hard"). `undefined` back from a resolver means the
      // rule matched the SHAPE but not the vocabulary — a genuine mapping gap, so it aborts exactly
      // as an unmapped single token would. It must not fall through to the prose fallback, or an
      // unknown material would quietly become null.
      let value = hit ? hit.value : PROSE_FALLBACK[field]
      if (hit && typeof hit.value === 'function') {
        value = hit.value(rawStr)
        if (value === undefined) {
          unmapped.push(`${key}: ${field} = "${rawStr}" matched prose rule [${hit.branch}] but its value component has no entry in MAPPINGS.${field}`)
          return { value: null, raw: rawStr, mapped: false }
        }
      }
      return {
        value, raw: rawStr, mapped: true, changed: true,
        prose: { field, raw: rawStr, resolved: value },
        branch: hit ? hit.branch : 'prose_ambiguous',
        branch_reason: hit
          ? `prose "${rawStr}" unambiguously implies ${field}=${value}; original preserved verbatim`
          : `prose "${rawStr}" describes mixed or conditional state, so ${field} rests at ${value} rather than asserting a precise value; original preserved verbatim`,
      }
    }
    // Path 3 — genuine mapping gap. Abort.
    unmapped.push(`${key}: ${field} = "${rawStr}" (normalized "${nk}") has no entry in MAPPINGS.${field}`)
    return { value: null, raw: rawStr, mapped: false }
  }
  const entry = table[nk]
  // A table entry may be a conditional resolver rather than a constant, for workbook values whose
  // correct target depends on the venue itself (see access_type.private_institution). The branch it
  // takes and why are carried through to provenance so the per-row decision stays auditable.
  if (typeof entry === 'function') {
    const r = entry(ctx)
    return { value: r.value, raw: String(raw).trim(), mapped: true, changed: true, branch: r.branch, branch_reason: r.reason }
  }
  return { value: entry, raw: String(raw).trim(), mapped: true, changed: normKey(entry) !== nk }
}

// =============================================================================================
// Tab reading — MCP dump or CSV export, normalized to { headers, rows: [{col: val}] }
// =============================================================================================
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * Finds the header row and returns objects keyed by column name.
 * Row 1 of every tab is a title row ("Import Ready"), row 2 is the header, data starts row 3 — but
 * rather than hardcode that, locate the first row containing the `research_key` column so a workbook
 * with a different preamble still parses.
 */
// Column names that identify a header row. Detection scores each row by how many of its cells are
// recognizable field names and takes the first row clearing the threshold — which is what lets one
// parser handle Toledo (row 1 is a title), Madison and Melbourne (NO research_key column at all,
// so the old research_key marker found nothing) and Spokane (row 2 is a prose note, not a header).
const KNOWN_HEADERS = new Set([
  'research_key', 'venue_key', 'id', 'location_id', 'name', 'venue_name', 'slug', 'address',
  'street_address', 'city', 'state', 'zip', 'postal_code', 'county', 'country', 'court_count',
  'access_type', 'fee_type', 'website', 'website_url', 'url', 'phone', 'indoor_outdoor', 'setting',
  'court_setting', 'indoor', 'lighting', 'surface', 'reservation_policy', 'reservation_required',
  'reservations', 'court_configuration', 'line_type', 'net_setup', 'address_source',
  'research_status', 'is_draft', 'status', 'record_state', 'lat', 'lng', 'latitude', 'longitude',
  'google_place_id', 'public_notes', 'provenance', 'provenance_note', 'provenance_url',
])

// =============================================================================================
// EVIDENCE TAB — its own marker set and its own alias override.
//
// An Evidence tab's columns describe the CITATION, not the venue: `research_key, field_name,
// accepted_value, source_url, source_type, source_tier, controlling_entity_evidence,
// evidence_statement, retrieval_date, confidence`. Exactly ONE of those (`research_key`) is in
// KNOWN_HEADERS, so header detection scored the row 1 against a threshold of 4 and the whole tab
// parsed to `{headers: [], rows: []}` — silently, with no error and no zero-row assertion. Toledo's
// Evidence tab has 62 grid rows and produced 0 for every run this pipeline has ever made.
//
// That is why `urlOf(evIdentity|evAccess|evFee|evCount|evSetting)` returned null for every venue in
// every metro, for TWO independent reasons: there were no evidence rows to read, AND
// COLUMN_ALIASES renames `source_url -> website` before the row object is built. Fixing only the
// alias is a provable no-op; both have to move together.
//
// SCOPED, NOT REMOVED. `source_url -> website` is load-bearing on the PRIMARY tab: it is the ONLY
// URL column on madison (48 rows), melbourne (15), syracuse (15) and winston-salem (24), so dropping
// it globally would null `website` and `primaryUrl` for 102 venues. On an EVIDENCE tab the same
// header means the citation for ONE field, so it is pinned to itself here and nowhere else. Only
// `source_url` is pinned: it is the one spelling observed on a real evidence tab, and neutralizing
// `url`/`website_url` speculatively would be a guess about a workbook nobody has seen.
const EVIDENCE_HEADERS = new Set([
  ...KNOWN_HEADERS,
  'field_name', 'accepted_value', 'source_url', 'source_type', 'source_tier',
  'controlling_entity_evidence', 'evidence_statement', 'retrieval_date', 'confidence',
])
const EVIDENCE_ALIASES = { source_url: 'source_url' }

export function tabToRows(grid, { headerRow = null, aliases = {}, markers = KNOWN_HEADERS, label = 'tab' } = {}) {
  if (!Array.isArray(grid) || !grid.length) return { headers: [], rows: [], urlColumnSplit: null }
  const alias = { ...COLUMN_ALIASES, ...aliases }

  let headerIdx
  if (headerRow != null) {
    headerIdx = headerRow - 1              // config gives a 1-based row number
  } else {
    let best = -1, bestScore = 0
    for (let i = 0; i < Math.min(grid.length, 12); i++) {
      const r = grid[i]
      if (!Array.isArray(r)) continue
      const score = r.filter((c) => markers.has(normKey(c))).length
      if (score >= 4 && score > bestScore) { best = i; bestScore = score }
    }
    headerIdx = best
  }
  if (headerIdx == null || headerIdx < 0 || !Array.isArray(grid[headerIdx])) return { headers: [], rows: [], urlColumnSplit: null }

  // Raw spellings are kept alongside the canonical names: the collision resolver decides by the
  // ORIGINAL header (`website_url` vs `source_url`), which aliasing has already erased.
  const rawKeys = grid[headerIdx].map((h) => normKey(h))
  const headers = rawKeys.map((k) => alias[k] ?? k)
  const urlColumnSplit = resolveUrlColumns(rawKeys, headers, label)
  const rows = []
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i]
    if (!Array.isArray(raw) || raw.every((c) => blank(c))) continue
    const obj = {}
    headers.forEach((h, j) => { if (h) obj[h] = raw[j] ?? '' })
    obj._rowNumber = i + 1
    rows.push(obj)
  }
  return { headers, rows, urlColumnSplit }
}

function loadTabs({ raw, csvDir }) {
  if (raw) return JSON.parse(readFileSync(raw, 'utf8'))
  const tabs = {}
  for (const f of readdirSync(csvDir)) {
    if (!/\.csv$/i.test(f)) continue
    tabs[f.replace(/\.csv$/i, '')] = parseCsv(readFileSync(join(csvDir, f), 'utf8'))
  }
  return tabs
}

// =============================================================================================
// Workbook coordinate cross-check (never a source — see the header)
// =============================================================================================
const plausibleLat = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 90 && String(v).includes('.')
const plausibleLng = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 180 && String(v).includes('.')
const looksLikePhone = (v) => /^[\d][\d\s().-]{6,}$/.test(String(v ?? '').trim())

/**
 * Pulls a workbook coordinate pair for cross-check ONLY, detecting the known one-column-right shift.
 * Returns { lat, lng, shifted } or null when nothing usable is present. A shift that loses the
 * longitude entirely (the Little Rock shape) returns null with `note` explaining why — the pair is
 * unrecoverable from this tab alone and is not worth reconstructing, because it is not a source.
 */
function workbookCoordinate(venueRow) {
  if (!venueRow) return null
  const lat = venueRow.latitude ?? venueRow.lat
  const lng = venueRow.longitude ?? venueRow.lng
  if (blank(lat) && blank(lng)) return null

  if (plausibleLat(lat) && plausibleLng(lng)) return { lat: Number(lat), lng: Number(lng), shifted: false }

  // Shift signature: the latitude column holds a phone number and the longitude column holds what is
  // actually the latitude. The real longitude fell out of the row.
  if (looksLikePhone(lat) && plausibleLat(lng)) {
    return { lat: null, lng: null, shifted: true, note: `row ${venueRow._rowNumber}: columns shifted one place right from \`phone\` — the latitude column holds a phone number and the longitude column holds the latitude; the longitude is not present in this tab. Workbook pair discarded (it is a cross-check, never a source).` }
  }
  return { lat: null, lng: null, shifted: true, note: `row ${venueRow._rowNumber}: coordinate columns did not type-check (lat="${lat}", lng="${lng}") — workbook pair discarded.` }
}

// =============================================================================================
// Extract
// =============================================================================================
/**
 * A field node may assert a `source_url` only when BOTH are true:
 *   (a) the field actually carries a value — no source establishes a fact that was never stated; and
 *   (b) a source SPECIFIC TO THAT FIELD established it.
 *
 * This is the rule `court_count` has always followed in this file (`source_url: urlOf(evCount)`, with
 * no `primaryUrl` fallback), and `surface` follows even more strictly by carrying no source_url at all.
 * Both are physical-attribute columns, which is what `indoor` and `lighting` are — so applying it to
 * them aligns them with an existing convention rather than inventing a rule.
 *
 * WHY IT MATTERS: `primaryUrl` is the venue's IDENTITY/listing source. It establishes "this venue
 * exists, here, and does pickleball". It is very often silent on whether the courts are lit or indoor,
 * so inheriting it onto those nodes asserts that a page says something it usually does not. Huntsville
 * is the case that surfaced it: `toney-madison-crossroads` had its identity evidence deliberately moved
 * onto Madison County's own facility directory, but `indoor` and `lighting` kept citing
 * pickleball-huntsville.com — a club page whose own /locations.php disclaims association with the
 * venue. Three further Huntsville rows (willow-park, california-street-park, philpot-park) cite that
 * same disclaiming page on every field; they were downgraded to research_status='probable' under
 * ADR-14 rather than re-sourced, so this fix reaches their indoor/lighting nodes too.
 *
 * Measured before the change: of 746 `indoor` source_urls, 745 were simply `primaryUrl` and exactly 1
 * came from a real Evidence-tab row; all 526 `lighting` source_urls were `primaryUrl`. 356 lighting and
 * 35 indoor of those sat on a node whose value was null. `source_url` is not a publish-gate condition,
 * so nothing here can move a split.
 *
 * NOT user-facing: lib/directory/loadFacilities.ts render-restricts `provenance` by name, so this is
 * an internal evidence-trail correctness fix, not a false attribution shown to a reader.
 *
 * DELIBERATELY NOT WIDENED: `reservation_policy` (unconditional `primaryUrl`, no evidence lookup at
 * all), `address`, and the `|| primaryUrl` fallbacks on `name`/`access_type`/`fee_type` are the same
 * defect class with a far larger blast radius. Flagged for their own slice, not absorbed here.
 */
function fieldSourceUrl(value, fieldEvidenceUrl) {
  if (value === null || value === undefined) return null
  return fieldEvidenceUrl || null
}

/**
 * How the artifact describes where its grid came from.
 *
 * THIS EXTRACTOR HAS NEVER READ A GOOGLE SHEET. `loadTabs` takes a tab-grid JSON via `--raw` or a
 * directory of CSVs via `--csv-dir`; a Sheet sits UPSTREAM of that file, and for the 29
 * workbook-derived metros it is merely how the grid was obtained (an agent transcribing tabs through
 * the Sheets MCP). Source-led research produces the same grid with no Sheet anywhere in its history,
 * and the hardcoded `Google Sheet …` prefix then makes the artifact assert a provenance that never
 * existed — in the one file that IS the audit record for the run.
 *
 * `workbook.source_description` replaces the ORIGIN PHRASE only. The tab list and the extractor
 * attribution stay, because both remain true however the grid was authored.
 *
 * ABSENT, this returns the exact expression that stood inline before it existed, so every
 * workbook-derived artifact is byte-identical BY CONSTRUCTION rather than by a check re-run each
 * time — the same argument class as an additive MAPPINGS key.
 *
 * Scope note: this string does NOT reach the database. `import-metro-merged.mjs` copies `updated`,
 * `workbook_coordinate_warning`, `enum_mappings_applied`, `verified_facts_applied` and
 * `owner_decisions` out of the artifact and nothing else. What is at stake is the artifact's own
 * honesty, which is what a later reader trusts when reconstructing why a row says what it says.
 */
export function describeSource(config, gen) {
  const tabs = [gen.primary_tab, gen.venues_tab, gen.evidence_tab].filter(Boolean).join(' + ')
  const suffix = `${tabs} tabs, extracted by scripts/lib/workbook-extract.mjs`
  const described = config.workbook?.source_description
  if (described === undefined || described === null) {
    return `Google Sheet ${config.spreadsheet_id || '(supplied export)'} — ${suffix}`
  }
  // Validated rather than coerced: a blank or non-string value here would silently produce an
  // artifact whose provenance sentence begins with nothing, which is worse than the wrong claim it
  // replaces. Same posture as applyAddressSourceDefault.
  if (typeof described !== 'string' || !described.trim()) {
    throw new Error(`workbook.source_description must be a non-empty string describing where the grid came from, got ${JSON.stringify(described)}`)
  }
  return `${described.trim()} — ${suffix}`
}

/**
 * `fetchImpl` is a TEST SEAM, defaulting to the real `fetch` and threaded straight through to the
 * geocoder. geocode-nominatim.mjs already established this seam one level down and says why: the
 * >=1.1 s courtesy spacing is deliberately NOT injectable, so a network-free test is the only way to
 * exercise a geocoding path without either paying the real wait or building a bypass that could
 * later leak into a real run. Nothing but tests passes it.
 */
export async function extractWorkbook({ tabs, config, geocode = true, cachePath, log = console.log, fetchImpl = undefined }) {
  /** Only forward the seam when a caller supplied one, so the production call sites keep passing
   *  exactly the options they passed before and the default `fetch` binding is untouched. */
  const net = fetchImpl ? { fetchImpl } : {}
  const wb = config.workbook || {}
  // Tab ROLES are resolved before anything is parsed: a metro may file its venue table under a tab
  // other than its generation's default (see applyTabOverrides).
  const gen = applyAddressSourceDefault(
    applyTabOverrides(detectGeneration(tabs, wb.generation), wb.tabs, tabs),
    wb.address_source_default,
  )
  // Config aliases win over generation aliases, which win over the global table.
  const genAliases = { ...gen.aliases, ...(wb.aliases || {}) }
  log(`workbook generation ${gen.id} — ${gen.label}`)
  if (gen.tab_overrides) gen.tab_overrides.forEach((t) => log(`  tab override: ${t}`))

  let importReady = tabToRows(tabs[gen.primary_tab] || [], { headerRow: wb.header_row, aliases: genAliases, label: `"${gen.primary_tab}" tab` })
  if (!importReady.rows.length) throw new Error(`"${gen.primary_tab}" tab is empty, or no header row was detected (set workbook.header_row in the metro config)`)

  // Whole-column mislabel: verified against the real data BEFORE the alias is applied, then the tab
  // is re-parsed with it. Cheap (parsing is in-memory) and it keeps the decision falsifiable rather
  // than declared.
  const columnAliasesApplied = []
  for (const ca of gen.conditional_aliases || []) {
    const v = verifyWholeColumnAlias(importReady, ca)
    if (v.ok) {
      genAliases[ca.from] = ca.to
      importReady = tabToRows(tabs[gen.primary_tab] || [], { headerRow: wb.header_row, aliases: genAliases, label: `"${gen.primary_tab}" tab` })
      columnAliasesApplied.push({ ...ca, applied: true, verification: v.reason })
      log(`  column alias APPLIED: "${ca.from}" read as "${ca.to}" — ${v.reason}`)
    } else {
      columnAliasesApplied.push({ ...ca, applied: false, verification: v.reason })
      if (v.checked) log(`  column alias WITHHELD: "${ca.from}" -> "${ca.to}" — ${v.reason}`)
    }
  }

  // Two source columns canonicalizing onto research_status would let sheet column order decide the
  // metro's whole publish set silently (tabToRows lets the later column win). Abort instead. Scoped
  // to this one field on purpose: it is the only one an alias map can collide on today, and a blanket
  // duplicate-header check would change behaviour for the 20 already-projected generation-A metros.
  const statusHeaders = importReady.headers.filter((h) => h === 'research_status').length
  if (statusHeaders > 1) {
    throw new Error(`${statusHeaders} columns in "${gen.primary_tab}" resolve to research_status after aliasing (${importReady.headers.join(', ')}). Column order would silently decide which one wins — disambiguate with a per-metro "workbook.aliases" override.`)
  }

  const venuesTab = gen.venues_tab ? tabToRows(tabs[gen.venues_tab] || [], { aliases: genAliases, label: `"${gen.venues_tab}" tab` }) : { headers: [], rows: [] }
  // The evidence tab gets its OWN marker set and its own alias override — see EVIDENCE_HEADERS.
  // Both are scoped to this one call, so the primary and venues tabs parse exactly as before.
  const evidenceTab = gen.evidence_tab
    ? tabToRows(tabs[gen.evidence_tab] || [], { aliases: { ...genAliases, ...EVIDENCE_ALIASES }, markers: EVIDENCE_HEADERS, label: `"${gen.evidence_tab}" tab` })
    : { headers: [], rows: [] }

  // The two-URL-column split, if this workbook had one. Scoped to the PRIMARY tab: it is the only
  // tab whose URL columns feed a venue, so a split on Venues/Evidence would be recorded but must
  // not change how a venue is read.
  const urlSplit = importReady.urlColumnSplit || null
  if (urlSplit) log(`  URL column split: "${urlSplit.website_column}" -> website · "${urlSplit.citation_column}" -> name_source_url`)
  log(`  tabs: primary "${gen.primary_tab}" (${importReady.rows.length} rows) · venues "${gen.venues_tab ?? '—'}" (${venuesTab.rows.length}) · evidence "${gen.evidence_tab ?? '—'}" (${evidenceTab.rows.length})`)

  // A GRID THAT EXISTS AND PARSES TO ZERO ROWS IS THE DEFECT THIS SLICE FIXED — say so loudly rather
  // than letting an empty `ev` look like "this workbook has no evidence". An ABSENT tab is a
  // different, ordinary fact (28 of the 29 dumps have no evidence tab at all) and stays quiet.
  const evidenceGridRows = gen.evidence_tab && Array.isArray(tabs[gen.evidence_tab]) ? tabs[gen.evidence_tab].length : 0
  if (evidenceGridRows > 0 && evidenceTab.rows.length === 0) {
    log(`  !! evidence tab "${gen.evidence_tab}" has ${evidenceGridRows} grid row(s) but parsed to ZERO — no header row was detected. Every field's source_url will fall back to primaryUrl. Set workbook.header_row or extend EVIDENCE_HEADERS.`)
  }

  // PRESENCE GATE on the generation's declared TRUE/FALSE columns. A generation declares which
  // boolean columns its workbooks CAN carry; this narrows that to the ones this workbook actually
  // HAS. Generation A declares indoor+lighting but only 3 of its 20 workbooks have `indoor` and 12
  // have `lighting` — reading a declared-but-absent column would hand every venue a node carrying a
  // source_url for a column nobody filled in, which asserts provenance that does not exist.
  const boolColumns = {}
  for (const [field, col] of Object.entries(gen.boolean_columns || {})) {
    if (importReady.headers.includes(col) || venuesTab.headers.includes(col)) boolColumns[field] = col
  }
  const declaredBools = Object.keys(gen.boolean_columns || {})
  if (declaredBools.length) {
    const absent = declaredBools.filter((f) => !boolColumns[f])
    log(`  boolean columns: read ${Object.keys(boolColumns).join('+') || 'none'}${absent.length ? ` · declared but ABSENT from this workbook (not read): ${absent.join(', ')}` : ''}`)
  }

  // The workbook's own metro label, normalized and CROSS-CHECKED against the config. The importer
  // takes metro_area from the config (metroLabel() renders `${metro_area}, ${state}`, so a stored
  // "Modesto, CA MSA" would render "Modesto, CA MSA, CA"), which means the workbook column would
  // otherwise be silently discarded. Checking it instead turns a dropped value into a guard that a
  // tab dump filed under the wrong metro cannot pass.
  const metroLabels = []
  if (gen.metro_area_column) {
    const seen = new Set()
    for (const r of importReady.rows) {
      const raw = orNull(r[gen.metro_area_column])
      if (raw && !seen.has(raw)) { seen.add(raw); metroLabels.push(raw) }
    }
    const want = normKey(config.metro_area)
    for (const raw of metroLabels) {
      // Strip a trailing state/MSA suffix: "Modesto, CA MSA" -> "Modesto".
      const bare = String(raw).replace(/\s*,\s*[A-Z]{2}(?:\s*[-–]\s*[A-Z]{2})*\s*(?:MSA|metro(?:politan)?(?:\s+area)?)?\s*$/i, '').trim()
      const tokens = normKey(bare).split('_')
      const ok = normKey(bare) === want || tokens.includes(want) || normKey(bare).startsWith(`${want}_`)
      if (!ok) {
        throw new Error(`workbook ${gen.metro_area_column}="${raw}" (normalizes to "${bare}") does not match config metro_area "${config.metro_area}". Either this tab dump belongs to a different metro, or the config's metro_area is wrong. The config value is what gets stored; fix one of them rather than proceeding.`)
      }
    }
    if (metroLabels.length) log(`  metro_area cross-check OK: workbook ${JSON.stringify(metroLabels)} -> config "${config.metro_area}"`)
  }

  const venuesByKey = new Map(venuesTab.rows.map((r) => [String(r.research_key || '').trim(), r]))
  const evidenceByKey = new Map()
  for (const e of evidenceTab.rows) {
    const k = String(e.research_key || '').trim()
    if (!k) continue
    if (!evidenceByKey.has(k)) evidenceByKey.set(k, [])
    evidenceByKey.get(k).push(e)
  }

  const unmapped = []
  const mappingsApplied = {}
  const notes = []
  const contaminations = []
  const proseResolutions = []
  const settingCrosschecks = []
  // A boolean cell whose raw string carries more than the boolean can hold ("partial",
  // "4 courts lighted"). Appended verbatim to public_notes alongside the prose resolutions, so the
  // qualifier reaches the reader rather than being flattened into a bare chip.
  const booleanQualifiers = []
  // Rows where the TRUE/FALSE column AND the indoor_outdoor/setting enum both produced a non-null
  // value, so the two can be compared. See the cross-check block below.
  const indoorCrosschecks = []
  const record = (field, from, to) => {
    if (from == null) return
    const k = `${field}: "${from}"`
    mappingsApplied[k] = to === null ? 'null (no honest mapping — raw kept in provenance)' : String(to)
  }

  const venues = []
  for (const r of importReady.rows) {
    // Madison and Melbourne have no research_key column at all. Synthesize one from the metro key
    // plus the venue's own slug/name — DETERMINISTIC, so a re-run produces identical keys and the
    // candidate_key <-> listing linkage stays stable instead of churning on every extract.
    let key = String(r.research_key || '').trim()
    let keySynthesized = false
    if (!key) {
      const basis = orNull(r.slug) || orNull(r.name)
      if (!basis) continue
      key = `${config.metro}-${slugify(basis)}`
      keySynthesized = true
    }
    const vRow = venuesByKey.get(key) || null
    const ev = evidenceByKey.get(key) || []
    const evFor = (fieldNames) => ev.find((e) => fieldNames.includes(normKey(e.field_name))) || null

    const name = orNull(r.name) || orNull(vRow?.venue_name)
    const city = orNull(r.city) || orNull(vRow?.city)
    const state = (orNull(r.state) || orNull(vRow?.state) || '').toUpperCase()
    const address = orNull(r.address) || orNull(vRow?.address)
    const zip = orNull(r.zip) || orNull(vRow?.zip)

    // Hoisted above the enum block because the conditional access_type resolver needs them.
    //
    // TWO URLS, TWO FACTS (owner ruling 2026-08-01 — see URL_COLUMN_ROLE).
    //   websiteUrl  = the venue's/operator's own site. Feeds the user-facing `website` column.
    //   citationUrl = the evidence that established the venue's identity. Exists only where the
    //                 resolver split a two-column collision on the primary tab.
    // The source-URL column differs by generation and there may be more than one candidate column;
    // first non-blank wins. Generation A's list is ['website'], which is exactly what this line read
    // before the generation table existed.
    const websiteUrl = gen.source_url_columns.map((c) => orNull(r[c])).find(Boolean) || orNull(vRow?.primary_source_url)
    const citationUrl = urlSplit ? orNull(r.name_source_url) : null
    // The EVIDENCE url — what name.source_url and every `|| primaryUrl` fallback rest on. On a split
    // tab it is the citation and NOTHING ELSE: a blank citation cell means "this row cites nothing",
    // and falling back to the website column there would assert evidence the workbook never claimed.
    // On every single-URL-column workbook the resolver never fired, citationUrl is null, and this is
    // byte-for-byte the expression that stood here before.
    const primaryUrl = urlSplit ? citationUrl : websiteUrl
    const controllingEntity = orNull(vRow?.controlling_entity)

    // --- ADR-14 evidence tiering, hoisted ------------------------------------------------------
    // Computed BEFORE the enums because generation B's research_status resolver needs to know whether
    // this row carries a controlling-entity source: `status='active'` is a record-state flag, and
    // promoting it to 'verified' without evidence would let 8 metros walk past the ADR-14 bar.
    // Pure move for generation A — nothing between the old and new positions touches these inputs.
    // BOTH facts are scanned — a rescued website column must not become an ADR-14 blind spot.
    // De-duplicated pairwise so a workbook with one URL column, or two columns holding the same
    // URL, produces the byte-identical array it produced before; without that every metro would
    // diff and nothing would be attributable. Note the safety direction: this list can only ever
    // GAIN entries, so the only reachable flip is aggregator-only -> mixed, which PROMOTES a row.
    // It can never newly downgrade one.
    const rowUrls = citationUrl && citationUrl !== websiteUrl ? [websiteUrl, citationUrl] : [websiteUrl]
    const allUrls = [...rowUrls, ...ev.map((e) => orNull(e.source_url))].filter(Boolean)
    const aggregatorUrls = allUrls.filter((u) => AGGREGATOR_HOST.test(u))
    const nonAggregatorUrls = allUrls.filter((u) => !AGGREGATOR_HOST.test(u))
    const aggregatorOnly = allUrls.length > 0 && nonAggregatorUrls.length === 0

    // --- enums -------------------------------------------------------------------------------
    const access = mapEnum('access_type', r.access_type ?? vRow?.access_type, unmapped, key,
      // The `.edu`-host heuristic asks about the venue's OWN site, so it gets websiteUrl; the
      // fallback keeps it fed on a split row whose website cell is blank. This is a heuristic
      // input, not a stored provenance claim, so preferring one over the other cross-fills
      // nothing a reader ever sees. Identical to the old value on every non-split tab.
      { name, website: websiteUrl || primaryUrl, controlling_entity: controllingEntity, city, state })
    const fee = mapEnum('fee_type', r.fee_type ?? vRow?.fee_type, unmapped, key)
    const cfg = mapEnum('court_configuration', r.court_configuration ?? vRow?.court_configuration, unmapped, key)
    const io = mapEnum('indoor_outdoor', r.indoor_outdoor ?? vRow?.setting, unmapped, key)
    const surface = mapEnum('surface', r.surface ?? vRow?.surface, unmapped, key)
    const lineType = mapEnum('line_type', r.line_type ?? vRow?.line_type, unmapped, key)
    const netSetup = mapEnum('net_setup', r.net_setup ?? vRow?.net_setup, unmapped, key)
    const addrSource = mapEnum('address_source', r.address_source ?? vRow?.address_source, unmapped, key)
    const status = mapEnum('research_status', r.research_status ?? vRow?.research_status, unmapped, key,
      { name, nonAggregatorUrls, aggregatorUrls, allUrls })
    const idConf = mapEnum('confidence', vRow?.confidence ?? r.confidence, unmapped, key)
    const pickConf = gen.pickleball_confidence_column
      ? mapEnum('confidence', r[gen.pickleball_confidence_column] ?? vRow?.[gen.pickleball_confidence_column], unmapped, key)
      : { value: null }

    // --- TRUE/FALSE columns this generation genuinely carries ---------------------------------
    // Read only where the generation declares them. Routing these through MAPPINGS.indoor_outdoor
    // would abort (that table has no boolean keys), which is why they need their own reader.
    const bools = {}
    for (const [field, col] of Object.entries(boolColumns)) {
      const b = readBoolean(field, r[col] ?? vRow?.[col], unmapped, key)
      bools[field] = b
      // Recorded, not swallowed: the branch shows up in enum_mappings_applied and the row is named
      // in extraction_notes, so a nulled boolean is as auditable as a nulled enum.
      if (b.unrepresentable) {
        record(field, `${b.raw} (unrepresentable_in_boolean branch)`, null)
        notes.push(`${key}: ${field}="${b.raw}" states both states at once and is unrepresentable in a boolean column — left NULL with the raw value kept in provenance. This is the same call MAPPINGS.indoor_outdoor already makes for the enum-shaped form of this column.`)
      } else if (b.branch) {
        record(field, `${b.raw} (${b.branch} branch)`, b.value)
      }
      // Same destination as an enum contamination: the shared `contamination` array the CLI already
      // prints and the workbooks get fixed from. Value nulled, never relocated.
      if (b.contamination) {
        contaminations.push({ research_key: key, ...b.contamination })
        notes.push(`${key}: ${b.branch_reason}`)
      }
      if (b.qualifier) {
        booleanQualifiers.push({ research_key: key, ...b.qualifier })
        notes.push(`${key}: ${field}="${b.raw}" resolved to ${b.qualifier.resolved} [${b.branch}] — ${b.qualifier.reason}`)
      }
    }

    // --- indoor: TRUE/FALSE column vs the indoor_outdoor/setting enum ------------------------
    // Two workbook cells answering the same question can disagree, and silently preferring one is
    // how a contradiction becomes a confident wrong fact. Where BOTH produce a non-null value they
    // are compared: agreement is recorded, DISAGREEMENT is flagged with both values kept, and the
    // dedicated boolean column is kept as the row's value — the identical call the surface/setting
    // cross-check below already makes, and consistency is worth more here than re-deriving it.
    //
    // Across all 29 workbooks these two columns are MUTUALLY EXCLUSIVE — every metro with an
    // `indoor` boolean has no `indoor_outdoor` column and vice versa — so this compares 0 rows
    // today and CANNOT report a disagreement. That is asserted rather than assumed: the count is
    // printed on every run. It exists for the workbook that eventually carries both.
    let indoorCrosscheck = null
    const indoorBoolValue = bools.indoor ? bools.indoor.value : null
    if (indoorBoolValue !== null && typeof io.value === 'boolean') {
      const agree = indoorBoolValue === io.value
      indoorCrosscheck = {
        boolean_raw: bools.indoor.raw, boolean_value: indoorBoolValue,
        indoor_outdoor_raw: io.raw, indoor_outdoor_value: io.value,
        agree,
      }
      indoorCrosschecks.push({ research_key: key, ...indoorCrosscheck })
      if (!agree) {
        notes.push(`${key}: CONTRADICTION — the workbook's indoor boolean says ${indoorBoolValue} but its indoor_outdoor/setting cell "${io.raw}" resolves to ${io.value}. Neither was silently preferred: the dedicated boolean column is kept as the row's value, BOTH are recorded in provenance.fields.indoor.boolean_crosscheck, and this row is reported for research.`)
      }
    }

    // Reservation comes from one of two differently-shaped columns depending on the workbook, and
    // they must NOT be routed through the same map. A `reservation_policy` column carries a policy
    // vocabulary (`first_come`, `scheduled_open_play`, ...); the Import Ready template's
    // `reservation_required` column and the Venues tab's `reservations` column both carry a bare
    // yes/no. Sending a "yes" through the policy map is how this aborted on its first run.
    const policyRaw = r.reservation_policy ?? vRow?.reservation_policy
    const yesNoRaw = r.reservation_required ?? vRow?.reservation_required ?? vRow?.reservations
    const reservation = !blank(policyRaw)
      ? mapEnum('reservation_policy', policyRaw, unmapped, key)
      : mapEnum('reservation_required', yesNoRaw, unmapped, key)

    for (const [field, m] of Object.entries({ access_type: access, fee_type: fee, court_configuration: cfg, indoor_outdoor: io, surface, line_type: lineType, net_setup: netSetup, address_source: addrSource, research_status: status, reservation_policy: reservation })) {
      // A conditional entry can resolve differently per row, so the branch is part of the key —
      // otherwise the second row silently overwrites the first in the applied-mappings record.
      if (m.raw != null && m.changed !== false) record(field, m.branch ? `${m.raw} (${m.branch} branch)` : m.raw, m.value)
      if (m.contamination) contaminations.push({ research_key: key, ...m.contamination })
      if (m.prose) proseResolutions.push({ research_key: key, ...m.prose, branch: m.branch, reason: m.branch_reason })
    }

    // A commercial/public_program venue whose fee column is blank is still a paid facility; but we do
    // NOT invent the fee. Record the inference opportunity as a note for the owner instead.
    const accessRawKey = normKey(access.raw)
    if ((accessRawKey === 'commercial' || accessRawKey === 'public_program') && fee.value == null) {
      notes.push(`${key}: access_type "${access.raw}" mapped to public, but fee_type is blank in the workbook — left NULL rather than inferred as 'fee'.`)
    }

    // --- evidence ----------------------------------------------------------------------------
    const evIdentity = evFor(['venue_identity', 'name', 'identity'])
    const evCount = evFor(['court_count'])
    const evSetting = evFor(['indoor_outdoor', 'setting'])
    const evLighting = evFor(['lighting'])
    const evAccess = evFor(['access_type', 'access'])
    const evFee = evFor(['fee_type', 'fee'])

    const tierOf = (e) => (e ? orNull(e.source_tier) : null)
    const confOf = (e) => {
      const c = e ? normKey(e.confidence) : null
      return c && LIVE.confidence.has(c) ? c : null
    }
    const urlOf = (e) => (e ? orNull(e.source_url) : null)

    // --- ADR-14 ------------------------------------------------------------------------------
    // (allUrls / aggregatorUrls / nonAggregatorUrls / aggregatorOnly are computed above the enums.)
    let researchStatus = status.value || 'pending'
    let adr14Note = null
    if (aggregatorOnly && researchStatus === 'verified') {
      researchStatus = 'probable'
      adr14Note = `ADR-14: every source for this venue is a tier-4 aggregator (${aggregatorUrls.join(', ')}). A venue cannot reach research_status='verified' on aggregator evidence alone, so it was downgraded to 'probable'. The publish gate holds it draft until a controlling-entity source confirms it.`
      notes.push(`${key}: ${adr14Note}`)
    }
    // Aggregator URLs must never reach a user-facing column. Keep them in provenance only.
    // Reads the venue's OWN site, not the citation — that is the whole fix. Where the workbook has
    // one URL column the two are the same value and this is unchanged.
    const userFacingWebsite = websiteUrl && AGGREGATOR_HOST.test(websiteUrl) ? null : websiteUrl
    if (websiteUrl && !userFacingWebsite) {
      notes.push(`${key}: website "${websiteUrl}" is a tier-4 aggregator — stripped from the user-facing website column (ADR-14), retained in provenance.`)
    }

    // --- slug --------------------------------------------------------------------------------
    const workbookSlug = orNull(r.slug)
    const cleanedName = config.name_cleanup
      ? String(name).replace(/\s+(pickleball\s+courts?|pickleball)$/i, '').trim() || name
      : name
    const slug = directorySlug({ name: cleanedName, city, state })

    // --- setting/surface cross-check (generation B fuses both into one cell) -------------------
    // The "outdoor"/"indoor" prefix on a surface cell is corroboration for the row's own `indoor`
    // boolean, never a substitute for it. Agreement is recorded; DISAGREEMENT is reported and left
    // unresolved — two workbook cells contradicting each other is a research finding, not something
    // to silently pick a winner for.
    const settingFromSurface = settingPrefixOf(surface.raw)
    if (settingFromSurface !== null) {
      const indoorBool = bools.indoor ? bools.indoor.value : null
      const agree = indoorBool === null ? null : indoorBool === settingFromSurface
      settingCrosschecks.push({
        research_key: key, surface_raw: surface.raw,
        surface_says_indoor: settingFromSurface,
        indoor_column: indoorBool,
        agree,
      })
      if (agree === false) {
        notes.push(`${key}: CONTRADICTION — surface cell "${surface.raw}" says ${settingFromSurface ? 'indoor' : 'outdoor'} but the indoor column says ${indoorBool}. Neither was overridden; the indoor column is kept as the row's value and this disagreement is flagged for research.`)
      } else if (agree === null) {
        notes.push(`${key}: surface cell "${surface.raw}" implies ${settingFromSurface ? 'indoor' : 'outdoor'}, but the indoor column is blank. Left NULL — filling one column from another column's cell is inference, not evidence.`)
      }
    }

    // --- coordinate cross-check (never a source) ---------------------------------------------
    // Which row carries lat/lng differs by generation; generation B puts them on the primary tab.
    const wb = workbookCoordinate(gen.coordinate_row === 'primary' ? r : vRow)
    if (wb?.note) notes.push(`${key}: ${wb.note}`)

    // Hoisted because the source_url rule below has to test it — a field with no value must not
    // assert a source for it.
    const indoorValue = bools.indoor ? (bools.indoor.value ?? io.value) : io.value

    const courtCountRaw = orNull(r.court_count) ?? orNull(vRow?.court_count)
    const courtCount = courtCountRaw != null && /^\d+$/.test(courtCountRaw) ? Number(courtCountRaw) : null
    if (courtCountRaw != null && courtCount == null) notes.push(`${key}: court_count "${courtCountRaw}" is not an integer — left NULL.`)

    venues.push({
      research_key: key,
      workbook_id: orNull(r.id) || null,
      slug,
      research_status: researchStatus,
      name: {
        value: cleanedName,
        workbook_name: cleanedName !== name ? name : undefined,
        source_url: urlOf(evIdentity) || primaryUrl,
        source_tier: tierOf(evIdentity),
        confidence: confOf(evIdentity) || idConf.value,
      },
      pickleball_activity: {
        value: true,
        source_tier: tierOf(evIdentity),
        // A generation that states pickleball confidence explicitly (C) is believed over the
        // identity confidence, which is a different claim about a different thing.
        confidence: pickConf.value || confOf(evIdentity) || idConf.value,
        note: evIdentity ? orNull(evIdentity.evidence_statement) : null,
      },
      coordinates: null,   // filled by the geocode pass below
      address: address ? { value: address, source_url: primaryUrl, source_tier: tierOf(evIdentity), confidence: confOf(evIdentity) } : { value: null },
      city, state, zip, country: 'US',
      court_count: { value: courtCount, workbook_value: courtCountRaw, source_url: urlOf(evCount), source_tier: tierOf(evCount), confidence: confOf(evCount) },
      access_type: { value: access.value ?? 'unknown', workbook_value: access.raw, source_url: urlOf(evAccess) || primaryUrl, source_tier: tierOf(evAccess), confidence: confOf(evAccess), mapping_branch: access.branch ?? null, mapping_branch_reason: access.branch_reason ?? null },
      fee_type: { value: fee.value, workbook_value: fee.raw, source_url: urlOf(evFee) || primaryUrl, source_tier: tierOf(evFee), confidence: confOf(evFee) },
      reservation_policy: { value: reservation.value, workbook_value: reservation.raw, source_url: primaryUrl },
      // A generation carrying a real TRUE/FALSE `indoor` column is believed over the indoor_outdoor
      // enum; where it has none, `bools.indoor` is absent and this is exactly the old expression.
      indoor: {
        value: indoorValue,
        workbook_value: bools.indoor?.raw ?? io.raw,
        source_url: fieldSourceUrl(indoorValue, urlOf(evSetting)), source_tier: tierOf(evSetting), confidence: confOf(evSetting),
        // Both values, kept side by side, whenever the workbook stated the fact twice. Omitted
        // entirely when it did not, so no artifact gains a key for a comparison that never happened.
        ...(indoorCrosscheck ? { boolean_crosscheck: indoorCrosscheck } : {}),
      },
      lighting: bools.lighting
        ? { value: bools.lighting.value, workbook_value: bools.lighting.raw, source_url: fieldSourceUrl(bools.lighting.value, urlOf(evLighting)) }
        : { value: null },
      surface: { value: surface.value, workbook_value: surface.raw },
      court_configuration: cfg.value,
      line_type: lineType.value,
      net_setup: netSetup.value,
      // Prose that could not be asserted as an enum is never discarded — it is appended verbatim so
      // a reader still gets the real-world nuance the workbook captured, even though the structured
      // field rests at `unknown`. It is also in provenance.fields.<field>.workbook_value.
      public_notes: {
        value: [
          orNull(r.public_notes),
          ...proseResolutions.filter((p) => p.research_key === key).map((p) => `${p.field.replace(/_/g, ' ')}: ${p.raw}`),
          // A boolean that could not carry its own qualifier ("partial", "4 courts lighted") lands
          // here for exactly the reason prose does: the structured column answers the question, and
          // the reader still gets the nuance instead of a chip that overstates it.
          ...booleanQualifiers.filter((q) => q.research_key === key).map((q) => `${q.field.replace(/_/g, ' ')}: ${q.raw}`),
        ].filter(Boolean).join(' | ') || null,
      },
      website: userFacingWebsite,
      phone: orNull(r.phone) || orNull(vRow?.phone),
      phone_source: blank(r.phone) ? null : `workbook (${gen.primary_tab})`,
      // A per-row signal always wins; the generation default only fills a column this generation
      // does not have. `manual_research` is the weaker, true claim — see GENERATIONS.
      address_source: addrSource.value ?? gen.address_source_default,
      identity_confidence: idConf.value || confOf(evIdentity),
      controlling_entity: controllingEntity,
      _workbook: {
        slug: workbookSlug,
        provenance_note: orNull(r.provenance_note),
        aggregator_urls: aggregatorUrls.length ? aggregatorUrls : null,
        adr14_note: adr14Note,
        workbook_coordinate: wb && wb.lat != null ? { lat: wb.lat, lng: wb.lng } : null,
        workbook_coordinate_note: wb?.note ?? null,
        evidence_rows: ev.length,
      },
    })
  }

  // The zero is ASSERTED, not merely absent: printed on every run whether or not anything compared.
  if (boolColumns.indoor) {
    const disagree = indoorCrosschecks.filter((c) => !c.agree).length
    log(`  indoor cross-check (TRUE/FALSE column vs indoor_outdoor/setting): ${indoorCrosschecks.length} row(s) carried BOTH values · ${disagree} disagreement(s)`)
  }

  // ---- unmapped enums abort, before a single geocode request is spent --------------------------
  if (unmapped.length) {
    log(`\nABORT: ${unmapped.length} workbook value(s) have no entry in the mapping table.`)
    unmapped.forEach((u) => log(`  x ${u}`))
    log('\nAdd an explicit entry to MAPPINGS in scripts/lib/workbook-extract.mjs. Never map a value to')
    log('null just to make the run pass — a silent null is a fact quietly deleted.')
    throw new Error(`${unmapped.length} unmapped workbook value(s)`)
  }

  // ---- geocode every venue independently -------------------------------------------------------
  let geocoded = 0
  let failed = []
  if (geocode) {
    log(`\ngeocoding ${venues.length} venue(s) via Nominatim (>=1.1s spacing, cached to disk)...`)
    for (const v of venues) {
      // Collects the denylisted street-furniture hits the geocoder refused, so the run log shows
      // where the rule fired. Deliberately log-only — it is not written into the artifact.
      const refused = []
      // The township rung's decision is log-only — it is not copied into the artifact (the coord
      // object below takes an explicit field list), so it adds no regression-diff noise while still
      // making every accept/reject auditable in the run log. The guard distance for the anchor that
      // WON does reach the artifact, inside coordinate.anchor.
      let townshipLog = null
      const hit = await geocodeVenue(
        { name: v.name.value, address: v.address.value, city: v.city, state: v.state, zip: v.zip },
        { cachePath, ...net, onAttempt: (a) => { if (a.micro?.length) refused.push(...a.micro); if (a.township) townshipLog = a.township } },
      )
      if (refused.length) log(`    ~ ${v.research_key.padEnd(32)} skipped ${refused.length} micro-feature hit(s) that can never anchor a venue: ${[...new Set(refused)].join(' | ')}`)
      if (townshipLog) {
        log(`    T ${v.research_key.padEnd(32)} township rung: ${townshipLog.fired ? townshipLog.locus : townshipLog.reason}`)
        if (townshipLog.discarded_street) log(`        street locus DISCARDED: ${townshipLog.discarded_street}`)
        townshipLog.accepted.forEach((x) => log(`        accepted: ${x}`))
        townshipLog.rejected.forEach((x) => log(`        ${x}`))
      }
      if (!hit) {
        failed.push(v.research_key)
        log(`  x ${v.research_key.padEnd(34)} NO RESULT from any query rung${refused.length ? ` (every hit was denylisted street furniture — see above)` : ''}`)
        continue
      }
      const coord = {
        lat: hit.lat, lng: hit.lng,
        source_url: hit.source_url,
        precision: hit.precision,
        origin: hit.origin,
        anchor: hit.anchor,
        osm_id: hit.osm_id,
        matched_rung: hit.matched_rung,
      }
      // The workbook pair, when one survived, is recorded as a CROSS-CHECK with its delta. The
      // importer re-derives this number rather than trusting it.
      const wbc = v._workbook.workbook_coordinate
      if (wbc) {
        const delta = Math.round(metresBetween(coord.lat, coord.lng, wbc.lat, wbc.lng))
        coord.workbook_crosscheck = { lat: wbc.lat, lng: wbc.lng, delta_m: delta, verdict: delta > 1000 ? 'DISAGREE (>1km) — workbook rejected' : 'agree' }
      }
      v.coordinates = coord
      geocoded++
      log(`  ${hit.precision === 'low' ? '!' : '+'} ${v.research_key.padEnd(34)} ${hit.precision.padEnd(6)} ${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}  ${hit.anchor}`)
    }
    flushCache()
    log(`\ngeocoded ${geocoded}/${venues.length} · live Nominatim requests this run: ${liveRequestCount()} · cache ${JSON.stringify(cacheStats())}`)
    if (failed.length) log(`no coordinate: ${failed.join(', ')} — these cannot publish (the gate requires a coordinate).`)
  }

  // ---- same-site pairs: try to SEPARATE a stacked anchor by geocoding each member BY NAME -------
  // A recreation center inside a city park shares the park's street address, so the address rungs
  // hand both rows the identical house-number point and the pair publishes as two pins on one spot —
  // which reads as a duplicate, the exact thing the pair adjudication exists to deny. The two are
  // frequently DISTINCT named features in OSM even when they share a postal address, so ask OSM by
  // name instead: passing address:null makes queryLadder emit only the name rungs, which needs no
  // new geocoder surface and leaves the precision rules to judge the result exactly as they always do
  // (no house number to match, so a name anchor scores `high` only if it genuinely name-matches).
  //
  // This changes WHICH QUERY WE ASK, never what we assert — no address is invented or substituted.
  //
  // A name query can land on a same-named venue in another township (the Harrisburg "Koons Park"
  // shape: a confident single hit 14 km away), so a name anchor is accepted only when it sits within
  // SAME_SITE_NAME_MAX_M of the venue's own address-derived anchor. Where no address anchor exists
  // there is nothing to measure against, so the name anchor is taken and the run says so.
  const SAME_SITE_NAME_MAX_M = config.same_site_name_max_m ?? 1000
  const sameSitePairs = config.same_site_pairs || []
  if (geocode && sameSitePairs.length) {
    log(`\nsame-site pairs: re-geocoding ${sameSitePairs.length * 2} pair member(s) BY NAME to separate shared anchors (guard: <= ${SAME_SITE_NAME_MAX_M} m from the address anchor)`)
    const byKey = new Map(venues.map((v) => [v.research_key, v]))
    for (const p of sameSitePairs) {
      for (const k of [p.a, p.b]) {
        const v = byKey.get(k)
        if (!v) throw new Error(`same_site_pairs names "${k}", which this workbook does not contain — stale config.`)
        if (!v.name?.value) continue
        const hit = await geocodeVenue({ name: v.name.value, address: null, city: v.city, state: v.state, zip: v.zip }, { cachePath, ...net })
        if (!hit) { log(`  x ${k.padEnd(30)} no name-only result — keeping the address anchor`); continue }
        const addrCoord = v.coordinates
        const d = addrCoord ? Math.round(metresBetween(hit.lat, hit.lng, addrCoord.lat, addrCoord.lng)) : null
        if (d != null && d > SAME_SITE_NAME_MAX_M) {
          log(`  ! ${k.padEnd(30)} name anchor REJECTED — ${d} m from the address anchor (> ${SAME_SITE_NAME_MAX_M} m): ${hit.anchor}`)
          notes.push(`${k}: name-only geocode landed ${d} m from the address anchor and was rejected as a different venue — ${hit.anchor}`)
          continue
        }
        log(`  + ${k.padEnd(30)} name anchor ACCEPTED ${hit.precision.padEnd(6)} ${d == null ? '(no address anchor to compare)' : `${d} m from the address anchor`}: ${hit.anchor}`)
        v.coordinates = {
          lat: hit.lat, lng: hit.lng,
          source_url: hit.source_url,
          precision: hit.precision,
          origin: hit.origin,
          anchor: hit.anchor,
          osm_id: hit.osm_id,
          matched_rung: hit.matched_rung,
          name_anchor: `re-geocoded by name to separate the adjudicated same-site pair with ${k === p.a ? p.b : p.a}${d == null ? '' : `; ${d} m from the address anchor`}`,
          ...(addrCoord?.workbook_crosscheck ? { workbook_crosscheck: null } : {}),
        }
      }
      // Did it work? If the two still resolve to one feature, that is the truthful answer — say so
      // on both rows rather than leaving two identical pins looking like an uncaught duplicate.
      const a = byKey.get(p.a)?.coordinates, b = byKey.get(p.b)?.coordinates
      if (a?.lat != null && b?.lat != null) {
        const sep = metresBetween(a.lat, a.lng, b.lat, b.lng)
        if (sep < 5 || (a.osm_id && a.osm_id === b.osm_id)) {
          a.shared_anchor_with = p.b
          b.shared_anchor_with = p.a
          log(`  = ${p.a} / ${p.b} STILL SHARE one anchor (${Math.round(sep)} m${a.osm_id === b.osm_id ? `, same OSM feature ${a.osm_id}` : ''}) — recorded as coordinate.shared_anchor_with on both rows`)
          notes.push(`${p.a} and ${p.b} share one OSM anchor even by name — two venues at one address point; recorded in provenance.coordinate.shared_anchor_with.`)
        } else {
          log(`  = ${p.a} / ${p.b} now separated by ${Math.round(sep)} m`)
        }
      }
    }
    flushCache()
    log(`  live Nominatim requests after the name pass: ${liveRequestCount()}`)
  }

  // ---- verified per-venue facts, supplied by adjudication rather than by the workbook ------------
  // The workbooks are incomplete and occasionally wrong. A fact confirmed against a controlling-entity
  // source can be asserted here, in the TRACKED config, so a re-extract reproduces it — a hand-edit to
  // the generated artifact would be silently undone by the next rebuild.
  //
  // Every override carries its own source_url + confidence + adjudication date onto the field node, so
  // it flows into provenance.fields.<field> through the importer's existing evidence() helper and is
  // distinguishable from a workbook-derived value forever after.
  //
  // A value that CONTRADICTS a non-null workbook value aborts unless the entry declares
  // `overrides_workbook: true` with a reason. Correcting the workbook is legitimate; doing it silently
  // is not, and this is the line between the two.
  const verifiedFactsApplied = []
  for (const [key, spec] of Object.entries(config.venue_facts || {})) {
    const v = venues.find((x) => x.research_key === key)
    if (!v) throw new Error(`venue_facts names "${key}", which this workbook does not contain — stale config, aborting.`)
    for (const [field, patch] of Object.entries(spec.fields || {})) {
      const node = v[field]
      if (node == null || typeof node !== 'object' || Array.isArray(node)) {
        throw new Error(`venue_facts ${key}.${field}: only evidence-bearing object fields can be overridden (name, court_count, access_type, fee_type, reservation_policy, indoor, surface, pickleball_activity, public_notes).`)
      }
      const before = node.value
      if ('value' in patch) {
        if (before != null && before !== patch.value && !patch.overrides_workbook) {
          throw new Error(`venue_facts ${key}.${field} would change "${before}" -> "${patch.value}", contradicting the workbook. If that is intended, set "overrides_workbook": true and a "reason" on the field entry.`)
        }
        node.value = patch.value
      }
      const url = patch.source_url ?? spec.source_url ?? null
      const conf = patch.confidence ?? spec.confidence ?? null
      if (url) node.source_url = url
      if (conf) node.confidence = conf
      if (patch.source_tier ?? spec.source_tier) node.source_tier = patch.source_tier ?? spec.source_tier
      node.note = [
        `verified fact applied from ${spec.adjudicated_by || 'adjudication'} on ${spec.adjudicated_on || 'unrecorded date'}`,
        patch.reason || spec.reason || null,
        patch.overrides_workbook ? `overrides the workbook value ${JSON.stringify(before)}` : null,
      ].filter(Boolean).join(' — ')
      verifiedFactsApplied.push({
        research_key: key, field,
        from: 'value' in patch ? before : '(value unchanged)',
        to: 'value' in patch ? patch.value : '(value unchanged)',
        source_url: url, confidence: conf,
        adjudicated_by: spec.adjudicated_by || null,
        adjudicated_on: spec.adjudicated_on || null,
        overrides_workbook: !!patch.overrides_workbook,
        reason: patch.reason || spec.reason || null,
      })
    }
    // research_status is a plain string on the venue, not an evidence-bearing node, so it cannot ride
    // in `fields`. It gets its own key. Downgrading a row the workbook called 'verified' is the whole
    // point of this knob — New Haven's wood-center is 'verified' in the workbook on the strength of a
    // JS booking app that returns nothing to a fetch, and an unconfirmed pickleball claim must not
    // publish — so the reason is MANDATORY, exactly like `overrides_workbook` on a field.
    if (spec.research_status != null) {
      if (!LIVE.research_status.has(spec.research_status)) {
        throw new Error(`venue_facts ${key}.research_status "${spec.research_status}" is not a live value (${[...LIVE.research_status].join('/')}).`)
      }
      if (!spec.research_status_reason) {
        throw new Error(`venue_facts ${key}.research_status is set but "research_status_reason" is missing — changing a research status silently is exactly what this block exists to prevent.`)
      }
      const from = v.research_status
      if (from !== spec.research_status) {
        v.research_status = spec.research_status
        verifiedFactsApplied.push({
          research_key: key, field: 'research_status',
          from, to: spec.research_status,
          source_url: spec.source_url ?? null, confidence: spec.confidence ?? null,
          adjudicated_by: spec.adjudicated_by || null, adjudicated_on: spec.adjudicated_on || null,
          overrides_workbook: true,
          reason: spec.research_status_reason,
        })
        notes.push(`${key}: research_status ${from} -> ${spec.research_status} by adjudication — ${spec.research_status_reason}`)
      }
    }

    // `website` is a plain string on the venue, not an evidence-bearing node, so — exactly like
    // research_status — it cannot ride in `fields` and needs its own key. Without it a row can be
    // re-sourced for EVIDENCE while its user-facing link still points at the weaker source, which is
    // not a bookkeeping problem: Huntsville's Madison Crossroads sent readers to a club page that
    // explicitly disclaims any association with the venue.
    //
    // `website_reason` is MANDATORY, the same discipline `overrides_workbook` and
    // `research_status_reason` enforce: replacing the link a reader clicks is legitimate, doing it
    // silently is not.
    //
    // The aggregator guard fails at SOURCE rather than at preflight. The extractor already strips an
    // aggregator out of this column on the workbook path (ADR-14), so an override is the one way one
    // could get back in; rejecting it here makes the escape hatch structurally incapable of doing
    // the thing the stripping exists to prevent, and does it before a geocode request is spent.
    if (spec.website !== undefined) {
      if (!spec.website_reason) {
        throw new Error(`venue_facts ${key}.website is set but "website_reason" is missing — replacing the link a reader clicks is exactly what this block must not do silently.`)
      }
      if (spec.website !== null) {
        if (typeof spec.website !== 'string' || !/^https?:\/\//i.test(spec.website)) {
          throw new Error(`venue_facts ${key}.website must be an http(s) URL or null, got ${JSON.stringify(spec.website)}.`)
        }
        if (AGGREGATOR_HOST.test(spec.website)) {
          throw new Error(`venue_facts ${key}.website "${spec.website}" is a tier-4 aggregator host. ADR-14 bars an aggregator from a user-facing column — the workbook path already strips exactly this — so it may live in evidence/provenance but never here.`)
        }
      }
      const fromUrl = v.website
      if (fromUrl !== spec.website) {
        v.website = spec.website
        verifiedFactsApplied.push({
          research_key: key, field: 'website',
          from: fromUrl, to: spec.website,
          source_url: spec.source_url ?? null, confidence: spec.confidence ?? null,
          adjudicated_by: spec.adjudicated_by || null, adjudicated_on: spec.adjudicated_on || null,
          overrides_workbook: true,
          reason: spec.website_reason,
        })
        notes.push(`${key}: website ${JSON.stringify(fromUrl)} -> ${JSON.stringify(spec.website)} by adjudication — ${spec.website_reason}`)
      }
    }

    // The slug is generated from the name, so a name correction must regenerate it or the row keeps a
    // slug describing the old name. Safe here because an overridden row has not been published.
    if (spec.fields?.name && 'value' in spec.fields.name) {
      const wasSlug = v.slug
      v.slug = directorySlug({ name: v.name.value, city: v.city, state: v.state })
      if (v.slug !== wasSlug) {
        notes.push(`${key}: name corrected, slug regenerated "${wasSlug}" -> "${v.slug}".`)
        v.name.workbook_name = v.name.workbook_name ?? undefined
      }
    }
  }

  // ---- an address correction must be RE-GEOCODED, or the row keeps the wrong address's coordinate -
  // A venue_facts `address` override exists for exactly one reason: the workbook put the wrong street
  // on the venue. The coordinate derived from that street is wrong by construction. New Haven's
  // wood-center carried the Senior Center's "4 Meetinghouse Ln" (it came from the town's booking app,
  // which lists one municipal address for everything) and geocoded onto the identical house-number
  // node as wood-gym — 0 m apart, which reads as a duplicate and aborted the whole metro. Re-asking
  // OSM with the corrected street is the fix; allow-listing the pair would have enshrined the defect.
  //
  // This changes WHICH QUERY WE ASK, never what we assert — the same principle as the same-site name
  // pass above. Where the sources disagree on a house number, the override carries the street ALONE
  // (never invent an address): the structured rung then has no number to match, so the precision
  // rules judge the result honestly, a street band scores `low`, and the publish gate holds the row.
  // That is the correct outcome, not a problem to engineer around.
  //
  // A re-geocode that returns nothing CLEARS the coordinate rather than keeping the old one. The old
  // one is not merely imprecise, it is the coordinate of a different address we have just established
  // is not this venue's.
  const addressOverrides = verifiedFactsApplied.filter((f) => f.field === 'address' && f.to !== '(value unchanged)')
  if (geocode && addressOverrides.length) {
    log(`\naddress overrides: re-geocoding ${addressOverrides.length} venue(s) against the corrected address`)
    for (const f of addressOverrides) {
      const v = venues.find((x) => x.research_key === f.research_key)
      const before = v.coordinates
      const hit = await geocodeVenue({ name: v.name.value, address: v.address.value, city: v.city, state: v.state, zip: v.zip }, { cachePath, ...net })
      if (!hit) {
        v.coordinates = null
        log(`  x ${f.research_key.padEnd(30)} NO RESULT for "${v.address.value}" — coordinate CLEARED (the previous one came from ${JSON.stringify(f.from)}, which is not this venue's address)`)
        notes.push(`${f.research_key}: address corrected to "${v.address.value}"; no geocode result, so the coordinate derived from the superseded address ${JSON.stringify(f.from)} was cleared. The row cannot publish without a coordinate.`)
        continue
      }
      const moved = before ? Math.round(metresBetween(hit.lat, hit.lng, before.lat, before.lng)) : null
      v.coordinates = {
        lat: hit.lat, lng: hit.lng,
        source_url: hit.source_url,
        precision: hit.precision,
        origin: hit.origin,
        anchor: hit.anchor,
        osm_id: hit.osm_id,
        matched_rung: hit.matched_rung,
        address_override: `re-geocoded against the corrected address "${v.address.value}" (workbook said ${JSON.stringify(f.from)})${moved == null ? '' : `; ${moved} m from the superseded anchor`}`,
      }
      log(`  + ${f.research_key.padEnd(30)} ${hit.precision.padEnd(6)} ${moved == null ? '' : `${moved} m from the superseded anchor`} ${hit.anchor}`)
      notes.push(`${f.research_key}: address corrected to "${v.address.value}" and re-geocoded — ${hit.precision} — ${hit.anchor}`)
    }
    flushCache()
    log(`  live Nominatim requests after the address-override pass: ${liveRequestCount()}`)
  }

  // ---- adopt a known-good coordinate from a NAMED OSM FEATURE -----------------------------------
  // THE GAP THIS CLOSES: nothing in this pipeline could set a coordinate. `venue_facts.fields`
  // throws on anything outside the nine evidence-bearing fields; a workbook coordinate is never a
  // source; and the two coordinate-changing levers cannot be aimed — the address override
  // re-geocodes (useless when OSM carries no house number on the street) and the same-site name pass
  // needs a matching feature name. So where a venue's courts ARE in OSM as a named feature the query
  // ladder cannot reach, the pipeline published the street band and had no way to say otherwise.
  // Orlando's AdventHealth complex is the worked case: a 14-court flagship pinned 407 m away on
  // "Central Winds Parkway" at precision `low`, while OSM carried the courts themselves as
  // `leisure/pitch way/1165951096 "Central Winds Pickleball Courts"` at the venue's own house number.
  //
  // THE CONFIG STATES AN IDENTIFIER, NEVER A COORDINATE. That is the whole safety argument and it is
  // what separates this from the two routes the codebase already disowns. A hand-edited artifact is
  // silently undone by the next rebuild; a hand-written geocode-cache entry is fabrication. Naming an
  // OSM feature is neither: the number still comes from OSM, through the same endpoint, User-Agent,
  // spacing, retry ladder and cache as every other coordinate in the corpus.
  //
  // PRECISION IS CLASSIFIED, NOT ASSERTED. The hit goes through the untouched `classifyPrecision`, so
  // an adoption cannot smuggle a street band past the ADR-16 approximate-location label by declaring
  // it `high`. AdventHealth reaches `high` on its own merits (house number 1000 == 1000, and
  // nameOverlap ties "Central Winds Pickleball Courts" to the venue's own name); a feature that did
  // not would keep its honest label.
  //
  // FOUR GUARDS, ALL FAILING CLOSED. There is no acknowledgement flag and no per-metro override for
  // any of them — a rejection holds the row, which is the safe direction:
  //   1. `osm_id` must be a well-formed OSM feature id, and `/lookup` must return EXACTLY one feature
  //      (both enforced in lookupOsmFeature).
  //   2. CROSS-CHECK: the resolved point must sit within ADOPT_CROSSCHECK_MAX_M of the `expect_lat` /
  //      `expect_lng` recorded at adjudication. This is the same posture as workbook_crosscheck — the
  //      stored number is re-derived, never trusted. A breach means the feature was redrawn or the id
  //      is wrong, so the fix is to re-adjudicate, NOT to widen the tolerance.
  //   3. ANCHOR GUARD: the adopted feature must sit within ADOPT_ANCHOR_MAX_M of the coordinate the
  //      ladder already produced. Same question, same evidence and same magnitude as the same-site
  //      name pass's guard — "is this named feature the same site?" — against the same trap (Koons
  //      Park, a confident exact name match 14 km away in another township).
  //   4. AN ANCHOR IS REQUIRED. A venue with no coordinate has nothing to measure against, so
  //      adoption refuses rather than accepting an unguarded feature id. That is the same posture the
  //      township rung takes when no locus resolves ("an unguarded bare-name query is never issued").
  //      It is also the honest admission that the un-geocoded case needs its own slice.
  //
  // Runs LAST of the three coordinate passes on purpose: an adjudication naming a specific OSM
  // feature is the most specific statement anyone can make about where a venue is, so it must not be
  // overwritten by a rung, a name query or an address correction.
  const adoptions = []
  for (const [key, spec] of Object.entries(config.venue_facts || {})) {
    if (!spec.coordinate) continue
    const where = `venue_facts ${key}.coordinate`
    const v = venues.find((x) => x.research_key === key)
    if (!v) throw new Error(`${where} names a venue this workbook does not contain — stale config, aborting.`)
    for (const k of ['osm_id', 'expect_lat', 'expect_lng', 'evidence_url', 'reason']) {
      if (spec.coordinate[k] == null || spec.coordinate[k] === '') {
        throw new Error(`${where} is missing "${k}" — adopting a coordinate rewrites where a venue appears on a public map, so it must carry the feature it came from, the value adjudicated, the evidence and the reason.`)
      }
    }
    // Mandatory HERE rather than at the spec level generally: the existing field/website/status
    // overrides tolerate an unrecorded adjudicator, and tightening those retroactively would break
    // every config written before this rule (the lesson the `reconciles` evidence_url tightening
    // taught on Little Rock). A `coordinate` node is new, so it can carry the stricter bar from
    // birth without touching a single existing config.
    for (const k of ['adjudicated_by', 'adjudicated_on']) {
      if (!spec[k]) throw new Error(`${where} requires "${k}" on the venue_facts entry — an undocumented coordinate adoption is an unattributable pin on a public map.`)
    }
    adoptions.push({ key, spec, v })
  }
  if (geocode && adoptions.length) {
    log(`\ncoordinate adoption: resolving ${adoptions.length} adjudicated OSM feature(s) via /lookup (cross-check <= ${ADOPT_CROSSCHECK_MAX_M} m, anchor guard <= ${ADOPT_ANCHOR_MAX_M} m)`)
    for (const { key, spec, v } of adoptions) {
      const where = `venue_facts ${key}.coordinate`
      const c = spec.coordinate
      const before = v.coordinates
      if (!before || before.lat == null) {
        throw new Error(`${where} cannot be applied: ${key} has NO coordinate for the adopted feature to be guarded against. Adoption is anchored — it accepts a feature only within ${ADOPT_ANCHOR_MAX_M} m of the coordinate the ladder already produced, and with no anchor there is nothing to measure. Resolve the venue's own coordinate first, or leave the row held.`)
      }
      const hit = await lookupOsmFeature(c.osm_id, {
        venueName: v.name.value,
        wantHouseNumber: houseNumberOf(v.address?.value),
        cachePath,
        ...net,
      })
      if (!hit) throw new Error(`${where}: OSM has no feature ${c.osm_id}. It may have been deleted or renumbered — re-adjudicate against the current map rather than keeping a dangling id.`)

      const crosscheck = Math.round(metresBetween(hit.lat, hit.lng, c.expect_lat, c.expect_lng))
      if (crosscheck > ADOPT_CROSSCHECK_MAX_M) {
        throw new Error(`${where}: ${c.osm_id} now resolves ${crosscheck} m from the adjudicated point (${c.expect_lat},${c.expect_lng}) — limit ${ADOPT_CROSSCHECK_MAX_M} m. The OSM feature was moved or redrawn since ${spec.adjudicated_on}. Re-adjudicate and update expect_lat/expect_lng; do NOT widen the tolerance.`)
      }
      const moved = Math.round(metresBetween(hit.lat, hit.lng, before.lat, before.lng))
      if (moved > ADOPT_ANCHOR_MAX_M) {
        throw new Error(`${where}: ${c.osm_id} sits ${moved} m from ${key}'s own anchor (${before.anchor}) — limit ${ADOPT_ANCHOR_MAX_M} m. A feature that far away is a different place, which is exactly the failure an exact name match cannot catch (the Koons Park trap). Verify the id names THIS venue's courts.`)
      }

      // The reconcile target's id, when this venue has one, recorded as a CROSS-CHECK rather than
      // enforced as a constraint. A match is real corroboration — the row already knows which OSM
      // feature it reconciled onto, and adopting that same feature's coordinate is the coherent case
      // (AdventHealth). A MISMATCH is legitimate too: the courts can be a distinct OSM feature from
      // the reconcile target (the Huntsville Town Madison shape, an indoor polygon and its outdoor
      // court pad), and such a feature often has no facility_listings row at all, so `also_at_site`
      // — which requires a listing_id — cannot name it. Making a mismatch fatal would block a correct
      // adjudication; making a match an implicit default would adopt coordinates nobody adjudicated.
      // So it is recorded, reported, and left to the reader.
      const recTarget = (config.reconciles || []).find((r) => r.candidate_key === key)?.osm_id ?? null
      const matchesReconcile = recTarget == null ? null : recTarget === c.osm_id

      v.coordinates = {
        lat: hit.lat, lng: hit.lng,
        source_url: hit.source_url,
        precision: hit.precision,
        origin: hit.origin,
        anchor: hit.anchor,
        osm_id: hit.osm_id,
        matched_rung: hit.matched_rung,
        adopted_from: {
          osm_id: c.osm_id,
          osm_feature_name: hit.matched_name,
          evidence_url: c.evidence_url,
          reason: c.reason,
          adjudicated_by: spec.adjudicated_by,
          adjudicated_on: spec.adjudicated_on,
          expect_lat: c.expect_lat,
          expect_lng: c.expect_lng,
          crosscheck_delta_m: crosscheck,
          moved_m: moved,
          superseded: { lat: before.lat, lng: before.lng, precision: before.precision, anchor: before.anchor },
          reconcile_target_osm_id: recTarget,
          matches_reconcile_target: matchesReconcile,
          licence: hit.licence,
        },
        // A crosscheck computed against the SUPERSEDED coordinate would describe a distance that no
        // longer exists. Nulled exactly as the same-site name pass nulls it.
        ...(before.workbook_crosscheck ? { workbook_crosscheck: null } : {}),
      }
      log(`  + ${key.padEnd(30)} ${hit.precision.padEnd(6)} adopted ${c.osm_id} "${hit.matched_name}" — ${moved} m from the superseded anchor, cross-check ${crosscheck} m`)
      log(`      superseded: ${before.precision} — ${before.anchor}`)
      if (matchesReconcile === true) log(`      corroboration: this is the SAME OSM feature ${key} reconciles onto (${recTarget})`)
      if (matchesReconcile === false) log(`      REVIEW: ${key} reconciles onto ${recTarget} but adopts ${c.osm_id} — legitimate only if the courts are a different OSM feature from the reconcile target`)
      verifiedFactsApplied.push({
        research_key: key, field: 'coordinate',
        from: `${before.lat},${before.lng} (${before.precision})`,
        to: `${hit.lat},${hit.lng} (${hit.precision})`,
        source_url: c.evidence_url, confidence: spec.confidence ?? null,
        adjudicated_by: spec.adjudicated_by, adjudicated_on: spec.adjudicated_on,
        overrides_workbook: true,
        reason: c.reason,
      })
      notes.push(`${key}: coordinate adopted from OSM ${c.osm_id} ("${hit.matched_name}") — ${before.precision} -> ${hit.precision}, ${moved} m from the superseded anchor. ${c.reason}`)
    }
    flushCache()
    log(`  live Nominatim requests after the adoption pass: ${liveRequestCount()}`)
  } else if (adoptions.length) {
    log(`\ncoordinate adoption: ${adoptions.length} entr(y/ies) configured but SKIPPED — this run is --no-geocode, so no feature was resolved and no coordinate was changed.`)
  }

  // ---- strip the scratch node and emit ---------------------------------------------------------
  const dist = venues.reduce((a, v) => (a[v.research_status] = (a[v.research_status] || 0) + 1, a), {})
  const precisionDist = venues.reduce((a, v) => (a[String(v.coordinates?.precision)] = (a[String(v.coordinates?.precision)] || 0) + 1, a), {})

  const adapterNotes = {
    generation: `${gen.id} — ${gen.label}`,
    ...(gen.tab_overrides ? { tab_overrides: gen.tab_overrides } : {}),
    ...(metroLabels.length ? { metro_area_workbook_labels: metroLabels, metro_area_stored: config.metro_area } : {}),
    ...(columnAliasesApplied.length ? { column_aliases: columnAliasesApplied } : {}),
    // Two URL columns on the primary tab, split into the two facts they actually state. OMITTED
    // when nothing collided, so the 26 single-URL-column metros gain no key and stay byte-identical.
    ...(urlSplit ? { url_column_split: urlSplit } : {}),
    // The presence-gated map, NOT the generation's declaration — this node records what was read,
    // and a workbook without the column had nothing read from it.
    ...(Object.keys(boolColumns).length ? { boolean_columns_read: boolColumns } : {}),
    ...(indoorCrosschecks.length ? { indoor_boolean_crosschecks: indoorCrosschecks } : {}),
    ...(gen.address_source_default ? {
      address_source_default: {
        value: gen.address_source_default,
        reason: `${gen.address_source_default_from_config ? `this workbook leaves address_source blank (no column, or a blank cell) and the metro config supplies the fallback` : `this generation has no address_source column`}; "${gen.address_source_default}" is the weaker true claim (the address came from directory research). "official_page" would assert the address was taken off the controlling entity's own page, which the workbook nowhere states. A per-row value, where one exists, always wins.`,
        ...(gen.address_source_default_from_config ? { from: 'metro config workbook.address_source_default' } : {}),
      },
    } : {}),
    ...(settingCrosschecks.length ? { setting_crosschecks: settingCrosschecks } : {}),
  }
  const adapterActive = Object.keys(adapterNotes).length > 1

  const doc = {
    batch: config.batch,
    metro: config.metro_area,
    state: config.states.join('/'),
    msa: config.msa || null,
    updated: new Date().toISOString().slice(0, 10),
    method: 'directory_research',
    source: describeSource(config, gen),
    // What the generation adapter did beyond the baseline. OMITTED ENTIRELY when it did nothing
    // (generation A), which is what lets the 20 already-projected metros stay byte-identical and so
    // makes "the adapter changed no existing metro" a machine check rather than a promise.
    ...(adapterActive ? { workbook_adapter: adapterNotes } : {}),
    // How many EVIDENCE rows this extraction actually read, and how many venues they covered.
    // OMITTED ENTIRELY when the tab yielded nothing, so the 28 metros whose dumps carry no evidence
    // tab gain no key and stay byte-identical by construction. It exists because the failure this
    // slice fixed was SILENT: a tab with 62 grid rows parsed to 0 and nothing downstream could tell
    // that apart from a workbook that simply cites no per-field evidence. A run log scrolls away;
    // the artifact does not.
    ...(evidenceTab.rows.length ? { evidence_rows: { rows: evidenceTab.rows.length, venues_covered: evidenceByKey.size, tab: gen.evidence_tab } } : {}),
    note: 'Research working data. Gitignored, never republished. Input to scripts/import-metro-merged.mjs.',
    envelope: config.envelope,
    expected_status_dist: dist,
    counts: { total: venues.length, insert: venues.length - (config.reconciles?.length || 0), reconcile_update: config.reconciles?.length || 0 },
    coordinate_method: `EVERY coordinate independently geocoded via Nominatim (OpenStreetMap), >=1.1s spacing, descriptive User-Agent. No Google or Places call was made (ADR-12). All coordinates are OSM-derived, so every row carries the ODbL marker; attribution is mounted in components/features/directory/OsmAttribution.tsx.`,
    workbook_coordinate_warning: 'A workbook coordinate is NEVER used as a source. Where the workbook carried a usable pair it is recorded per venue as coordinate.workbook_crosscheck with its distance from the independently geocoded value, and the importer re-derives that distance rather than trusting it.',
    precision_ladder: {
      high: 'exact house-number match, or a named leisure/amenity/building feature that is the venue itself',
      medium: 'correct site, but the anchor is a containing or neighbouring feature / a large polygon centroid, carrying no name of its own or a name that ties to the venue',
      low: 'street band or city centroid only, OR an anchor that names a materially different entity than the venue — blocked by the publish gate until re-geocoded',
    },
    precision_distribution: precisionDist,
    enum_mappings_applied: mappingsApplied,
    // Workbook bugs: a value sitting in the wrong column. Field nulled, value NOT relocated.
    // Every instance is listed here so the workbooks can be fixed at source.
    contamination: contaminations,
    // Prose found in an enum column, with the branch taken and the verbatim original.
    prose_resolutions: proseResolutions,
    // Boolean cells whose raw string carried more than true/false could hold. Omitted when empty so
    // no artifact gains a key for something that did not happen.
    ...(booleanQualifiers.length ? { boolean_qualifiers: booleanQualifiers } : {}),
    // Facts asserted from a controlling-entity source rather than from the workbook, each with its
    // own source URL, confidence and adjudication date.
    verified_facts_applied: verifiedFactsApplied,
    extraction_notes: notes,
    slug_policy: 'Slugs are GENERATED as <name>-<city>-<state>, matching every published row. The workbook slug column holds a research key and is retained per venue in _workbook.slug only.',
    venues,
  }
  return doc
}

// =============================================================================================
// CLI
// =============================================================================================
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => {
    const a = process.argv.find((x) => x.startsWith(`--${n}=`))
    return a ? a.split('=').slice(1).join('=') : null
  }
  const metro = arg('metro')
  if (!metro) { console.error('Pass --metro=<name> (reads scripts/metros/<name>.json)'); process.exit(1) }
  const config = JSON.parse(readFileSync(`scripts/metros/${metro}.json`, 'utf8'))
  const raw = arg('raw')
  const csvDir = arg('csv-dir')
  if (!raw && !csvDir) { console.error('Pass --raw=<tab-dump.json> or --csv-dir=<dir of tab CSVs>'); process.exit(1) }
  const out = arg('out') || config.input
  const geocode = !process.argv.includes('--no-geocode')

  console.log(`\n=== workbook-extract · metro=${metro} · ${geocode ? 'geocoding' : 'NO GEOCODE (shape check only)'} ===`)
  const tabs = loadTabs({ raw, csvDir })
  console.log(`tabs: ${Object.keys(tabs).join(', ')}`)

  // ONE CACHE FILE PER METRO. `config.geocode_cache` supplies the DIRECTORY (every config already
  // points at the same one); the basename comes from the metro key, so two concurrent extracts write
  // two different files instead of racing to overwrite one. Entries from before the split are still
  // served — geocode-nominatim.mjs seeds from the legacy shared files, read-only.
  const cachePath = geocodeCachePath(metro, config.geocode_cache)
  const doc = await extractWorkbook({ tabs, config, geocode, cachePath })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(doc, null, 1))
  console.log(`\nwrote ${doc.venues.length} venue(s) -> ${out}`)
  console.log(`research_status: ${JSON.stringify(doc.expected_status_dist)}`)
  console.log(`coordinate precision: ${JSON.stringify(doc.precision_distribution)}`)
  console.log(`enum mappings applied: ${Object.keys(doc.enum_mappings_applied).length}`)
  Object.entries(doc.enum_mappings_applied).forEach(([k, v]) => console.log(`  ${k} -> ${v}`))
  if (doc.contamination.length) {
    console.log(`\nCONTAMINATION — value in the wrong column (${doc.contamination.length}); field nulled, value NOT relocated:`)
    doc.contamination.forEach((c) => console.log(`  ! ${c.research_key}: ${c.field}="${c.raw}" belongs to ${c.belongs_to.join('/')}`))
  }
  if (doc.prose_resolutions.length) {
    console.log(`\nPROSE in enum columns (${doc.prose_resolutions.length}); original preserved verbatim in public_notes + provenance:`)
    doc.prose_resolutions.forEach((p) => console.log(`  ~ ${p.research_key}: ${p.field}="${p.raw}" -> ${p.resolved} [${p.branch}]`))
  }
  if (doc.verified_facts_applied.length) {
    console.log(`\nVERIFIED FACTS applied from adjudication (${doc.verified_facts_applied.length}); each carries its own source + confidence into provenance:`)
    doc.verified_facts_applied.forEach((f) => console.log(`  * ${f.research_key}.${f.field}: ${JSON.stringify(f.from)} -> ${JSON.stringify(f.to)}${f.overrides_workbook ? ' [OVERRIDES WORKBOOK]' : ''} | ${f.source_url || 'no url'} | ${f.confidence || 'no confidence'}`))
  }
  if (doc.extraction_notes.length) {
    console.log(`\nextraction notes (${doc.extraction_notes.length}):`)
    doc.extraction_notes.forEach((n) => console.log(`  - ${n}`))
  }

  // An extract is the moment new irreplaceable data exists on disk: `<metro>/tabs.json` is a verbatim
  // workbook dump that cannot be regenerated from anything in this repo. Backing up here rather than
  // at publish time is deliberate — publish is far too late, and on 2026-08-03 a wipe cost the
  // Colorado Springs artifacts precisely because the backup step was a manual line in a README.
  //
  // It COMMITS but does NOT push: a push is an external send to a second repo and ADR-10 covers
  // Joinzer only. The backup module explains the split and prints the pending-push count.
  //
  // Only paths THIS run authored are passed, and the module stages nothing else — a previous version
  // ran `git add -A` here and swept another metro's work into a commit (research repo cb79409).
  // `cachePath` is included so that if the research repo ever stops ignoring `.geocode-cache/`, the
  // cache is carried automatically; while it is ignored this costs exactly nothing. `csvDir` is
  // deliberately NOT passed: it is a directory, the staging rules match files, and the irreplaceable
  // input is `tabs.json` via --raw. A changed file under it surfaces in the "did not author" report.
  //
  // Best-effort and NEVER fatal: a git failure must not fail an extract that already succeeded. The
  // dynamic import keeps the backup module out of the graph for library consumers of this file
  // (import-metro-merged.mjs imports it), since only the CLI path needs it.
  if (!process.argv.includes('--no-backup')) {
    try {
      const { backupMetroResearch, reportBackup } = await import('./backup-metro-research.mjs')
      reportBackup(backupMetroResearch({ metro, artifacts: [out, raw, cachePath], label: `${metro} extract` }))
    } catch (err) {
      console.log(`\nmetro-research backup: SKIPPED — ${err.message}`)
    }
  }
}

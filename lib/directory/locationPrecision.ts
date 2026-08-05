/**
 * The approximate-location label (ADR-16, owner 2026-08-04).
 *
 * A `low`-precision coordinate publishes, rather than holding the row back as it did under the
 * 2026-07-28 rule. The condition of that ruling is that the reader is TOLD — a published pin we know
 * to be a street band, presented as if it were the building, is the harmful version of this change.
 *
 * WHY PLAIN TEXT AND NOT AN ICON OR A COLOURED CHIP. Three reasons, in order of weight:
 *   1. it cannot fail the "never convey meaning by colour alone" rule, because it conveys nothing by
 *      colour — a sighted reader, a screen-reader user and a monochrome print all get one sentence;
 *   2. semantic HTML before ARIA (Web Interface Guidelines) — a sentence needs no aria-label, no
 *      role, no visually-hidden twin, and no icon needs aria-hidden;
 *   3. an icon or a badge asks the reader to learn a legend. The fact here is genuinely a sentence
 *      ("we know the street, not the building"), and compressing it into a glyph loses the part that
 *      makes it actionable.
 *
 * The wording is deliberately about OUR data rather than the venue: "we have this venue's street but
 * not its exact building" says the courts exist and we are unsure of the pin. "Location approximate"
 * alone reads, to some, as though the venue itself is doubtful.
 */

/** The precision value meaning "street band, not the building". Mirrors APPROXIMATE_PRECISION in
 *  scripts/lib/publish-gate.mjs — the scripts are plain ESM and are not imported by the app, so the
 *  constant is stated in both places rather than shared across that boundary. Pinned by a unit test
 *  asserting the two strings agree, so the duplication cannot drift silently. */
export const APPROXIMATE_PRECISION = 'low'

/** Does this row's pin need the approximate-location treatment? */
export function isApproximateLocation(locationPrecision: string | null | undefined): boolean {
  return locationPrecision === APPROXIMATE_PRECISION
}

/** Full sentence for the venue detail page, shown next to the address and the map link. */
export const APPROXIMATE_LOCATION_DETAIL =
  'Approximate location — we have this venue’s street but not its exact building, so the map pin may be off by a block or two.'

/** Compact form for list rows, where a full sentence would swamp the venue name. Still a phrase
 *  rather than a glyph, for the reasons in the header. */
export const APPROXIMATE_LOCATION_SHORT = 'Approximate location'

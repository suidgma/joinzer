/**
 * Access-type labels (ADR-17, owner 2026-08-05).
 *
 * WHY THIS IS A MODULE AND NOT TWO INLINE OBJECTS. Under the old publish gate `access_type='unknown'`
 * HELD THE ROW, so the label for it was unreachable decoration — the list rows mapped it to `''` and
 * the venue page to "Access varies", and the two disagreeing cost nothing because neither rendered.
 * Coverage-first publishes those rows: 378 drafts carry `unknown`, and many public park courts will
 * never have a source that states access. The label is now the only thing telling a reader we do not
 * know, so the two surfaces have to agree and the wording has to be tested.
 *
 * WHY THE WORDING IS ABOUT US, NOT THE VENUE. "Access varies" asserts something about the place —
 * that its rules change. The true statement is about our data: we did not find a source. The owner's
 * wording says that and tells the reader what to do about it.
 *
 * WHY TWO FORMS. Same split as the approximate-location label in locationPrecision.ts. The venue page
 * has room for the call to action and is where someone decides whether to drive somewhere; a list row
 * renders this in a right-aligned text-xs column beside up to two other chips, where the full
 * sentence would push the useful facts out of view.
 */

/** The full wording, for the venue detail page. Carries the call to action. */
export const ACCESS_UNKNOWN_DETAIL = 'Access unknown — call ahead'

/** The compact form, for list rows. Still a phrase rather than a glyph. */
export const ACCESS_UNKNOWN_SHORT = 'Access unknown'

/**
 * The stored `access_type` vocabulary, pinned by a CHECK constraint on facility_listings.
 * `unknown` is a STORED value meaning "researched, undetermined" — NOT the same as NULL, which means
 * "not yet researched". Only the former gets a label; see the null case in `accessLabel`.
 */
const AFFIRMATIVE: Record<string, string> = {
  public: 'Public',
  private: 'Private',
  membership: 'Membership',
  school: 'School',
  hoa: 'HOA',
}

/**
 * The label to render, or `null` for "render nothing".
 *
 * Returns null for NULL/absent/unrecognized values rather than a placeholder. A row that was never
 * researched must not claim we researched it and came up empty — that is a different, weaker
 * statement than `unknown`, and conflating them would overstate our coverage. An unrecognized value
 * (a future vocabulary entry that reached the database before this map) also renders nothing rather
 * than the string "undefined".
 */
export function accessLabel(
  accessType: string | null | undefined,
  variant: 'detail' | 'short',
): string | null {
  if (!accessType) return null
  if (accessType === 'unknown') return variant === 'detail' ? ACCESS_UNKNOWN_DETAIL : ACCESS_UNKNOWN_SHORT
  return AFFIRMATIVE[accessType] ?? null
}

/** Every value `accessLabel` knows about, for tests that pin it against the CHECK vocabulary. */
export const KNOWN_ACCESS_TYPES = [...Object.keys(AFFIRMATIVE), 'unknown']

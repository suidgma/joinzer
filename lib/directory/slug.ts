/**
 * The directory's slug convention, available to the app.
 *
 * WHY THIS FILE EXISTS AS A COPY. `slugify` and `directorySlug` are defined in
 * scripts/lib/workbook-extract.mjs, which is plain ESM under scripts/ — outside tsconfig's
 * `include` and never imported by the app. This is the same boundary lib/directory/
 * locationPrecision.ts describes for APPROXIMATE_PRECISION: the value is stated in both places
 * rather than shared across it, and a unit test pins the two implementations together so the
 * duplication cannot drift silently. See lib/directory/__tests__/slug.test.ts, which imports the
 * .mjs and asserts agreement over a corpus rather than asserting hand-written expectations.
 *
 * DO NOT "improve" the transform here. Two of its steps look incidental and are not:
 *   - `&` → ` and ` runs BEFORE the non-alphanumeric sweep, so "Parks & Rec" becomes
 *     `parks-and-rec`, not `parks-rec`. A hand-rolled slugify that dropped this produced a false
 *     134-vs-130 mismatch when verifying a published metro.
 *   - NFKD + combining-mark strip is what turns "Peña" into `pena` instead of `pe-a`.
 * Any edit must keep the parity test green against the .mjs, which is the definition of record
 * for every slug already in the database.
 */

/** Lowercase, ASCII-fold, and hyphenate a single string. Mirrors workbook-extract.mjs `slugify`. */
export function slugify(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `<name>-<city>-<state>` — the convention shared by every published row. */
export function directorySlug({
  name,
  city,
  state,
}: {
  name?: string | null
  city?: string | null
  state?: string | null
}): string {
  return [slugify(name), slugify(city), String(state || '').toLowerCase()]
    .filter(Boolean)
    .join('-')
}

/**
 * How many numeric suffixes to try before giving up on a readable slug. Matches the `i <= 60`
 * ladder in scripts/publish-az-review.mjs `makeUniqueSlug`, so the app and the importer produce
 * the same shapes for the same collisions.
 */
export const MAX_SLUG_SUFFIX = 60

/**
 * First free slug for `base`, given the set already taken.
 *
 * Returns `base` when it is free, then `base-2` … `base-60`. Past that it appends a random
 * base36 tail rather than widening the ladder: sixty collisions on one venue name in one city
 * means something is wrong upstream, and an unbounded scan would turn that into a slow query
 * instead of a visible oddity.
 *
 * PURE ON PURPOSE — `taken` is supplied by the caller, so this is unit-testable without a
 * database and the caller decides how the set was read. It does NOT make the slug safe against a
 * concurrent insert; `facility_listings.slug` is `unique not null` and check-then-insert is a
 * time-of-check/time-of-use window. The caller must still handle a 23505 on the insert. See
 * lib/locations/createFacilityListing.ts.
 */
export function nextAvailableSlug(base: string, taken: ReadonlySet<string>): string {
  if (!base) throw new Error('nextAvailableSlug: base slug is empty')
  if (!taken.has(base)) return base
  for (let i = 2; i <= MAX_SLUG_SUFFIX; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${randomSlugTail()}`
}

/** 8 chars of base36. Collision-proof in practice for a tie-break that should never be reached. */
export function randomSlugTail(): string {
  let out = ''
  while (out.length < 8) out += Math.random().toString(36).slice(2)
  return out.slice(0, 8)
}

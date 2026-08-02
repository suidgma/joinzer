// Turning facility_listings.public_notes into something safe to render on /courts/[slug].
//
// public_notes is NOT a single operator-authored field. scripts/lib/workbook-extract.mjs builds it
// by concatenating up to three things with ' | ':
//
//   [ the research workbook's own public_notes prose,
//     ...enum values that could not be mapped, rendered as `${field.replace(/_/g,' ')}: ${raw}`,
//     ...boolean qualifiers that could not be represented, in the same `field: raw` shape ]
//
// The first element is prose written for a reader. The rest are machine-appended raw workbook
// values, preserved so a fact is never silently discarded — valuable in the database, but they read
// as a debug dump on a public page ("fee type: paid reservation | reservation policy: reservation
// optional / programmed blocks"), and some of them contradict the structured chips that
// app/courts/[slug]/page.tsx already renders from the typed columns.
//
// So: keep segment 0, drop the machine tail. Measured against production on 2026-08-01, over the
// 530 published rows carrying non-empty public_notes —
//   87  segment 0 is ITSELF a `field: raw` pair (the row has no prose at all) -> render nothing
//    6  segment 0 leaks database internals ("...leave court_count null")      -> render nothing
//    2  segment 0 is a bare fragment ("Resort")                               -> render nothing
//  435  segment 0 is real visitor prose                                       -> render
//
// This is a PRESENTATION filter over data we do not modify. The upstream concatenation and the 6
// leaky strings are both real defects with their own fixes; neither is this module's business.
// Nothing here writes, and every rule fails CLOSED — an unrecognized shape renders nothing rather
// than risking a machine string on a public page.

/**
 * A machine-appended `field: raw` pair.
 *
 * The label is always `field.replace(/_/g, ' ')` where `field` is a lowercase snake_case column
 * name, so it is always lowercase words then a colon. Prose written for a reader starts with a
 * capital. Testing the SHAPE rather than an explicit label list means a workbook that produces a
 * field we have never seen is still caught — verified equivalent to the explicit list of the nine
 * labels live today (surface, fee type, reservation policy, court configuration, access type, net
 * setup, line type, lighting, indoor) across all 530 rows, with zero disagreements.
 */
const MACHINE_FIELD_PAIR = /^[a-z][a-z ]*:/

/**
 * Research-desk language that names our own schema or workflow. These are grammatical English, so
 * nothing else catches them — they simply are not addressed to a visitor.
 *
 * The honest fix is correcting the 6 strings in the database; that is a write, and writes are not
 * in this slice. Suppressing them here is reversible and costs 6 venues their prose in the interim.
 */
const INTERNAL_LANGUAGE =
  /court_count|remains? (?:null|blank)|leaves? [a-z_ ]*null|for recheck|unsupported [a-z ]*fields/i

/**
 * Below this, a "note" is a fragment rather than a sentence and reads as broken UI. The live floor
 * is `Resort` (6 chars, two Las Vegas rows); the shortest genuine note is 26.
 */
const MIN_USEFUL_LENGTH = 20

/**
 * The visitor-facing prose in a public_notes value, or null if the row has none.
 *
 * Null means "render nothing here" — never an empty string, so callers can use a plain truthiness
 * check and JSX renders no empty paragraph.
 */
export function visitorNotes(raw: string | null | undefined): string | null {
  if (!raw) return null

  const prose = raw.split('|')[0].trim()

  if (!prose) return null
  if (MACHINE_FIELD_PAIR.test(prose)) return null
  if (INTERNAL_LANGUAGE.test(prose)) return null
  if (prose.length < MIN_USEFUL_LENGTH) return null

  return prose
}

/**
 * `visitorNotes` trimmed to fit a meta description, cut on a word boundary.
 *
 * Google renders roughly 155-160 characters, and a hard slice mid-word looks broken in a SERP. The
 * previous behaviour here was `.slice(0, 200)` against enrichment.description, which only ever ran
 * on 13 rows; feeding public_notes in makes truncation common rather than theoretical (p90 length
 * is 315), so the boundary matters now.
 *
 * Returns null for null input so callers can chain fallbacks with `??`.
 */
export function metaDescription(text: string | null | undefined, limit = 155): string | null {
  if (!text) return null
  if (text.length <= limit) return text

  // Reserve one character for the ellipsis so the result never exceeds `limit`.
  const clipped = text.slice(0, limit - 1)
  const lastSpace = clipped.lastIndexOf(' ')

  // A single word longer than the limit has no boundary to cut on — take the hard slice rather than
  // returning nothing. Guarded at half the limit so we never emit a one-word stub.
  const body = lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped

  return `${body.replace(/[\s,;:.—-]+$/, '')}…`
}

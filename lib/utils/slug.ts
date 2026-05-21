/**
 * Converts an entity name to a URL-safe filename slug.
 *
 * Rules:
 * - Apostrophes (straight + curly) are stripped so "Men's" → "mens"
 * - Non-ASCII letters pass through (é, ü, etc.) — modern OSes handle them
 * - Other symbols and punctuation become spaces → collapse to hyphens
 * - Periods are treated as separators ("3.5" → "3-5")
 * - Hard cap at 50 chars, trimmed at the nearest word boundary
 */
export function toFilenameSlug(name: string, maxLen = 50): string {
  const slug = name
    .toLowerCase()
    .replace(/['']/g, '')              // strip apostrophes (straight + curly) — no word split
    .replace(/[^\p{L}\p{N}\-\s]/gu, ' ') // remaining symbols/punctuation → space
    .replace(/[\s-]+/g, '-')           // collapse whitespace + multi-hyphens → single hyphen
    .replace(/^-+|-+$/g, '')           // trim leading/trailing hyphens

  if (slug.length <= maxLen) return slug

  const truncated = slug.slice(0, maxLen)
  const lastHyphen = truncated.lastIndexOf('-')
  return lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated
}

/**
 * Returns a safe .ics filename for a tournament or league.
 * Falls back to joinzer-{suffix}.ics when name is null, empty, or
 * reduces to empty after slugging (e.g. name was "!!!").
 *
 * Examples:
 *   icsFilename("Vegas Open 2026", "tournament")   → "vegas-open-2026-tournament.ics"
 *   icsFilename("Tuesday Night Doubles", "league") → "tuesday-night-doubles-league.ics"
 *   icsFilename("Pro Men's Division!", "tournament") → "pro-mens-division-tournament.ics"
 *   icsFilename("3.5 Mixed Doubles", "tournament") → "3-5-mixed-doubles-tournament.ics"
 *   icsFilename(null, "league")                    → "joinzer-league.ics"
 */
export function icsFilename(
  name: string | null | undefined,
  suffix: 'league' | 'tournament' | 'event',
): string {
  const slug = name?.trim() ? toFilenameSlug(name.trim()) : ''
  return slug ? `${slug}-${suffix}.ics` : `joinzer-${suffix}.ics`
}

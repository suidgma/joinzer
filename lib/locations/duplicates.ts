// Heuristic duplicate detection for venues. A pending (user-added) venue is
// compared against the existing directory so the admin can spot "this is just
// Sunset Park again" before approving a twin. Pure + deterministic — no I/O.
//
// The POST /api/locations dedup only catches an EXACT case-insensitive name
// match; this catches the fuzzy cases it can't: minor spelling/spacing/word
// differences, and venues at (nearly) the same coordinates or ZIP.

export type VenueLike = {
  id: string
  name: string
  address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  lat?: number | null
  lng?: number | null
  status?: string | null
}

export type DuplicateCandidate = {
  id: string
  name: string
  addressLine: string | null
  status: string | null
  score: number
  reasons: string[]
  distanceMeters: number | null
  nameSimilarity: number
}

// Common venue filler words — stripped before both the character- and token-
// level comparisons so "Sunset Park" matches "Sunset Park Pickleball Courts"
// and, crucially, "Court A" does NOT match "Court B" on the shared word "court".
// Kept deliberately tight: real distinguishing words (e.g. "park", "ridge") stay
// so we don't collapse distinct venues together.
const FILLER = new Set([
  'the', 'a', 'at', 'of', 'and',
  'court', 'courts', 'center', 'centre', 'complex', 'club',
  'pickleball', 'tennis', 'rec', 'recreation', 'sports', 'facility',
])

export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function contentTokens(name: string): string[] {
  return normalizeVenueName(name).split(' ').filter((t) => t && !FILLER.has(t))
}

function contentString(name: string): string {
  return contentTokens(name).join(' ')
}

function normalizeZip(zip?: string | null): string | null {
  if (!zip) return null
  const z = zip.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return z || null
}

function bigrams(s: string): Map<string, number> {
  const compact = s.replace(/ /g, '')
  const map = new Map<string, number>()
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2)
    map.set(g, (map.get(g) ?? 0) + 1)
  }
  return map
}

// Sørensen–Dice coefficient over character bigrams (0..1). Robust to small
// spelling/spacing differences. Compares filler-stripped content so shared
// generic words ("court", "tennis") don't inflate the score. An all-generic
// name has no content to compare on → 0 (proximity/ZIP must carry it).
export function diceCoefficient(a: string, b: string): number {
  const na = contentString(a)
  const nb = contentString(b)
  if (na && na === nb) return 1
  const ga = bigrams(na)
  const gb = bigrams(nb)
  let total = 0
  for (const c of ga.values()) total += c
  for (const c of gb.values()) total += c
  if (total === 0) return 0
  let overlap = 0
  for (const [g, count] of ga) {
    const other = gb.get(g)
    if (other) overlap += Math.min(count, other)
  }
  return (2 * overlap) / total
}

// Jaccard over content tokens, ignoring filler words — catches "Sunset Park" vs
// "Sunset Park Pickleball Courts" where Dice is dragged down by the extra words.
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(contentTokens(a))
  const tb = new Set(contentTokens(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

export function nameSimilarity(a: string, b: string): number {
  return Math.max(diceCoefficient(a, b), tokenSimilarity(a, b))
}

// Great-circle distance in meters.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function addressLine(v: VenueLike): string | null {
  const line = [v.address, v.city, v.state, v.zip_code].filter(Boolean).join(', ')
  return line || null
}

export interface DuplicateOptions {
  /** Min name similarity to qualify on name alone. */
  nameThreshold?: number
  /** Max meters to qualify on proximity alone. */
  nearMeters?: number
  /** Max candidates returned per target. */
  limit?: number
}

const NAME_STRONG = 0.85

/**
 * Rank likely duplicates of `target` among `pool` (self excluded by id).
 * A venue qualifies if its name is similar enough, it sits within `nearMeters`,
 * or it shares a ZIP and has at least a weak name overlap.
 */
export function findDuplicateCandidates(
  target: VenueLike,
  pool: VenueLike[],
  opts: DuplicateOptions = {},
): DuplicateCandidate[] {
  const nameThreshold = opts.nameThreshold ?? 0.55
  const nearMeters = opts.nearMeters ?? 300
  const limit = opts.limit ?? 3

  const out: DuplicateCandidate[] = []

  for (const c of pool) {
    if (c.id === target.id) continue

    const sim = nameSimilarity(target.name, c.name)

    const canDistance =
      typeof target.lat === 'number' && typeof target.lng === 'number' &&
      typeof c.lat === 'number' && typeof c.lng === 'number'
    const dist = canDistance
      ? haversineMeters(target.lat as number, target.lng as number, c.lat as number, c.lng as number)
      : null

    const tz = normalizeZip(target.zip_code)
    const cz = normalizeZip(c.zip_code)
    const sameZip = !!tz && tz === cz

    const near = dist !== null && dist <= nearMeters
    const qualifies = sim >= nameThreshold || near || (sameZip && sim >= 0.3)
    if (!qualifies) continue

    const reasons: string[] = []
    if (sim >= NAME_STRONG) reasons.push('Nearly identical name')
    else if (sim >= nameThreshold) reasons.push('Similar name')
    if (near) reasons.push(`${Math.round(dist as number)} m away`)
    if (sameZip) reasons.push('Same ZIP')

    // Confidence: best of name / proximity, nudged up when the ZIP also agrees.
    const proximityScore = dist === null ? 0 : Math.max(0, 1 - dist / nearMeters)
    const score = Math.min(1, Math.max(sim, proximityScore) + (sameZip ? 0.1 : 0))

    out.push({
      id: c.id,
      name: c.name,
      addressLine: addressLine(c),
      status: c.status ?? null,
      score,
      reasons,
      distanceMeters: dist,
      nameSimilarity: sim,
    })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

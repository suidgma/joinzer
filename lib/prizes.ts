// Advertised prizes/awards for an event (tournaments / leagues / play). Display-only —
// Joinzer does not move prize money; organizers describe what players can win and hand
// them out themselves. Stored as a jsonb array on tournaments/leagues/events.prizes.

export type PrizeType = 'cash' | 'trophy' | 'medal' | 'merch' | 'other'

export type Prize = {
  place: string        // "1st Place", "2nd Place", "All participants", …
  description: string  // "$500 cash + trophy"
  type: PrizeType      // drives the icon
}

export const PRIZE_TYPES: { value: PrizeType; icon: string; label: string }[] = [
  { value: 'trophy', icon: '🏆', label: 'Trophy' },
  { value: 'cash', icon: '💵', label: 'Cash' },
  { value: 'medal', icon: '🏅', label: 'Medal' },
  { value: 'merch', icon: '👕', label: 'Merch' },
  { value: 'other', icon: '🎁', label: 'Other' },
]

const VALID_TYPES = new Set(PRIZE_TYPES.map((t) => t.value))

export function prizeIcon(type: string): string {
  return PRIZE_TYPES.find((t) => t.value === type)?.icon ?? '🎁'
}

// Parse the jsonb column into a clean Prize[] — drops malformed/empty rows so display and
// save paths never trip over bad data.
export function normalizePrizes(raw: unknown): Prize[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): Prize | null => {
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      const place = typeof o.place === 'string' ? o.place.trim() : ''
      const description = typeof o.description === 'string' ? o.description.trim() : ''
      if (!place && !description) return null
      const type = (typeof o.type === 'string' && VALID_TYPES.has(o.type as PrizeType) ? o.type : 'other') as PrizeType
      return { place, description, type }
    })
    .filter((p): p is Prize => p !== null)
}

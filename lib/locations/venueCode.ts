// Short code shown on each venue's map pin. A manual `short_code` override wins;
// otherwise derive initials of the significant words, e.g.
// "Sunset Park Pickleball Complex" → "SPPC". Capped at 4 chars.
const FILLER = new Set(['of', 'the', 'and', 'at', 'a', 'an', '&', 'de', 'la', 'el'])

export function autoVenueCode(name: string): string {
  const words = name
    .replace(/[^\w\s&-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter((w) => !FILLER.has(w.toLowerCase()))
  const initials = words.map((w) => w[0].toUpperCase()).join('')
  return (initials || name.replace(/\s+/g, '').toUpperCase()).slice(0, 4)
}

// The code to display: manual override if set, else the auto code.
export function venueCode(name: string, override?: string | null): string {
  const trimmed = override?.trim()
  return trimmed || autoVenueCode(name)
}

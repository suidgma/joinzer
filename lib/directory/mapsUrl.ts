// Derive a Google Maps URL at render time (brief §2.6) — no maps URL is ever stored.
// Uses the place_id for a precise pin when we have one (7 of the Phoenix rows), else lat/lng only.
export function mapsUrl(lat: number | null, lng: number | null, placeId: string | null): string | null {
  if (lat == null || lng == null) return null
  const base = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  return placeId ? `${base}&query_place_id=${encodeURIComponent(placeId)}` : base
}

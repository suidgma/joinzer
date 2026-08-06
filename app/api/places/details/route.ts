import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { consumeQuota } from '@/lib/places/quota'

/**
 * POST /api/places/details — resolve a chosen suggestion into address parts to PRE-FILL the form.
 *
 * WHAT THIS RESPONSE IS FOR, PRECISELY. The address parts returned here are pre-filled into
 * EDITABLE inputs that the user reviews and submits. They are not written to the database from
 * this response, and the fields must never be rendered read-only.
 *
 * That is not a UI preference — it is what makes the stored provenance true. ADR-12 pins
 * `facility_listings.address_source` to six values and states that a Places `formatted_address` is
 * not a storable source. The owner's ruling (2026-08-06) is that a user who reviews and submits
 * the address is asserting it themselves, which is what `'organizer'` means. If the UI ever stops
 * letting them edit, the row's `address_source='organizer'` becomes a false claim. Load-bearing.
 *
 * Sending the same `sessionToken` used for the autocomplete keystrokes is what closes the billing
 * session — the SKUs involved are *Autocomplete Session Usage* and the *Place Details* tiers,
 * selected by field mask. Rates need checking against Google's pricing page; none is quoted here.
 */

/** Narrowest mask that yields the address parts plus the id. `addressComponents` is what lets the
 *  form fill city/state/ZIP separately instead of dumping one formatted string into a field. */
const FIELD_MASK = 'id,addressComponents'

type AddressComponent = { longText?: string; shortText?: string; types?: string[] }

/** Pull one component out by type. `short` for state (NV, not Nevada) and country (US). */
function component(parts: AddressComponent[], type: string, short = false): string {
  const hit = parts.find((p) => p.types?.includes(type))
  if (!hit) return ''
  return (short ? hit.shortText : hit.longText) ?? ''
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return NextResponse.json({ error: 'Address lookup unavailable' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : ''
  const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken.trim() : ''

  if (!placeId) return NextResponse.json({ error: 'placeId is required' }, { status: 400 })
  if (!sessionToken) {
    return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 })
  }

  const { allowed } = consumeQuota(user.id)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Daily address lookup limit reached — please type the address instead.' },
      { status: 429 }
    )
  }

  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
    url.searchParams.set('sessionToken', sessionToken)
    const res = await fetch(url, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
    })
    if (!res.ok) {
      console.error('Places details failed', res.status, (await res.text()).slice(0, 300))
      return NextResponse.json({ error: 'Could not load that address' }, { status: 502 })
    }
    const json = await res.json()
    const parts: AddressComponent[] = json?.addressComponents ?? []

    const streetNumber = component(parts, 'street_number')
    const route = component(parts, 'route')

    return NextResponse.json({
      place_id: typeof json?.id === 'string' ? json.id : placeId,
      address: [streetNumber, route].filter(Boolean).join(' '),
      // `locality` is absent for unincorporated areas; the two fallbacks are what Google returns
      // instead, and a missing city would otherwise cost the row its slug segment and its
      // publish-gate `city` condition.
      city:
        component(parts, 'locality') ||
        component(parts, 'postal_town') ||
        component(parts, 'sublocality_level_1'),
      state: component(parts, 'administrative_area_level_1', true),
      zip_code: component(parts, 'postal_code'),
      country: component(parts, 'country', true) || 'US',
    })
  } catch (e) {
    console.error('Places details threw', e)
    return NextResponse.json({ error: 'Could not load that address' }, { status: 502 })
  }
}

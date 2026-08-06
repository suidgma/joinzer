import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { consumeQuota } from '@/lib/places/quota'

/**
 * POST /api/places/autocomplete — address suggestions for the "add a venue" form.
 *
 * A SERVER PROXY, NOT A BROWSER KEY. `GOOGLE_MAPS_API_KEY` is server-only and unrestricted (five
 * import scripts use it). Publishing it as `NEXT_PUBLIC_*` to let the browser call Places directly
 * would hand an unrestricted key to anyone who loads the page, so the request goes through here
 * and the key never leaves the server.
 *
 * AUTHENTICATED, because this endpoint costs money on every call. Auth is the boundary (ADR-03);
 * the per-user daily cap in lib/places/quota.ts is the spend bound behind it.
 *
 * The narrow field mask is a billing decision as well as a privacy one: the SKU tier is selected
 * by what you ask for. Rates need checking against Google's pricing page — none is quoted here.
 */

/** Below this, suggestions are noise and every keystroke is a billable request. */
const MIN_QUERY_LENGTH = 3

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.GOOGLE_MAPS_API_KEY
  // Not an error the user can act on — the form falls back to typing the address by hand.
  if (!key) return NextResponse.json({ suggestions: [] })

  const body = await req.json().catch(() => ({}))
  const input = typeof body.input === 'string' ? body.input.trim() : ''
  const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken.trim() : ''

  // Refuse a request with no session token. Without one Google bills each keystroke as its own
  // request instead of collapsing the burst into a single session, so this is a cost guard, not a
  // correctness one — which is exactly why it has to be enforced server-side.
  if (!sessionToken) {
    return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 })
  }
  if (input.length < MIN_QUERY_LENGTH) return NextResponse.json({ suggestions: [] })

  const { allowed } = consumeQuota(user.id)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Daily address lookup limit reached — please type the address instead.' },
      { status: 429 }
    )
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['us'],
      }),
    })
    if (!res.ok) {
      console.error('Places autocomplete failed', res.status, (await res.text()).slice(0, 300))
      return NextResponse.json({ suggestions: [] })
    }
    const json = await res.json()
    // Return only what the dropdown renders. Nothing from this response is persisted; the
    // place_id is carried back on submit and everything else is display-only (GMP ToS §3.2.3).
    const suggestions = (json?.suggestions ?? [])
      .map((s: { placePrediction?: { placeId?: string; text?: { text?: string } } }) => ({
        placeId: s.placePrediction?.placeId ?? '',
        description: s.placePrediction?.text?.text ?? '',
      }))
      .filter((s: { placeId: string; description: string }) => s.placeId && s.description)
      .slice(0, 5)
    return NextResponse.json({ suggestions })
  } catch (e) {
    console.error('Places autocomplete threw', e)
    return NextResponse.json({ suggestions: [] })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe'

export const dynamic = 'force-dynamic'

function confirmUrl(request: NextRequest, params: Record<string, string>): URL {
  const url = new URL('/unsubscribe/confirm', request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

// GET NEVER MUTATES. Email clients prefetch links (Gmail link proxying, Outlook Safe
// Links), so a mutating GET silently opts people out. All this does is hand a valid token
// to the confirm page; the write is the POST below.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  // Retired uid-only links land here with no token. They are deliberately dead — the whole
  // point of this rewrite is that a bare profile id can no longer opt anyone out.
  if (!token) {
    return NextResponse.redirect(confirmUrl(request, { state: 'expired' }))
  }

  const result = verifyUnsubscribeToken(token)
  if (!result.ok) {
    return NextResponse.redirect(
      confirmUrl(request, { state: result.reason === 'expired' ? 'expired' : 'invalid' })
    )
  }

  return NextResponse.redirect(confirmUrl(request, { token }))
}

// POST is the mutation, and the token is its authorization — re-verified here rather than
// trusted from the page that rendered the form.
export async function POST(request: NextRequest) {
  const form = await request.formData()
  const submitted = form.get('token')
  const result = verifyUnsubscribeToken(typeof submitted === 'string' ? submitted : null)

  // 303 on every redirect below: the default 307 preserves the method, which would re-POST
  // to the destination page.
  if (!result.ok) {
    return NextResponse.redirect(
      confirmUrl(request, { state: result.reason === 'expired' ? 'expired' : 'invalid' }),
      303
    )
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await supabase
    .from('profiles')
    .update({ notify_new_sessions: false })
    .eq('id', result.userId)

  if (error) {
    console.error('[unsubscribe] update failed:', error)
    return NextResponse.redirect(new URL('/unsubscribed?error=1', request.url), 303)
  }

  return NextResponse.redirect(new URL('/unsubscribed', request.url), 303)
}

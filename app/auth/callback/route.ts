import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next')
  const intent = searchParams.get('intent')

  // Stubs complete profile setup first — preserve deep link + organizer intent into it.
  const setupUrlFor = () => {
    const sp = new URLSearchParams()
    if (next) sp.set('next', next)
    if (intent) sp.set('intent', intent)
    const qs = sp.toString()
    return qs ? `${origin}/profile/setup?${qs}` : `${origin}/profile/setup`
  }

  const cookieStorePromise = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          return (await cookieStorePromise).getAll()
        },
        async setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          const cookieStore = await cookieStorePromise
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  // Password reset emails use token_hash + type=recovery (not code)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'recovery' | 'email' | 'signup' | 'invite' | 'magiclink' | 'email_change',
    })
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }
    if (type === 'recovery') {
      return NextResponse.redirect(`${origin}/reset-password`)
    }
  }

  // OAuth and magic link use code
  if (code) {
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }
    // Reuse the user from the exchange response — avoids a second network round-trip
    const user = sessionData?.user
    if (!user) return NextResponse.redirect(`${origin}/login`)

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, is_stub')
      .eq('id', user.id)
      .single()

    const isStub = !profile || profile.is_stub
    if (isStub) {
      return NextResponse.redirect(setupUrlFor())
    }
    return NextResponse.redirect(next ? `${origin}${next}` : `${origin}/home`)
  }

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  // New users have no profile row yet; stubs must complete setup before accessing the app
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_stub')
    .eq('id', user.id)
    .single()

  const isStub2 = !profile || profile.is_stub
  if (isStub2) {
    return NextResponse.redirect(setupUrlFor())
  }
  return NextResponse.redirect(next ? `${origin}${next}` : `${origin}/home`)
}

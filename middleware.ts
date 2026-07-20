import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API routes handle their own auth — never let middleware touch them.
  // The matcher regex can match at inner path segments (unanchored), so this
  // guard is the reliable backstop that prevents Stripe webhooks from being redirected.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Forward pathname + search to Server Components via the REQUEST headers so they're
  // readable through headers(). Response headers are NOT visible to Server Components —
  // setting them there (as this used to) left x-pathname empty, which defeated the
  // setup-page guard in (app)/layout and looped stub users forever on /profile/setup.
  // The search string also carries deep-link params like ?token= for partner invites.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  requestHeaders.set('x-search', request.nextUrl.search)

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Update request cookies so Route Handlers receive the refreshed token, and
          // keep the forwarded cookie header in sync so Server Components on this same
          // request see the refreshed session too.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          requestHeaders.set('cookie', request.cookies.toString())
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          // Also set on response so the browser stores the new tokens
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isPublicPath =
    pathname === '/' ||
    pathname === '/for-players' ||
    pathname === '/organizers' ||
    pathname === '/foundingorganizers' ||
    pathname === '/login' ||
    pathname === '/about' ||
    pathname === '/contact' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/refund-policy' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/leagues') ||
    pathname.startsWith('/l/') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/courts') ||
    pathname === '/browse' ||
    pathname.startsWith('/browse/') ||
    pathname.startsWith('/api/stripe/') ||
    pathname.startsWith('/api/cron/')

  if (!user && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    const destination = request.nextUrl.pathname + request.nextUrl.search
    if (destination !== '/login') loginUrl.searchParams.set('next', destination)
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|api/stripe|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

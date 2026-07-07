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

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Update request cookies so Route Handlers receive the refreshed token
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
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

  // Forward pathname + search so server layouts can read them via headers()
  // (the search string carries things like ?token= for partner-invite deep links)
  supabaseResponse.headers.set('x-pathname', request.nextUrl.pathname)
  supabaseResponse.headers.set('x-search', request.nextUrl.search)

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|api/stripe|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

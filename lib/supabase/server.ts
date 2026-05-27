import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Keeps createClient synchronous so the 80+ existing server-side callers don't
// have to ripple `await`. cookies() is async in Next 15+, but @supabase/ssr
// accepts async getAll/setAll handlers — we resolve the store inside each
// handler instead of at the top level.
export function createClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          const cookieStore = await cookies()
          return cookieStore.getAll()
        },
        async setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          const cookieStore = await cookies()
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

// Single shared browser client per tab. Memoized so every Realtime channel multiplexes
// over ONE WebSocket connection (previously each caller created a fresh client + socket).
// Auth/session state is cookie-backed, so reusing the instance is safe.
export function createClient(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return client
}

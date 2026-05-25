import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

// Returns all non-dummy profiles for player-picker UIs (authenticated only).
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await db
    .from('profiles')
    .select('id, name, email')
    .neq('dummy', true)
    .order('name', { ascending: true })
    .limit(500)

  return NextResponse.json({ players: data ?? [] })
}

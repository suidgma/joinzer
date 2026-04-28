import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await request.json()

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch league max_players and registration_status atomically
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('max_players, registration_status')
    .eq('id', leagueId)
    .single()

  if (leagueErr || !league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  if (league.registration_status !== 'open' && league.registration_status !== 'waitlist_only') {
    return NextResponse.json({ error: 'Registration is not open' }, { status: 400 })
  }

  // Count current registered players server-side to avoid race condition
  const { count: registeredCount } = await admin
    .from('league_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('status', 'registered')

  const isFull = league.max_players != null && (registeredCount ?? 0) >= league.max_players
  const status = (league.registration_status === 'open' && !isFull) ? 'registered' : 'waitlist'

  const { error: upsertErr } = await admin
    .from('league_registrations')
    .upsert(
      { league_id: leagueId, user_id: user.id, status },
      { onConflict: 'league_id,user_id' }
    )

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, status })
}

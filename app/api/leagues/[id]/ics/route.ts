import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { generateIcs } from '@/lib/email/ics'

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params

  // Layer 1: auth
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Layer 2: must have an active registration
  const { data: reg } = await service
    .from('league_registrations')
    .select('id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (!reg) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Layer 3: fetch league + sessions
  const [{ data: league }, { data: sessions }] = await Promise.all([
    service.from('leagues').select('name, location_name').eq('id', id).single(),
    service.from('league_sessions')
      .select('id, session_date, session_number')
      .eq('league_id', id)
      .order('session_number', { ascending: true }),
  ])

  if (!league || !sessions) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
  const leagueUrl = `${siteUrl}/compete/leagues/${id}`

  const ics = generateIcs(sessions.map(s => ({
    uid: s.id,
    title: `${league.name} — Session ${s.session_number}`,
    startDate: s.session_date,
    ...(league.location_name ? { location: league.location_name } : {}),
    url: leagueUrl,
  })))

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="joinzer-league.ics"',
    },
  })
}

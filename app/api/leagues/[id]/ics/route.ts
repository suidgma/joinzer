import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { generateIcs, type IcsEvent } from '@/lib/email/ics'

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify user has an active registration
  const { data: reg } = await service
    .from('league_registrations')
    .select('status')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .not('status', 'eq', 'cancelled')
    .maybeSingle()

  if (!reg) return NextResponse.json({ error: 'Not registered' }, { status: 403 })

  const [{ data: league }, { data: sessions }] = await Promise.all([
    service.from('leagues').select('name, location_name, start_date, end_date, play_time').eq('id', id).single(),
    service.from('league_sessions').select('id, session_number, session_date').eq('league_id', id).not('status', 'eq', 'cancelled').order('session_number'),
  ])

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
  const leagueUrl = `${siteUrl}/compete/leagues/${id}`

  const icsEvents: IcsEvent[] = (sessions ?? []).length > 0
    ? (sessions ?? []).map((s) => ({
        uid: `league-${id}-session-${s.id}`,
        title: `${league.name} — Session ${s.session_number}`,
        startDate: s.session_date,
        location: league.location_name ?? undefined,
        description: league.play_time ? `Time: ${league.play_time}` : undefined,
        url: leagueUrl,
      }))
    : league.start_date
    ? [{ uid: `league-${id}`, title: league.name, startDate: league.start_date, location: league.location_name ?? undefined, url: leagueUrl }]
    : []

  if (icsEvents.length === 0) return NextResponse.json({ error: 'No schedule data' }, { status: 404 })

  const slug = league.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return new NextResponse(generateIcs(icsEvents), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-schedule.ics"`,
      'Cache-Control': 'no-store',
    },
  })
}

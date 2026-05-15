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

  // Verify user has an active registration for any division in this tournament
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('status')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .not('status', 'eq', 'cancelled')
    .maybeSingle()

  if (!reg) return NextResponse.json({ error: 'Not registered' }, { status: 403 })

  const { data: tournament } = await service
    .from('tournaments')
    .select('name, start_date, start_time, location:locations!location_id(name)')
    .eq('id', id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  const locationName = (tournament.location as any)?.name ?? null
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
  const tournamentUrl = `${siteUrl}/tournaments/${id}`

  const startDatetime = tournament.start_date && tournament.start_time
    ? `${tournament.start_date}T${tournament.start_time}:00`
    : tournament.start_date ?? null

  if (!startDatetime) return NextResponse.json({ error: 'No date set' }, { status: 404 })

  const icsEvents: IcsEvent[] = [{
    uid: `tournament-${id}`,
    title: tournament.name,
    startDate: startDatetime,
    location: locationName ?? undefined,
    url: tournamentUrl,
  }]

  const slug = tournament.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return new NextResponse(generateIcs(icsEvents), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.ics"`,
      'Cache-Control': 'no-store',
    },
  })
}

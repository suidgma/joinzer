import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { generateIcs } from '@/lib/email/ics'
import { icsFilename } from '@/lib/utils/slug'
import { getSiteUrl } from '@/lib/utils/site-url'

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

  // Layer 2: organizer OR active registration
  const [{ data: tournament }, { data: reg }] = await Promise.all([
    service.from('tournaments').select('name, start_date, end_date, start_time, estimated_end_time, location_id, organizer_id').eq('id', id).single(),
    service.from('tournament_registrations')
      .select('id')
      .eq('tournament_id', id)
      .eq('user_id', user.id)
      .neq('status', 'cancelled')
      .maybeSingle(),
  ])

  const isOrganizer = tournament?.organizer_id === user.id
  if (!reg && !isOrganizer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!tournament.start_date) return NextResponse.json({ error: 'Tournament date not set' }, { status: 404 })

  const locationResult = tournament.location_id
    ? await service.from('locations').select('name').eq('id', tournament.location_id).single()
    : { data: null }
  const locationName = locationResult.data?.name ?? null

  const siteUrl = getSiteUrl()
  const tournamentUrl = `${siteUrl}/tournaments/${id}`

  // Build one VEVENT per tournament day so multi-day events appear on each day
  function daysBetween(start: string, end: string): string[] {
    const dates: string[] = []
    const cursor = new Date(start + 'T00:00:00Z')
    const last = new Date(end + 'T00:00:00Z')
    while (cursor <= last) {
      dates.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return dates
  }

  const startDate = tournament.start_date
  const endDate = (tournament as any).end_date ?? startDate
  const days = daysBetween(startDate, endDate)

  // Attach start/end times if available
  const startTime: string | null = (tournament as any).start_time ?? null
  const endTime: string | null = (tournament as any).estimated_end_time ?? null

  function ptIso(date: string, time: string): string {
    const month = parseInt(date.slice(5, 7), 10)
    const offset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
    return `${date}T${time}:00${offset}`
  }

  const ics = generateIcs(days.map((day, i) => ({
    uid: i === 0 ? id : `${id}-day${i + 1}`,
    title: days.length > 1 ? `${tournament.name} — Day ${i + 1}` : tournament.name,
    startDate: startTime ? ptIso(day, startTime) : day,
    ...(endTime ? { endDate: ptIso(day, endTime) } : {}),
    ...(locationName ? { location: locationName } : {}),
    url: tournamentUrl,
  })))

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(tournament.name, 'tournament')}"`,
    },
  })
}

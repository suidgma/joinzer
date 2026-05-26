import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { generateIcs } from '@/lib/email/ics'
import { icsFilename } from '@/lib/utils/slug'

type ParsedTime = { startHour: number; startMin: number; endHour: number; endMin: number }

function parseScheduleDescription(desc: string | null): ParsedTime | null {
  if (!desc) return null
  const m = desc.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (!m) return null

  let sh = parseInt(m[1])
  const sm = parseInt(m[2] ?? '0')
  const sAp = m[3].toLowerCase()
  let eh = parseInt(m[4])
  const em = parseInt(m[5] ?? '0')
  const eAp = m[6].toLowerCase()

  if (sAp === 'pm' && sh !== 12) sh += 12
  if (sAp === 'am' && sh === 12) sh = 0
  if (eAp === 'pm' && eh !== 12) eh += 12
  if (eAp === 'am' && eh === 12) eh = 0

  return { startHour: sh, startMin: sm, endHour: eh, endMin: em }
}

// Combine a YYYY-MM-DD session date with an hour/minute in Pacific time → ISO string
function sessionDateToIso(date: string, hour: number, min: number): string {
  const month = parseInt(date.slice(5, 7), 10)
  const ptOffset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
  return `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00${ptOffset}`
}

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
    service.from('leagues').select('name, location_name, schedule_description').eq('id', id).single(),
    service.from('league_sessions')
      .select('id, session_date, session_number')
      .eq('league_id', id)
      .order('session_number', { ascending: true }),
  ])

  if (!league || !sessions) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
  const leagueUrl = `${siteUrl}/leagues/${id}`

  const times = parseScheduleDescription((league as any).schedule_description)

  const ics = generateIcs(sessions.map(s => ({
    uid: s.id,
    title: `${league.name} — Session ${s.session_number}`,
    startDate: times
      ? sessionDateToIso(s.session_date, times.startHour, times.startMin)
      : s.session_date,
    ...(times ? { endDate: sessionDateToIso(s.session_date, times.endHour, times.endMin) } : {}),
    ...(league.location_name ? { location: league.location_name } : {}),
    url: leagueUrl,
  })))

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(league.name, 'league')}"`,
    },
  })
}

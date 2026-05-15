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
    .from('tournament_registrations')
    .select('id')
    .eq('tournament_id', id)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (!reg) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Layer 3: fetch tournament + conditional location
  const { data: tournament } = await service
    .from('tournaments')
    .select('name, start_date, location_id')
    .eq('id', id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!tournament.start_date) return NextResponse.json({ error: 'Tournament date not set' }, { status: 404 })

  const locationResult = tournament.location_id
    ? await service.from('locations').select('name').eq('id', tournament.location_id).single()
    : { data: null }
  const locationName = locationResult.data?.name ?? null

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
  const tournamentUrl = `${siteUrl}/tournaments/${id}`

  const ics = generateIcs([{
    uid: id,
    title: tournament.name,
    startDate: tournament.start_date,
    ...(locationName ? { location: locationName } : {}),
    url: tournamentUrl,
  }])

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="joinzer-tournament.ics"',
    },
  })
}

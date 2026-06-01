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

  // Layer 2: must be joined (not just registered — participant_status must be 'joined')
  const { data: participation } = await service
    .from('event_participants')
    .select('id')
    .eq('event_id', id)
    .eq('user_id', user.id)
    .eq('participant_status', 'joined')
    .maybeSingle()

  if (!participation) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Layer 3: fetch event + location
  const { data: event } = await service
    .from('events')
    .select('title, starts_at, duration_minutes, location_id')
    .eq('id', id)
    .single()

  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const locationResult = event.location_id
    ? await service.from('locations').select('name').eq('id', event.location_id).single()
    : { data: null }
  const locationName = locationResult.data?.name ?? null

  // Compute endDate as ISO string from starts_at + duration_minutes
  const startMs = new Date(event.starts_at).getTime()
  const endDate = new Date(startMs + event.duration_minutes * 60_000).toISOString()

  const siteUrl = getSiteUrl()
  const eventUrl = `${siteUrl}/play/${id}`

  const ics = generateIcs([{
    uid: id,
    title: event.title,
    startDate: event.starts_at,
    endDate,
    ...(locationName ? { location: locationName } : {}),
    url: eventUrl,
  }])

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(event.title, 'event')}"`,
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManageTournament } from '@/lib/tournament/access'

type Patch = {
  court_number?: number | null
  scheduled_time?: string | null
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; matchId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Patch
  const hasCourt = 'court_number' in body
  const hasTime = 'scheduled_time' in body
  if (!hasCourt && !hasTime) {
    return NextResponse.json({ error: 'Provide court_number or scheduled_time' }, { status: 400 })
  }

  const update: Record<string, number | string | null> = {}
  if (hasCourt) {
    const cn = body.court_number
    if (cn !== null && (typeof cn !== 'number' || cn < 1 || !Number.isInteger(cn))) {
      return NextResponse.json({ error: 'court_number must be a positive integer or null' }, { status: 400 })
    }
    update.court_number = cn ?? null
  }
  if (hasTime) {
    const st = body.scheduled_time
    if (st !== null) {
      if (typeof st !== 'string' || Number.isNaN(Date.parse(st))) {
        return NextResponse.json({ error: 'scheduled_time must be ISO 8601 or null' }, { status: 400 })
      }
    }
    update.scheduled_time = st ?? null
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const allowed = await canManageTournament(service, params.id, user.id)
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: match } = await service
    .from('tournament_matches')
    .select('id, status')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()
  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status === 'completed') {
    return NextResponse.json({ error: 'Completed matches cannot be rescheduled' }, { status: 409 })
  }

  const { data: updated, error } = await service
    .from('tournament_matches')
    .update(update)
    .eq('id', params.matchId)
    .select()
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ match: updated })
}

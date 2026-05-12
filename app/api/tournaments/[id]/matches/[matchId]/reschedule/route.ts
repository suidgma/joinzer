import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canOperate } from '@/lib/tournament/access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; matchId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await canOperate(params.id, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { court_number, scheduled_time } = body

  if (court_number === undefined && scheduled_time === undefined) {
    return NextResponse.json({ error: 'Provide court_number or scheduled_time' }, { status: 400 })
  }

  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check match exists and is not completed
  const { data: match } = await service
    .from('tournament_matches')
    .select('id, status')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status === 'completed') {
    return NextResponse.json({ error: 'Cannot reschedule a completed match' }, { status: 409 })
  }

  const update: Record<string, unknown> = {}
  if (court_number !== undefined) update.court_number = court_number === null ? null : Number(court_number)
  if (scheduled_time !== undefined) update.scheduled_time = scheduled_time || null

  const { data: updated, error } = await service
    .from('tournament_matches')
    .update(update)
    .eq('id', params.matchId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ match: updated })
}

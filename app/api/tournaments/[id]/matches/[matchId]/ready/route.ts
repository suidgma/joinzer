import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// POST /api/tournaments/[id]/matches/[matchId]/ready
// Marks a match as in_progress (ready to play).
// Uses 'in_progress' status — a future migration will add a 'ready' status
// to the competition_matches enum (CLAUDE.md Section 6).
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; matchId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await service
    .from('tournament_matches')
    .update({ status: 'in_progress' })
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // TODO: write to audit_log once migrated (CLAUDE.md Section 6)
  console.log('[audit] match marked ready:', { matchId: params.matchId, actor: user.id })

  return NextResponse.json({ ok: true })
}

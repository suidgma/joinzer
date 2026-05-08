import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// PATCH /api/tournaments/[id]/schedule
// Body: { updates: Array<{ id: string, court_number: number | null, scheduled_time: string | null }> }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify organizer
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()

  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Only the organizer can update the schedule' }, { status: 403 })
  }

  const { updates } = await req.json()
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  // Apply updates in parallel
  const results = await Promise.all(
    updates.map((u: { id: string; court_number: number | null; scheduled_time: string | null }) =>
      service
        .from('tournament_matches')
        .update({ court_number: u.court_number, scheduled_time: u.scheduled_time })
        .eq('id', u.id)
        .eq('tournament_id', params.id)
    )
  )

  const failed = results.filter(r => r.error)
  if (failed.length > 0) {
    return NextResponse.json({ error: 'Some updates failed', details: failed.map(r => r.error?.message) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: updates.length })
}

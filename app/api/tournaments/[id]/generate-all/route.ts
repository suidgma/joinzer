import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { buildDivisionMatchRows } from '@/lib/tournament/buildMatches'

// POST /api/tournaments/[id]/generate-all
// Generates brackets for every division that doesn't have matches yet.
// Returns { divisions: [{ divisionId, name, matchCount }], totalMatches }
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
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

  const { data: divisions } = await service
    .from('tournament_divisions')
    .select('id, name, format, bracket_type, format_settings_json, partner_mode')
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  if (!divisions || divisions.length === 0) {
    return NextResponse.json({ error: 'No divisions found' }, { status: 400 })
  }

  const results: { divisionId: string; name: string; matchCount: number; skipped?: string }[] = []
  const allInserted: object[] = []

  for (const division of divisions) {
    // Skip if matches already exist for this division
    const { count: existing } = await service
      .from('tournament_matches')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', division.id)

    if (existing && existing > 0) {
      results.push({ divisionId: division.id, name: division.name, matchCount: existing, skipped: 'already generated' })
      continue
    }

    const { data: registrations } = await service
      .from('tournament_registrations')
      .select('id, user_id, partner_registration_id, seed')
      .eq('division_id', division.id)
      .eq('status', 'registered')
      .in('payment_status', ['paid', 'waived', 'comped'])
      .order('created_at', { ascending: true })

    // Shared with the Advanced Schedule Builder: honors locked seeds, dedupes
    // doubles pairs, distributes byes, and dispatches by bracket type.
    const base = { tournament_id: params.id, division_id: division.id, status: 'scheduled' }
    const built = buildDivisionMatchRows(division as any, registrations ?? [], base)
    if ('error' in built) {
      results.push({ divisionId: division.id, name: division.name, matchCount: 0, skipped: built.error })
      continue
    }

    const { data: inserted, error } = await service
      .from('tournament_matches')
      .insert(built.rows)
      .select()

    if (error || !inserted) {
      return NextResponse.json({ error: `Failed to generate matches for division "${division.name}": ${error?.message}` }, { status: 500 })
    }

    allInserted.push(...inserted)
    results.push({ divisionId: division.id, name: division.name, matchCount: inserted.length })
  }

  return NextResponse.json({
    divisions: results,
    totalMatches: allInserted.length,
    matches: allInserted,
  })
}

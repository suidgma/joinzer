import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

const MATCH_SELECT =
  'id, tournament_id, division_id, round_number, match_number, match_stage, pool_number, ' +
  'court_number, scheduled_time, team_1_registration_id, team_2_registration_id, ' +
  'team_1_score, team_2_score, winner_registration_id, status, sequence_number, team_1_source, team_2_source'

// GET — the full offline snapshot of a tournament for run mode: tournament, divisions,
// registrations (with player + partner names), and every published match. Organizer/staff
// gated, service-role, so the browser gets everything it needs in ONE authorized round-trip
// (no per-table RLS surprises). Written to IndexedDB by the client; then run mode reads it
// with no network.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: tournament } = await db
    .from('tournaments').select('id, name, status, organizer_id, scheduling_method').eq('id', params.id).single()
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let allowed = tournament.organizer_id === user.id
  if (!allowed) {
    const { data: staff } = await db
      .from('tournament_staff').select('role').eq('tournament_id', params.id).eq('user_id', user.id).maybeSingle()
    allowed = !!staff
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: divisions }, { data: regsRaw }, { data: matches }] = await Promise.all([
    db.from('tournament_divisions')
      .select('id, tournament_id, name, format, bracket_type, format_settings_json, team_type')
      .eq('tournament_id', params.id).order('created_at', { ascending: true }),
    db.from('tournament_registrations')
      .select('id, tournament_id, division_id, user_id, partner_user_id, partner_registration_id, team_name, status, seed, checked_in')
      .eq('tournament_id', params.id),
    db.from('tournament_matches').select(MATCH_SELECT)
      .eq('tournament_id', params.id).eq('is_draft', false).order('match_number', { ascending: true }),
  ])

  const regs = (regsRaw ?? []) as any[]
  const userIds = Array.from(new Set(regs.flatMap(r => [r.user_id, r.partner_user_id]).filter(Boolean)))
  const { data: profiles } = userIds.length > 0
    ? await db.from('profiles').select('id, name').in('id', userIds)
    : { data: [] }
  const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.name]))

  const registrations = regs.map(r => ({
    ...r,
    user_profile: { name: nameById.get(r.user_id) ?? '' },
    partner_profile: r.partner_user_id ? { name: nameById.get(r.partner_user_id) ?? '' } : null,
  }))

  return NextResponse.json({
    tournament: { id: tournament.id, name: tournament.name, status: tournament.status, scheduling_method: tournament.scheduling_method, is_lead_organizer: tournament.organizer_id === user.id },
    divisions: divisions ?? [],
    registrations,
    courts: [],
    matches: matches ?? [],
  })
}

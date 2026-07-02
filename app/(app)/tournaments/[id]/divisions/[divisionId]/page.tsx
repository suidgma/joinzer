export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import DivisionManageView from '@/components/features/tournaments/DivisionManageView'

export default async function DivisionManagePage(
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: tournament },
    { data: division },
    { data: regsRaw },
    { data: matchesRaw },
    { count: draftCount },
    { data: staffRow },
  ] = await Promise.all([
    db.from('tournaments')
      .select('id, name, organizer_id, start_date, start_time, scheduling_method, location:locations!location_id(name, court_count)')
      .eq('id', params.id)
      .single(),
    db.from('tournament_divisions')
      .select('id, name, format, category, team_type, partner_mode, skill_min, skill_max, max_entries, waitlist_enabled, status, bracket_type, format_settings_json, cost_cents, min_age, max_age, start_time, scheduling_method')
      .eq('id', params.divisionId)
      .eq('tournament_id', params.id)
      .single(),
    db.from('tournament_registrations')
      .select('id, user_id, partner_user_id, partner_registration_id, team_name, status, payment_status, stripe_payment_intent_id, seed, registration_type, pool_number')
      .eq('division_id', params.divisionId)
      .eq('tournament_id', params.id),
    db.from('tournament_matches')
      .select('id, division_id, round_number, match_number, match_stage, pool_number, court_number, scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status, sequence_number, team_1_source, team_2_source')
      .eq('division_id', params.divisionId)
      .eq('is_draft', false)
      .order('match_number', { ascending: true }),
    // Draft matches live only in the Schedule Builder; counted so this page can
    // explain why generation is blocked when an unpublished draft exists.
    db.from('tournament_matches')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', params.divisionId)
      .eq('is_draft', true),
    user
      ? db.from('tournament_staff').select('role').eq('tournament_id', params.id).eq('user_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (!tournament || !division) notFound()

  const isOrganizer = user?.id === (tournament as any).organizer_id
  const isStaff = staffRow?.role === 'co_organizer'
  const canManage = isOrganizer || isStaff

  // Fetch profiles
  const allUserIds = Array.from(new Set(
    [...(regsRaw ?? []).map((r: any) => r.user_id), ...(regsRaw ?? []).map((r: any) => r.partner_user_id)].filter(Boolean)
  ))
  const { data: profilesRaw } = allUserIds.length > 0
    ? await db.from('profiles').select('id, name, is_stub, dupr_rating, estimated_rating').in('id', allUserIds)
    : { data: [] }

  const profileMap = new Map((profilesRaw ?? []).map((p: any) => [p.id, p]))
  const registrations = (regsRaw ?? []).map((r: any) => ({
    ...r,
    user_profile: profileMap.get(r.user_id) ?? null,
    partner_profile: r.partner_user_id ? (profileMap.get(r.partner_user_id) ?? null) : null,
  }))

  return (
    <DivisionManageView
      tournamentId={params.id}
      tournamentName={(tournament as any).name}
      tournamentStartDate={(tournament as any).start_date ?? null}
      tournamentStartTime={(tournament as any).start_time ?? null}
      division={division as any}
      initialRegistrations={registrations}
      initialMatches={matchesRaw ?? []}
      draftMatchCount={draftCount ?? 0}
      isOrganizer={canManage}
      currentUserId={user?.id ?? null}
      locationCourtCount={(tournament as any).location?.court_count ?? null}
      isRolling={((division as any).scheduling_method ?? (tournament as any).scheduling_method) === 'rolling'}
    />
  )
}

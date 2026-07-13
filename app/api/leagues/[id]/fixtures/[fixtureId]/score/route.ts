import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { validateScores } from '@/lib/scoring/validateScores'
import { entrantSidesForFixture } from '@/lib/leagues/flexServer'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; fixtureId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH /api/leagues/[id]/fixtures/[fixtureId]/score
// Organizer score entry for a league fixture (box). No bracket advancement — a
// box fixture is terminal. Reuses the shared validateScores; audited.
// Body: { team_1_score, team_2_score }.
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { team_1_score, team_2_score } = body
  const check = validateScores(team_1_score, team_2_score)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by, allow_player_scores').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Player self-scoring is governed by the allow_player_scores toggle (box/ladder
  // default it on at create time; organizers can turn it off).
  const playerScorable = league.allow_player_scores === true

  const { data: fixture } = await db
    .from('league_fixtures')
    .select('id, league_id, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status')
    .eq('id', params.fixtureId)
    .eq('league_id', params.id)
    .single()
  if (!fixture) return NextResponse.json({ error: 'Fixture not found' }, { status: 404 })

  // Organizer or co-admin may always score. When the league allows player score entry,
  // a participant may score their own match (saved directly; organizer can edit).
  let allowed = league.created_by === user.id
  if (!allowed) {
    const { data: myReg } = await db
      .from('league_registrations').select('is_co_admin').eq('league_id', params.id).eq('user_id', user.id).maybeSingle()
    allowed = myReg?.is_co_admin === true
  }
  if (!allowed && playerScorable) {
    const sides = await entrantSidesForFixture(db, params.id, fixture.team_1_registration_id, fixture.team_2_registration_id)
    allowed = sides.team_1.has(user.id) || sides.team_2.has(user.id)
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const winner_registration_id = team_1_score > team_2_score
    ? fixture.team_1_registration_id
    : fixture.team_2_registration_id

  const { data: updated, error } = await db
    .from('league_fixtures')
    .update({ team_1_score, team_2_score, winner_registration_id, status: 'completed' })
    .eq('id', params.fixtureId)
    .select()
    .single()
  if (error || !updated) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

  await logAudit({
    actorId: user.id,
    entityType: 'league_match',
    entityId: params.fixtureId,
    action: 'score_updated',
    before: {
      team_1_score: fixture.team_1_score,
      team_2_score: fixture.team_2_score,
      winner_registration_id: fixture.winner_registration_id,
      status: fixture.status,
    },
    after: { team_1_score, team_2_score, winner_registration_id, status: 'completed' },
  })

  // Player notifications on league score entry are a deferred product decision
  // (see docs/phases/league-formats.md §7) — not sent here.

  return NextResponse.json({ fixture: updated })
}

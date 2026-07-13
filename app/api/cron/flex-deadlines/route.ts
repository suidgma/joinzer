export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotifications, type NotificationInput } from '@/lib/notifications/create'
import { entrantSidesForFixture } from '@/lib/leagues/flexServer'

// Flex Phase 2 — deadline lifecycle. Daily cron (CRON_SECRET-guarded):
//   • 3 days before a flex league's season deadline (leagues.end_date), remind the
//     entrants of each still-unplayed match to arrange + report it.
//   • Once the deadline has passed, forfeit any match still 'scheduled' (never played)
//     and notify both entrants + the organizer. Reported-but-unconfirmed ('in_progress')
//     and disputed matches are left for the organizer to resolve.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const dayMs = 86_400_000

  const { data: leagues } = await db
    .from('leagues')
    .select('id, name, created_by, end_date')
    .eq('format_kind', 'flex')
    .eq('status', 'active')
    .not('end_date', 'is', null)

  let forfeited = 0
  let reminded = 0

  for (const lg of (leagues ?? []) as any[]) {
    const endDate = lg.end_date as string // YYYY-MM-DD
    const daysUntil = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / dayMs)
    const pastDeadline = daysUntil < 0
    const approaching = daysUntil === 3
    if (!pastDeadline && !approaching) continue

    const { data: fixtures } = await db
      .from('league_fixtures')
      .select('id, team_1_registration_id, team_2_registration_id')
      .eq('league_id', lg.id)
      .eq('match_stage', 'round_robin')
      .eq('status', 'scheduled')
    if (!fixtures || fixtures.length === 0) continue

    // Resolve the entrant user ids for each unplayed match.
    const usersByFixture = new Map<string, string[]>()
    for (const f of fixtures as any[]) {
      const sides = await entrantSidesForFixture(db, lg.id, f.team_1_registration_id, f.team_2_registration_id)
      usersByFixture.set(f.id, [...new Set([...sides.team_1, ...sides.team_2])])
    }

    const notifs: NotificationInput[] = []

    if (pastDeadline) {
      const ids = (fixtures as any[]).map((f) => f.id)
      await db.from('league_fixtures').update({ status: 'forfeited' }).in('id', ids)
      forfeited += ids.length
      for (const [, users] of usersByFixture) {
        for (const uid of users) {
          notifs.push({
            recipientId: uid,
            surface: 'league',
            surfaceId: lg.id,
            kind: 'flex_match_forfeited',
            title: `Match forfeited — ${lg.name}`,
            body: 'The season deadline passed before your match was played.',
            url: `/leagues/${lg.id}`,
          })
        }
      }
      if (lg.created_by) {
        notifs.push({
          recipientId: lg.created_by,
          surface: 'league',
          surfaceId: lg.id,
          kind: 'flex_match_forfeited',
          title: `${ids.length} unplayed match${ids.length === 1 ? '' : 'es'} forfeited — ${lg.name}`,
          body: 'The season deadline passed with matches still unplayed.',
          url: `/leagues/${lg.id}`,
        })
      }
    } else {
      // approaching — remind entrants once (fires only on the day 3 days out).
      for (const [, users] of usersByFixture) {
        for (const uid of users) {
          notifs.push({
            recipientId: uid,
            surface: 'league',
            surfaceId: lg.id,
            kind: 'flex_deadline_approaching',
            title: `Play your match soon — ${lg.name}`,
            body: `The season ends ${endDate}. Arrange, play, and report your remaining match before then.`,
            url: `/leagues/${lg.id}`,
          })
        }
      }
      reminded += notifs.length
    }

    await createNotifications(notifs)
  }

  return NextResponse.json({ ok: true, forfeited, reminded })
}

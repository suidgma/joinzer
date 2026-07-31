export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotifications, type NotificationInput } from '@/lib/notifications/create'
import { entrantSidesForFixture } from '@/lib/leagues/flexServer'
import {
  flexDeadlinePhase,
  recipientsNeedingReminder,
  REMINDER_WINDOW_DAYS,
} from '@/lib/leagues/flexDeadlines'
import { assertCronSecret } from '@/lib/cron/auth'

// Flex Phase 2 — deadline lifecycle. Daily cron (CRON_SECRET-guarded):
//   • Within REMINDER_WINDOW_DAYS of a flex league's season deadline (leagues.end_date),
//     remind the entrants of each still-unplayed match to arrange + report it. Each entrant
//     is reminded at most once per league — deduped against the notifications already
//     written, so the widened window catches up after a missed run without repeating.
//   • Once the deadline has passed, forfeit any match still 'scheduled' (never played)
//     and notify both entrants + the organizer. Reported-but-unconfirmed ('in_progress')
//     and disputed matches are left for the organizer to resolve.
export async function GET(req: NextRequest) {
  const unauthorized = assertCronSecret(req, 'flex-deadlines')
  if (unauthorized) return unauthorized

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

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
    const phase = flexDeadlinePhase(endDate, todayStr)
    if (phase === 'none') continue
    const pastDeadline = phase === 'forfeit'

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
      // Approaching. The window spans REMINDER_WINDOW_DAYS + 1 days, so dedupe against the
      // reminders already written for this league rather than relying on the trigger firing
      // exactly once. The notification row IS the record that a player was reminded.
      const { data: priorReminders } = await db
        .from('notifications')
        .select('recipient_id')
        .eq('surface', 'league')
        .eq('surface_id', lg.id)
        .eq('kind', 'flex_deadline_approaching')

      const alreadyReminded = new Set<string>(
        (priorReminders ?? []).map((row: any) => row.recipient_id as string)
      )

      const entrants = [...usersByFixture.values()].flat()
      for (const uid of recipientsNeedingReminder(entrants, alreadyReminded)) {
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
      reminded += notifs.length
    }

    await createNotifications(notifs)
  }

  return NextResponse.json({ ok: true, forfeited, reminded })
}

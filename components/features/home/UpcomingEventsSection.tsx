import { createClient as createAdmin } from '@supabase/supabase-js'
import Link from 'next/link'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'
import { formatSkillRange } from '@/lib/taxonomy/formats'

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual RR',
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  singles: 'Singles',
  custom: 'Custom',
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

function scoreItem(
  dateStr: string | null,
  lat: number | null,
  lng: number | null,
  skillMin: number | null,
  skillMax: number | null,
  skillRange: { lo: number; hi: number } | null,
  homeCourt: { lat: number; lng: number } | null,
): number {
  let score = 0

  // 1. Proximity to home court — the dominant signal (0–40). Same court ≈ 40; ~25 mi away ≈ 0.
  if (homeCourt && lat != null && lng != null) {
    const miles = distanceMiles(homeCourt.lat, homeCourt.lng, lat, lng)
    score += Math.max(0, 40 - miles * 1.6)
  }

  // 2. Skill fit — the item's range overlaps the user's ±1-tier comfort window (0–30).
  if (skillRange && skillMin != null && skillMax != null && skillMax >= skillRange.lo && skillMin <= skillRange.hi) {
    score += 30
  }

  // 3. Urgency to decide — a small, capped tertiary nudge (0–12) with a WIDE window, so far-out
  // tournaments (people register for those weeks ahead) aren't penalized for their start date.
  if (dateStr) {
    const daysAway = (new Date(dateStr).getTime() - Date.now()) / 86400000
    if (daysAway >= 0 && daysAway <= 7) score += 12
    else if (daysAway <= 30) score += 6
    else if (daysAway <= 60) score += 3
  }

  return score
}

// Leagues encode gender in their format (mens_/womens_); mixed/open/coed are for everyone. A player
// only sees a gender-specific league if it matches their profile gender. Unknown gender ⇒ show it
// (don't hide inventory over missing data). Tournaments (multi-division) + Play (open) aren't filtered.
function leagueGenderOk(format: string | null, viewerGender: string | null): boolean {
  const needed = !format ? null : format.startsWith('mens_') ? 'male' : format.startsWith('womens_') ? 'female' : null
  if (!needed || !viewerGender) return true
  return viewerGender === needed
}

type UpcomingItem =
  | { kind: 'session'; data: any; score: number }
  | { kind: 'tournament'; data: any; score: number }
  | { kind: 'league'; data: any; score: number }

interface Props {
  viewerGender: string | null
  skillRange: { lo: number; hi: number } | null
  homeCourt: { lat: number; lng: number } | null
  excludeLeagueIds: string[]
  excludeEventIds: string[]
  excludeTournamentIds: string[]
}

export default async function UpcomingEventsSection({
  viewerGender,
  skillRange,
  homeCourt,
  excludeLeagueIds,
  excludeEventIds,
  excludeTournamentIds,
}: Props) {
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  const { data: featuredRows } = await db
    .from('featured_home_items')
    .select('event_type, event_id, display_order, label')
    .lte('active_from', now)
    .or(`active_until.is.null,active_until.gt.${now}`)
    .order('display_order', { ascending: true })
    .limit(10)

  let items: UpcomingItem[] = []

  if ((featuredRows ?? []).length > 0) {
    // Featured override: fetch the specific items in order
    const sessionIds = featuredRows!.filter(f => f.event_type === 'session').map(f => f.event_id as string)
    const tournamentIds = featuredRows!.filter(f => f.event_type === 'tournament').map(f => f.event_id as string)
    const leagueIds = featuredRows!.filter(f => f.event_type === 'league').map(f => f.event_id as string)

    const [{ data: sessions }, { data: tournaments }, { data: leagues }] = await Promise.all([
      sessionIds.length > 0
        ? db.from('events')
            .select('id, title, starts_at, max_players, skill_min, skill_max, location:locations!location_id(name), event_participants!event_id(participant_status)')
            .in('id', sessionIds)
        : Promise.resolve({ data: [] as any[] }),
      tournamentIds.length > 0
        ? db.from('tournaments')
            .select('id, name, start_date, location:locations!location_id(name)')
            .in('id', tournamentIds)
        : Promise.resolve({ data: [] as any[] }),
      leagueIds.length > 0
        ? db.from('leagues')
            .select('id, name, format, skill_min, skill_max, location_name, registration_status, start_date')
            .in('id', leagueIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const sMap = Object.fromEntries((sessions ?? []).map((s: any) => [s.id as string, s]))
    const tMap = Object.fromEntries((tournaments ?? []).map((t: any) => [t.id as string, t]))
    const lMap = Object.fromEntries((leagues ?? []).map((l: any) => [l.id as string, l]))

    for (const f of featuredRows!) {
      if (f.event_type === 'session' && sMap[f.event_id as string]) {
        items.push({ kind: 'session', data: sMap[f.event_id as string], score: 0 })
      } else if (f.event_type === 'tournament' && tMap[f.event_id as string]) {
        items.push({ kind: 'tournament', data: tMap[f.event_id as string], score: 0 })
      } else if (f.event_type === 'league' && lMap[f.event_id as string] && leagueGenderOk(lMap[f.event_id as string].format, viewerGender)) {
        items.push({ kind: 'league', data: lMap[f.event_id as string], score: 0 })
      }
    }
  } else {
    // Personalized: score and rank across all three types
    const excludeEventSet = new Set(excludeEventIds)
    const excludeTournamentSet = new Set(excludeTournamentIds)

    const [{ data: openSessions }, { data: upcomingTournaments }, leagueResult] = await Promise.all([
      db.from('events')
        .select('id, title, starts_at, max_players, skill_min, skill_max, location:locations!location_id(name, lat, lng), event_participants!event_id(participant_status)')
        .eq('status', 'open')
        .gte('starts_at', now)
        .order('starts_at', { ascending: true })
        .limit(20),
      db.from('tournaments')
        .select('id, name, start_date, location:locations!location_id(name, lat, lng)')
        .eq('status', 'published')
        .eq('visibility', 'public')
        .gte('start_date', today)
        .order('start_date', { ascending: true })
        .limit(20),
      (() => {
        // Skill is a SOFT ranking signal (scoreItem), not a hard filter — a slightly-off league still
        // appears, just ranked lower. Gender is filtered in the loop below (hard, leagues only).
        let q = db.from('leagues')
          .select('id, name, format, skill_min, skill_max, location_name, registration_status, start_date, location:locations!location_id(lat, lng)')
          .in('registration_status', ['open', 'waitlist_only'])
          .order('start_date', { ascending: true, nullsFirst: false })
          .limit(30)
        if (excludeLeagueIds.length > 0) q = q.not('id', 'in', `(${excludeLeagueIds.join(',')})`)
        return q
      })(),
    ])

    const scored: UpcomingItem[] = []

    for (const ev of openSessions ?? []) {
      if (excludeEventSet.has(ev.id as string)) continue
      const participants = (ev.event_participants as any[]) ?? []
      const joinedCount = participants.filter((p: any) => p.participant_status === 'joined').length
      const spotsLeft = (ev.max_players as number ?? Infinity) - joinedCount
      if (spotsLeft <= 0) continue
      const loc = ev.location as any
      let s = scoreItem(
        ev.starts_at as string,
        loc?.lat ?? null,
        loc?.lng ?? null,
        (ev as any).skill_min ?? null,
        (ev as any).skill_max ?? null,
        skillRange,
        homeCourt,
      )
      if (spotsLeft <= 2) s += 5 // scarcity: nearly-full sessions nudge up ("act now")
      scored.push({ kind: 'session', data: { ...ev, joinedCount }, score: s })
    }

    for (const t of upcomingTournaments ?? []) {
      if (excludeTournamentSet.has(t.id as string)) continue
      const loc = t.location as any
      scored.push({
        kind: 'tournament',
        data: t,
        score: scoreItem(t.start_date as string, loc?.lat ?? null, loc?.lng ?? null, null, null, skillRange, homeCourt),
      })
    }

    for (const l of leagueResult.data ?? []) {
      if (!leagueGenderOk((l as any).format, viewerGender)) continue // hard: gender-specific leagues
      const loc = (l as any).location
      scored.push({
        kind: 'league',
        data: l,
        score: scoreItem(
          (l as any).start_date ?? null,
          loc?.lat ?? null,
          loc?.lng ?? null,
          (l as any).skill_min ?? null,
          (l as any).skill_max ?? null,
          skillRange,
          homeCourt,
        ),
      })
    }

    items = scored.sort((a, b) => b.score - a.score).slice(0, 8)
  }

  if (items.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Upcoming Events</h2>
        <div className="flex items-center gap-3 text-xs text-brand-active">
          <Link href="/play" className="hover:underline">Play →</Link>
          <Link href="/leagues" className="hover:underline">Leagues →</Link>
          <Link href="/tournaments" className="hover:underline">Tournaments →</Link>
        </div>
      </div>
      {items.map((item, i) => {
        if (item.kind === 'session') {
          const ev = item.data
          const spotsLeft = (ev.max_players as number) - (ev.joinedCount ?? 0)
          return (
            <Link
              key={`upcoming-s-${ev.id}-${i}`}
              href={`/play/${ev.id as string}`}
              className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-brand-dark leading-snug">{ev.title as string}</p>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-dark">Play</span>
              </div>
              {(ev.location as any)?.name && (
                <p className="text-xs text-brand-muted">{(ev.location as any).name}</p>
              )}
              <p className="text-xs text-brand-muted">{formatTimestamp(ev.starts_at as string)}</p>
              {formatSkillRange((ev as any).skill_min, (ev as any).skill_max) && (
                <p className="text-xs text-brand-muted">{formatSkillRange((ev as any).skill_min, (ev as any).skill_max)}</p>
              )}
              <p className="text-xs text-brand-muted">{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</p>
            </Link>
          )
        }

        if (item.kind === 'tournament') {
          const t = item.data
          return (
            <Link
              key={`upcoming-t-${t.id}-${i}`}
              href={`/tournaments/${t.id as string}`}
              className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-brand-dark leading-snug">{t.name as string}</p>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/20 text-brand-dark">Tournament</span>
              </div>
              {(t.location as any)?.name && (
                <p className="text-xs text-brand-muted">{(t.location as any).name}</p>
              )}
              {t.start_date && (
                <p className="text-xs text-brand-muted">{formatSessionDate(t.start_date as string)}</p>
              )}
            </Link>
          )
        }

        // league
        const l = item.data
        return (
          <Link
            key={`upcoming-l-${l.id}-${i}`}
            href={`/leagues/${l.id as string}`}
            className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark">{l.name as string}</p>
                <p className="text-xs text-brand-muted">
                  {FORMAT_LABELS[l.format as string] ?? (l.format as string)}
                  {formatSkillRange((l as any).skill_min, (l as any).skill_max)
                    ? ` · ${formatSkillRange((l as any).skill_min, (l as any).skill_max)}`
                    : ''}
                </p>
                {l.location_name && (
                  <p className="text-xs text-brand-muted">{l.location_name as string}</p>
                )}
                {(l as any).start_date && (
                  <p className="text-xs text-brand-muted">Starts {formatSessionDate((l as any).start_date as string)}</p>
                )}
              </div>
              <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-dark capitalize">
                {(l as any).registration_status === 'waitlist_only' ? 'Waitlist' : 'Open'}
              </span>
            </div>
          </Link>
        )
      })}
    </section>
  )
}

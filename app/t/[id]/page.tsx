import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import PublicTournamentBrackets from './PublicTournamentBrackets'
import PublicTournamentLive from './PublicTournamentLive'
import ViewerCount from '@/components/ui/ViewerCount'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Mask a full name to first-name-only — public spectator surfaces never expose full names or
// any contact info (docs/security.md).
const firstName = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || 'Player'

async function getTournament(id: string) {
  const { data } = await admin()
    .from('tournaments')
    .select('id, name, start_date, status, visibility, scheduling_method, show_seeds, location:locations!location_id(name)')
    .eq('id', id)
    .maybeSingle()
  return data as any
}

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const t = await getTournament(id)
  if (!t || t.status !== 'published' || t.visibility !== 'public') return { title: 'Tournament — Joinzer' }
  const where = t.location?.name ? ` at ${t.location.name}` : ''
  return {
    title: `${t.name} — Live Bracket · Joinzer`,
    description: `Live bracket and results for ${t.name}${where}.`,
    openGraph: { title: `${t.name} — Live Bracket`, description: 'Live pickleball tournament bracket on Joinzer.' },
  }
}

export default async function PublicTournamentPage({ params }: Params) {
  const { id } = await params
  const t = await getTournament(id)
  // Only published + public tournaments are viewable without auth (drafts / private are hidden).
  if (!t || t.status !== 'published' || t.visibility !== 'public') notFound()

  const db = admin()
  const [{ data: divisionsRaw }, { data: matchesRaw }, { data: regsRaw }] = await Promise.all([
    db.from('tournament_divisions')
      .select('id, name, format, bracket_type, format_settings_json, status, show_seeds')
      .eq('tournament_id', id).eq('status', 'active').order('created_at', { ascending: true }),
    db.from('tournament_matches')
      .select(`id, division_id, round_number, match_number, match_stage, pool_number, court_number,
        scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score,
        winner_registration_id, status, sequence_number, team_1_source, team_2_source`)
      .eq('tournament_id', id).eq('is_draft', false).order('match_number', { ascending: true }),
    // PII-safe: no email/phone selected. Names are resolved + masked below.
    db.from('tournament_registrations')
      .select('id, division_id, user_id, partner_user_id, team_name, status, seed')
      .eq('tournament_id', id).neq('status', 'cancelled'),
  ])

  const userIds = Array.from(
    new Set((regsRaw ?? []).flatMap((r: any) => [r.user_id, r.partner_user_id]).filter(Boolean)),
  )
  const { data: profilesRaw } = userIds.length > 0
    ? await db.from('profiles').select('id, name').in('id', userIds)
    : { data: [] as { id: string; name: string }[] }
  const firstNameById = new Map((profilesRaw ?? []).map((p: any) => [p.id, firstName(p.name)]))

  const matchesByDivision = new Map<string, any[]>()
  for (const m of matchesRaw ?? []) {
    if (!matchesByDivision.has(m.division_id)) matchesByDivision.set(m.division_id, [])
    matchesByDivision.get(m.division_id)!.push(m)
  }
  const regsByDivision = new Map<string, any[]>()
  for (const r of regsRaw ?? []) {
    const reg = {
      id: r.id, user_id: r.user_id, team_name: r.team_name, status: r.status, seed: r.seed ?? null,
      user_profile: firstNameById.get(r.user_id) ? { name: firstNameById.get(r.user_id)! } : null,
      partner_user_id: r.partner_user_id,
      partner_profile: r.partner_user_id && firstNameById.get(r.partner_user_id)
        ? { name: firstNameById.get(r.partner_user_id)! } : null,
    }
    if (!regsByDivision.has(r.division_id)) regsByDivision.set(r.division_id, [])
    regsByDivision.get(r.division_id)!.push(reg)
  }

  const divisions = (divisionsRaw ?? [])
    .map((d: any) => ({
      id: d.id, name: d.name, isDoubles: isDoublesFormat(d.format),
      isBracket: d.bracket_type === 'single_elimination' || d.bracket_type === 'double_elimination',
      pointsToWin: (d.format_settings_json as any)?.games_to ?? 11,
      showSeeds: d.show_seeds ?? t.show_seeds ?? false,
      matches: matchesByDivision.get(d.id) ?? [],
      regs: regsByDivision.get(d.id) ?? [],
    }))
    .filter((d) => d.matches.length > 0)

  const dateLabel = t.start_date
    ? new Date(t.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div className="min-h-screen bg-brand-page">
      <PublicTournamentLive tournamentId={id} />
      <header className="border-b border-brand-border bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="font-heading font-bold text-brand-dark">🏓 Joinzer</Link>
          <Link href="/login" className="text-xs font-semibold bg-brand text-brand-dark px-3 py-1.5 rounded-lg hover:bg-brand-hover transition-colors">
            Create free account
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-dark">{t.name}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-brand-muted">
              {[t.location?.name, dateLabel].filter(Boolean).join(' · ')}
              {(t.location?.name || dateLabel) ? ' · ' : ''}Live bracket
            </p>
            <ViewerCount topic={`tournament:${id}`} />
          </div>
        </div>

        {divisions.length > 0 ? (
          <PublicTournamentBrackets
            tournamentId={id}
            divisions={divisions}
            isRolling={t.scheduling_method === 'rolling'}
          />
        ) : (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
            <p className="text-2xl">🏓</p>
            <p className="text-sm text-brand-muted">The bracket hasn&apos;t been posted yet — check back once play begins.</p>
          </div>
        )}

        <p className="text-[11px] text-brand-muted text-center pt-4">
          Powered by <Link href="/" className="text-brand-active hover:underline">Joinzer</Link> — run your own pickleball tournament free.
        </p>
      </main>
    </div>
  )
}

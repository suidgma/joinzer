import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient as createAdmin } from '@supabase/supabase-js'
import type { Metadata } from 'next'
import LadderStandings from '@/app/(app)/leagues/[id]/standings/LadderStandings'
import BoxStandings from '@/app/(app)/leagues/[id]/standings/BoxStandings'
import StandingsTable from '@/app/(app)/leagues/[id]/standings/StandingsTable'
import { getLadderPublicStandings, getBoxPublicStandings, getRRPublicStandings } from '@/lib/leagues/publicStandings'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function getLeague(id: string) {
  const { data } = await admin()
    .from('leagues')
    .select('id, name, format, format_kind, format_settings_json, sub_credit_cap, standings_method, partner_mode, public_standings, status, location_name')
    .eq('id', id)
    .maybeSingle()
  return data as any
}

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const league = await getLeague(id)
  if (!league || league.public_standings !== true) return { title: 'Standings — Joinzer' }
  const where = league.location_name ? ` at ${league.location_name}` : ''
  return {
    title: `${league.name} — Standings · Joinzer`,
    description: `Live standings for ${league.name}${where}.`,
    openGraph: { title: `${league.name} — Standings`, description: `Live pickleball league standings on Joinzer.` },
  }
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
      <p className="text-2xl">📊</p>
      <p className="text-sm text-brand-muted">{msg}</p>
    </div>
  )
}

export default async function PublicLeagueStandingsPage({ params }: Params) {
  const { id } = await params
  const league = await getLeague(id)
  // Only accessible when the organizer has opted in and the league is live.
  if (!league || league.public_standings !== true || league.status !== 'active') notFound()

  const db = admin()
  const settings = (league.format_settings_json ?? null) as Record<string, unknown> | null

  // Round-robin renders a wide table (stats + per-week + trend columns); box/ladder
  // are card-based and read fine narrow. Match the authenticated player view: RR
  // gets a wider shell so the whole table fits without horizontal scrolling.
  const isNarrow = league.format_kind === 'box' || league.format_kind === 'ladder'
  const widthClass = isNarrow ? 'max-w-2xl' : 'max-w-5xl'

  let content: React.ReactNode
  if (league.format_kind === 'ladder') {
    const { rows, hasHistory } = await getLadderPublicStandings(db, id, league.format, settings)
    content = <LadderStandings rows={rows} hasHistory={hasHistory} />
  } else if (league.format_kind === 'box') {
    const { boxes } = await getBoxPublicStandings(db, id, league.format)
    content = boxes.length ? <BoxStandings boxes={boxes} /> : <EmptyState msg="Standings appear once the first cycle is completed." />
  } else {
    const rr = await getRRPublicStandings(db, id, league.sub_credit_cap ?? 7, (league.standings_method ?? 'win_loss') as any, league.partner_mode ?? null)
    content = rr.hasResults
      ? <StandingsTable initialStandings={rr.standings as any} sessionsWithData={rr.sessionsWithData} sessionPts={rr.sessionPts} sessionWL={rr.sessionWL} standingsMethod={rr.standingsMethod} />
      : <EmptyState msg="No results posted yet." />
  }

  return (
    <div className="min-h-screen bg-brand-page">
      <header className="border-b border-brand-border bg-white">
        <div className={`${widthClass} mx-auto px-4 py-3 flex items-center justify-between gap-3`}>
          <Link href="/" className="font-heading font-bold text-brand-dark">🏓 Joinzer</Link>
          <Link href="/login" className="text-xs font-semibold bg-brand text-brand-dark px-3 py-1.5 rounded-lg hover:bg-brand-hover transition-colors">
            Create free account
          </Link>
        </div>
      </header>
      <main className={`${widthClass} mx-auto px-4 py-6 space-y-4`}>
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-dark">{league.name}</h1>
          <p className="text-xs text-brand-muted">{league.location_name ? `${league.location_name} · ` : ''}Live standings</p>
        </div>
        {content}
        <p className="text-[11px] text-brand-muted text-center pt-4">
          Powered by <Link href="/" className="text-brand-active hover:underline">Joinzer</Link> — run your own pickleball league free.
        </p>
      </main>
    </div>
  )
}

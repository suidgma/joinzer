import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { ChevronLeft, Trophy } from 'lucide-react'
import { ratingDisplay } from '@/lib/rating/display'
import { loadPlayerResume } from '@/lib/profile/resume'
import PlayerHeroCard from './PlayerHeroCard'
import PlayerBadges from './PlayerBadges'
import PlayerAchievements from './PlayerAchievements'
import PlayerRatingSummary from './PlayerRatingSummary'
import PlayerCareerStats from './PlayerCareerStats'
import PlayerRecentForm from './PlayerRecentForm'
import PlayerAboutSection from './PlayerAboutSection'
import PlayerUpcomingEvents from './PlayerUpcomingEvents'
import PlayerEventHistory from './PlayerEventHistory'

// Public player-profile résumé. Reads via the service role (rating tables are RLS
// deny-all); the loader returns only PII-safe fields. See docs/phases/player-profile-phase1.md.
export default async function PlayerProfilePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const resume = await loadPlayerResume(admin, id)
  if (!resume) notFound()

  const isSelf = user?.id === resume.profile.id
  // Directory privacy opt-out: a non-discoverable player's profile is visible to
  // themselves only. Treat as not-found for everyone else.
  if (!resume.profile.discoverable && !isSelf) notFound()
  const rd = ratingDisplay(resume.profile)

  // Surface a link to the organizer-identity page when this player hosts anything.
  const [{ count: tCount }, { count: lCount }] = await Promise.all([
    admin.from('tournaments').select('id', { count: 'exact', head: true }).eq('organizer_id', id),
    admin.from('leagues').select('id', { count: 'exact', head: true }).eq('created_by', id),
  ])
  const isOrganizer = (tCount ?? 0) + (lCount ?? 0) > 0

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/players" className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark">
        <ChevronLeft className="w-4 h-4" />
        Players
      </Link>

      <PlayerHeroCard profile={resume.profile} rd={rd} />
      <PlayerBadges badges={resume.badges} />
      {isOrganizer && (
        <Link
          href={`/organizers/${resume.profile.id}`}
          className="flex items-center justify-between gap-2 bg-brand-surface border border-brand-border rounded-2xl px-5 py-3 hover:border-brand-active transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-brand-dark">
            <Trophy className="w-4 h-4 text-brand-active" />
            Organizer
          </span>
          <span className="text-sm text-brand-muted">View hosted events →</span>
        </Link>
      )}
      <PlayerRatingSummary profile={resume.profile} rd={rd} ratings={resume.ratings} />
      <PlayerAchievements placements={resume.placements} />
      <PlayerCareerStats stats={resume.stats} />
      <PlayerRecentForm stats={resume.stats} />
      <PlayerUpcomingEvents upcoming={resume.upcoming} />
      <PlayerEventHistory history={resume.history} />
      <PlayerAboutSection profile={resume.profile} isSelf={isSelf} />

      {isSelf && (
        <Link href="/profile/edit" className="block text-center text-sm font-medium text-brand-active hover:underline">
          Edit your profile
        </Link>
      )}
    </main>
  )
}

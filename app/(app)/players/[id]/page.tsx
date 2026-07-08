import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { ChevronLeft } from 'lucide-react'
import { ratingDisplay } from '@/lib/rating/display'
import { loadPlayerResume } from '@/lib/profile/resume'
import PlayerHeroCard from './PlayerHeroCard'
import PlayerRatingSummary from './PlayerRatingSummary'
import PlayerCareerStats from './PlayerCareerStats'
import PlayerRecentForm from './PlayerRecentForm'
import PlayerAboutSection from './PlayerAboutSection'
import PlayerUpcomingEvents from './PlayerUpcomingEvents'

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
  const rd = ratingDisplay(resume.profile)

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/players" className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark">
        <ChevronLeft className="w-4 h-4" />
        Players
      </Link>

      <PlayerHeroCard profile={resume.profile} rd={rd} />
      <PlayerRatingSummary profile={resume.profile} rd={rd} ratings={resume.ratings} />
      <PlayerCareerStats stats={resume.stats} />
      <PlayerRecentForm stats={resume.stats} />
      <PlayerUpcomingEvents upcoming={resume.upcoming} />
      <PlayerAboutSection profile={resume.profile} isSelf={isSelf} />

      {isSelf && (
        <Link href="/profile/edit" className="block text-center text-sm font-medium text-brand-active hover:underline">
          Edit your profile
        </Link>
      )}
    </main>
  )
}

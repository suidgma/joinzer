import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import RatingBadge from '@/components/features/RatingBadge'
import { ratingDisplay } from '@/lib/rating/display'
import Sparkline from '@/components/ui/sparkline'
import { ChevronLeft } from 'lucide-react'

export default async function PlayerProfilePage(
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, display_name, profile_photo_url, rating_source, dupr_rating, estimated_rating, self_reported_rating, self_reported_scale, dupr_verified, primary_joinzer_score, primary_joinzer_level, primary_confidence, primary_games, primary_score_history, gender')
    .eq('id', id)
    .single()

  if (!profile) notFound()

  const isSelf = user?.id === profile.id

  const displayName = (profile.display_name ?? profile.name) as string
  const selfRating: number | null =
    (profile.self_reported_rating as number | null) ??
    ((profile.rating_source === 'estimated' ? profile.estimated_rating : profile.rating_source === 'dupr_known' ? profile.dupr_rating : null) as number | null)
  const selfScale: string | null =
    (profile.self_reported_scale as string | null) ??
    (profile.rating_source === 'dupr_known' ? 'dupr' : profile.rating_source === 'estimated' ? 'self' : null)
  const rd = ratingDisplay({ ...(profile as any), self_reported_rating: selfRating, self_reported_scale: selfScale })

  return (
    <main className="max-w-lg mx-auto p-4">
      {/* Back */}
      <Link href="/players" className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark mb-4">
        <ChevronLeft className="w-4 h-4" />
        Players
      </Link>

      {/* Profile card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
        {/* Header strip */}
        <div className="bg-brand/10 px-6 pt-8 pb-4 flex flex-col items-center gap-3">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full overflow-hidden bg-brand-soft border-2 border-brand-border flex items-center justify-center">
            {profile.profile_photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.profile_photo_url as string}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-muted" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            )}
          </div>

          <div className="text-center">
            <h1 className="font-heading font-bold text-xl text-brand-dark">{displayName}</h1>
            <div className="flex items-center justify-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-brand-active font-medium">{rd.level}</span>
              <RatingBadge
                selfReportedRating={selfRating}
                selfReportedScale={selfScale}
                duprRating={profile.dupr_rating as number | null}
                duprVerified={profile.dupr_verified as boolean | null}
                size="sm"
              />
            </div>
            {rd.kind === 'earned' && (
              <div className="flex items-center justify-center gap-2 mt-1">
                <p className="text-sm text-brand-dark">
                  <span className="font-semibold text-brand-active">Joinzer Score {rd.score}</span>
                  <span className="text-xs text-brand-muted"> · {rd.state === 'rusty' ? 'Rusty' : 'Established'}{rd.games != null ? ` · ${rd.games} matches` : ''}</span>
                </p>
                {Array.isArray((profile as any).primary_score_history) && (profile as any).primary_score_history.length >= 2 && (
                  <Sparkline values={(profile as any).primary_score_history as number[]} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-6 py-5 space-y-4">
          {profile.gender && (
            <div>
              <p className="text-xs text-brand-muted uppercase tracking-wide font-medium mb-0.5">Gender</p>
              <p className="text-sm text-brand-dark capitalize">{profile.gender as string}</p>
            </div>
          )}

          {!profile.gender && (
            <p className="text-sm text-brand-muted text-center py-4">This player hasn't added any details yet.</p>
          )}
        </div>

        {/* Self-edit shortcut */}
        {isSelf && (
          <div className="px-6 pb-5">
            <Link
              href="/profile/edit"
              className="block w-full text-center text-sm font-medium text-brand-active hover:underline"
            >
              Edit your profile
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}

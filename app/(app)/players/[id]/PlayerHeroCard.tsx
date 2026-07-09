import type { RatingDisplay } from '@/lib/rating/display'
import type { ResumeProfile } from '@/lib/profile/resume'

const scaleLabel = (scale: string | null) => (scale === 'dupr' ? 'DUPR' : scale === 'self' ? 'self-rated' : '')

// Hero identity card: photo, name, Joinzer Level, and member-since / home-court meta.
// For earned players the numeric Score/confidence lives in the Rating card below — the
// hero shows only the Level to avoid repeating it. Self-reported players keep their line
// (the only place the self-rated number appears).
export default function PlayerHeroCard({ profile, rd }: { profile: ResumeProfile; rd: RatingDisplay }) {
  const name = profile.displayName ?? profile.name ?? 'Player'
  const meta = [
    profile.memberSinceYear ? `Member since ${profile.memberSinceYear}` : null,
    profile.homeCourtName ? `Home court: ${profile.homeCourtName}` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
      <div className="bg-brand/10 px-6 pt-8 pb-5 flex flex-col items-center gap-3 text-center">
        <div className="w-24 h-24 rounded-full overflow-hidden bg-brand-soft border-2 border-brand-border flex items-center justify-center">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photoUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-muted" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          )}
        </div>

        <div>
          <h1 className="font-heading font-bold text-xl text-brand-dark">{name}</h1>
          <p className="text-sm text-brand-active font-medium mt-0.5">{rd.level}</p>
          {rd.kind !== 'earned' && (
            <p className="text-sm text-brand-muted mt-1">
              {rd.selfRating != null
                ? `Self-reported ${rd.selfRating}${scaleLabel(rd.selfScale) ? ` ${scaleLabel(rd.selfScale)}` : ''}`
                : 'No rating yet'}
            </p>
          )}
        </div>

        {meta.length > 0 && (
          <p className="text-xs text-brand-muted">{meta.join(' · ')}</p>
        )}
      </div>
    </div>
  )
}

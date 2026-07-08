import Link from 'next/link'
import type { ResumeProfile } from '@/lib/profile/resume'

const HAND: Record<string, string> = { left: 'Left-handed', right: 'Right-handed', ambidextrous: 'Ambidextrous' }
const SIDE: Record<string, string> = { left: 'Prefers left side', right: 'Prefers right side', either: 'Either side' }
const FMT: Record<string, string> = { singles: 'Singles', doubles: 'Doubles', mixed: 'Mixed Doubles' }

// Bio + preferred-play. Hidden when empty (a nudge shows instead on the viewer's own profile).
export default function PlayerAboutSection({ profile, isSelf }: { profile: ResumeProfile; isSelf: boolean }) {
  const hasFormats = profile.preferredFormats.length > 0
  const hasPreferred = hasFormats || !!profile.dominantHand || !!profile.preferredSide
  const hasAny = !!profile.bio || hasPreferred

  if (!hasAny) {
    if (!isSelf) return null
    return (
      <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 text-center space-y-1">
        <p className="text-sm text-brand-muted">Add a bio and preferred play so people know your game.</p>
        <Link href="/profile/edit" className="inline-block text-sm font-medium text-brand-active hover:underline">Add details →</Link>
      </section>
    )
  }

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-4">
      {profile.bio && (
        <div>
          <h2 className="font-heading text-base font-bold text-brand-dark">About</h2>
          <p className="text-sm text-brand-body mt-1 whitespace-pre-line">{profile.bio}</p>
        </div>
      )}
      {hasPreferred && (
        <div>
          <h3 className="text-xs font-bold text-brand-muted uppercase tracking-wide mb-1.5">Preferred play</h3>
          <div className="flex flex-wrap gap-1.5">
            {profile.preferredFormats.map((f) => (
              <span key={f} className="text-xs bg-brand-soft rounded-lg px-2 py-1 text-brand-dark">{FMT[f] ?? f}</span>
            ))}
            {profile.dominantHand && (
              <span className="text-xs bg-brand-soft rounded-lg px-2 py-1 text-brand-dark">{HAND[profile.dominantHand] ?? profile.dominantHand}</span>
            )}
            {profile.preferredSide && (
              <span className="text-xs bg-brand-soft rounded-lg px-2 py-1 text-brand-dark">{SIDE[profile.preferredSide] ?? profile.preferredSide}</span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

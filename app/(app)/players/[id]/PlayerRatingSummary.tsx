import RatingBadge from '@/components/features/RatingBadge'
import Sparkline from '@/components/ui/sparkline'
import type { RatingDisplay } from '@/lib/rating/display'
import type { ResumeProfile, ResumeFormatRating } from '@/lib/profile/resume'

// Rating detail block: earned Joinzer Score + Level + confidence + games + trend +
// per-format breakdown, else the self-reported status; plus a secondary DUPR line
// (only when a DUPR exists, verified vs self-entered per RatingBadge).
export default function PlayerRatingSummary({
  profile,
  rd,
  ratings,
}: {
  profile: ResumeProfile
  rd: RatingDisplay
  ratings: ResumeFormatRating[]
}) {
  const history = profile.primary_score_history
  const perFormat = ratings
    .filter((r) => r.score != null)
    .sort((a, b) => (a.format < b.format ? -1 : 1))
  // Only surface DUPR when it's a *declared* DUPR — verified, or self-entered on the DUPR
  // scale. A stale dupr_rating column alongside a self-reported estimate is not a DUPR.
  const showDupr = profile.dupr_rating != null && (profile.dupr_verified === true || profile.self_reported_scale === 'dupr')

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-3">
      <h2 className="font-heading text-base font-bold text-brand-dark">Rating</h2>

      {rd.kind === 'earned' ? (
        <>
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <p className="text-3xl font-extrabold text-brand-dark leading-none">{rd.score}</p>
              <p className="text-[11px] text-brand-muted mt-1">Joinzer Score</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-brand-dark">{rd.level}</p>
              <p className="text-xs text-brand-muted">
                {rd.state === 'rusty' ? 'Rusty' : 'Established'}{rd.games != null ? ` · ${rd.games} matches` : ''}
              </p>
            </div>
            {Array.isArray(history) && history.length >= 2 && <Sparkline values={history} />}
          </div>

          {perFormat.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {perFormat.map((r) => (
                <span key={r.format} className="text-xs bg-brand-soft rounded-lg px-2 py-1 text-brand-dark capitalize">
                  {r.format}: <span className="font-semibold">{r.score}</span>{r.games ? ` · ${r.games}g` : ''}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-brand-dark">{rd.level}</p>
          <p className="text-xs text-brand-muted">Self-reported. Play competitive matches to earn a Joinzer Score.</p>
        </div>
      )}

      {showDupr && (
        <div className="pt-1 border-t border-brand-border/50">
          <p className="text-[11px] text-brand-muted uppercase tracking-wide mb-1">External rating</p>
          <RatingBadge
            selfReportedRating={profile.self_reported_rating}
            selfReportedScale={profile.self_reported_scale}
            duprRating={profile.dupr_rating}
            duprVerified={profile.dupr_verified}
            size="sm"
          />
        </div>
      )}
    </section>
  )
}

import { Fragment } from 'react'
import RatingBadge from '@/components/features/RatingBadge'
import Sparkline from '@/components/ui/sparkline'
import type { RatingDisplay } from '@/lib/rating/display'
import type { ResumeProfile, ResumeFormatRating } from '@/lib/profile/resume'

// Rating detail block: earned Joinzer Score + Level + confidence, a per-format
// breakdown (most-played on top, headline format marked), and the trend line —
// else the self-reported status; plus a secondary DUPR line (only when a DUPR
// exists, verified vs self-entered per RatingBadge).
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
  // Order the breakdown by volume: most-played format first (score-desc tiebreak).
  const perFormat = ratings
    .filter((r) => r.score != null)
    .sort((a, b) => (b.games ?? 0) - (a.games ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  // The headline Score comes from the player's primary format, which isn't always the
  // most-played — mark that row so the big number is traceable to its format.
  const primaryScore = rd.kind === 'earned' ? rd.score : null
  const primaryGames = rd.kind === 'earned' ? rd.games : null
  const isPrimaryFormat = (r: ResumeFormatRating) =>
    primaryScore != null && r.score === primaryScore && (primaryGames == null || r.games === primaryGames)
  // Only surface DUPR when it's a *declared* DUPR — verified, or self-entered on the DUPR
  // scale. A stale dupr_rating column alongside a self-reported estimate is not a DUPR.
  const showDupr = profile.dupr_rating != null && (profile.dupr_verified === true || profile.self_reported_scale === 'dupr')

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-3">
      <h2 className="font-heading text-base font-bold text-brand-dark">Rating</h2>

      {rd.kind === 'earned' ? (
        <>
          <div className="flex items-start gap-4">
            {/* Headline: the primary-format Joinzer Score + Level + confidence */}
            <div className="shrink-0">
              <p className="text-4xl font-extrabold text-brand-dark leading-none">{rd.score}</p>
              <p className="text-[11px] text-brand-muted mt-1">Joinzer Score</p>
              <p className="text-sm font-semibold text-brand-dark mt-2">{rd.level}</p>
              <p className="text-[11px] text-brand-muted">
                {rd.state === 'rusty' ? 'Rusty' : 'Established'}
                {perFormat.length === 0 && rd.games != null ? ` · ${rd.games} games` : ''}
              </p>
            </div>

            {/* Per-format breakdown, stacked most-played first */}
            {perFormat.length > 0 && (
              <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-xs self-center">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Format</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted text-right">Games</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted text-right">Score</span>
                {perFormat.map((r) => {
                  const primary = isPrimaryFormat(r)
                  const rowColor = primary ? 'text-brand-dark font-semibold' : 'text-brand-muted'
                  return (
                    <Fragment key={r.format}>
                      <span className={`capitalize flex items-center gap-1.5 ${rowColor}`}>
                        {primary && <span className="w-1.5 h-1.5 rounded-full bg-brand-active shrink-0" aria-hidden />}
                        {r.format}
                      </span>
                      <span className={`text-right tabular-nums ${rowColor}`}>{r.games ?? '—'}</span>
                      <span className={`text-right tabular-nums ${rowColor}`}>{r.score}</span>
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>

          {Array.isArray(history) && history.length >= 2 && (
            <div className="flex items-center justify-between border-t border-brand-border/50 pt-2">
              <span className="text-[11px] text-brand-muted">Score trend</span>
              <Sparkline values={history} />
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

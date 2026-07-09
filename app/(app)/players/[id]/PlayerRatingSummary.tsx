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
      <h2 className="font-heading text-lg font-bold text-brand-dark">{rd.kind === 'earned' ? 'Joinzer Score' : 'Rating'}</h2>

      {rd.kind === 'earned' ? (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          {/* Headline: the primary-format Joinzer Score + confidence + Level. Number and
              labels sit side-by-side on mobile, stack under the number on wider screens. */}
          <div className="shrink-0 flex items-center gap-3 sm:block sm:text-center">
            <p className="text-4xl sm:text-5xl font-extrabold text-brand-dark leading-none">{rd.score}</p>
            <div className="sm:mt-1.5">
              <p className="text-[11px] text-brand-muted">{rd.state === 'rusty' ? 'Rusty' : 'Established'}</p>
              <p className="text-sm font-semibold text-brand-active">{rd.level}</p>
            </div>
          </div>

          {/* Per-format breakdown table (most-played first) with a per-format trendline */}
          {perFormat.length > 0 && (
            <div className="flex-1 min-w-0 grid grid-cols-[auto_auto_auto_auto] items-center justify-end gap-x-6 gap-y-1.5 text-xs">
              <span className="text-[11px] font-medium text-brand-muted leading-tight">Format</span>
              <span className="text-[11px] font-medium text-brand-muted text-center leading-tight">Games<br />Played</span>
              <span className="text-[11px] font-medium text-brand-muted text-center leading-tight">Joinzer<br />Score</span>
              <span className="text-[11px] font-medium text-brand-muted text-center leading-tight">Trend</span>
              {perFormat.map((r) => {
                const primary = isPrimaryFormat(r)
                const weight = primary ? 'font-semibold' : 'font-normal'
                return (
                  <Fragment key={r.format}>
                    <span className={`capitalize text-brand-dark ${weight}`}>{r.format}</span>
                    <span className={`text-center tabular-nums text-brand-dark ${weight}`}>{r.games ?? '—'}</span>
                    <span className={`text-center tabular-nums text-brand-dark ${weight}`}>{r.score}</span>
                    <span className="flex justify-center">
                      {r.history.length >= 2
                        ? <Sparkline values={r.history} />
                        : <span className="text-brand-muted text-[11px]">—</span>}
                    </span>
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>
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

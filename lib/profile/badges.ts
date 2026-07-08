// Compute-on-read player badges (Phase 2). No table, no tracking system — purely derived
// from career stats + membership each render. Placement/behavior badges (League Champion,
// Great Partner, …) are deferred to Phase 3. See docs/phases/player-profile-phase1.md §8.

export type Badge = { key: string; label: string; emoji: string }

// Founding-cohort window — players who joined in the launch year.
const EARLY_MEMBER_BEFORE = '2027-01-01'

export type BadgeInput = {
  createdAt: string | null
  confidence: string | null
  matches: number
  leaguesPlayed: number
  tournamentsPlayed: number
  currentStreak: { type: 'W' | 'L'; count: number } | null
}

export function computeBadges(input: BadgeInput): Badge[] {
  const badges: Badge[] = []

  if (input.confidence === 'established' || input.confidence === 'rusty') {
    badges.push({ key: 'established', label: 'Established Rating', emoji: '📊' })
  }

  // Highest match milestone only.
  if (input.matches >= 100) badges.push({ key: 'm100', label: '100 Matches', emoji: '💯' })
  else if (input.matches >= 50) badges.push({ key: 'm50', label: '50 Matches', emoji: '🏅' })
  else if (input.matches >= 10) badges.push({ key: 'm10', label: '10 Matches', emoji: '🎯' })

  if (input.currentStreak?.type === 'W' && input.currentStreak.count >= 5) {
    badges.push({ key: 'streak', label: `${input.currentStreak.count}-Win Streak`, emoji: '🔥' })
  }

  if (input.tournamentsPlayed >= 1) badges.push({ key: 'tournament', label: 'Tournament Player', emoji: '🎾' })
  if (input.leaguesPlayed >= 1) badges.push({ key: 'league', label: 'League Player', emoji: '🏆' })

  if (input.createdAt && input.createdAt < EARLY_MEMBER_BEFORE) {
    badges.push({ key: 'early', label: 'Early Member', emoji: '🌱' })
  }

  return badges
}

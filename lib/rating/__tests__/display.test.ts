import { describe, it, expect } from 'vitest'
import { ratingDisplay } from '../display'

describe('ratingDisplay', () => {
  it('shows the earned Joinzer Score when Established', () => {
    const d = ratingDisplay({ primary_joinzer_score: 74, primary_joinzer_level: 'Advanced', primary_confidence: 'established', primary_games: 46, self_reported_rating: 3.5, self_reported_scale: 'self' })
    expect(d).toEqual({ kind: 'earned', level: 'Advanced', score: 74, state: 'established', games: 46 })
  })

  it('shows the earned Score when Rusty too', () => {
    const d = ratingDisplay({ primary_joinzer_score: 60, primary_joinzer_level: 'Intermediate', primary_confidence: 'rusty', primary_games: 20 })
    expect(d.kind).toBe('earned')
    if (d.kind === 'earned') expect(d.state).toBe('rusty')
  })

  it('falls back to self-reported Level while Provisional', () => {
    const d = ratingDisplay({ primary_joinzer_score: 55, primary_joinzer_level: 'Intermediate', primary_confidence: 'provisional', self_reported_rating: 3.5, self_reported_scale: 'self' })
    expect(d).toMatchObject({ kind: 'selfReported', level: 'Intermediate', selfRating: 3.5 })
  })

  it('falls back to self-reported when there is no calculated rating', () => {
    const d = ratingDisplay({ self_reported_rating: 4.0, self_reported_scale: 'dupr' })
    expect(d).toMatchObject({ kind: 'selfReported', level: 'Advanced', selfScale: 'dupr' })
  })

  it('New Player when nothing is known', () => {
    expect(ratingDisplay({})).toMatchObject({ kind: 'selfReported', level: 'New Player', selfRating: null })
  })
})

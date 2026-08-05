/**
 * The approximate-location label (ADR-16).
 *
 * The interesting assertions here are not "does the string equal the string" — they are about the
 * two ways this feature can be WRONG in production: labelling a row we are confident about, and
 * failing to label one we are not. The second is the harmful direction, because it puts an
 * unqualified pin on a public page for a venue whose building we never located.
 */
import { describe, expect, it } from 'vitest'
import {
  APPROXIMATE_PRECISION,
  APPROXIMATE_LOCATION_DETAIL,
  APPROXIMATE_LOCATION_SHORT,
  isApproximateLocation,
} from '../locationPrecision'

describe('isApproximateLocation', () => {
  it('labels only low-precision rows', () => {
    expect(isApproximateLocation('low')).toBe(true)
    expect(isApproximateLocation('medium')).toBe(false)
    expect(isApproximateLocation('high')).toBe(false)
  })

  /**
   * NULL means the row carries no coordinate node at all. Such a row cannot publish (the gate holds
   * it on 'no coordinate'), so this branch should be unreachable on a rendered page — but if it ever
   * IS reached, the safe answer is "do not claim the pin is merely approximate", because there is no
   * pin. Returning true here would attach a reassuring caveat to a row with no location at all.
   */
  it('does not label a row that has no precision recorded', () => {
    expect(isApproximateLocation(null)).toBe(false)
    expect(isApproximateLocation(undefined)).toBe(false)
    expect(isApproximateLocation('')).toBe(false)
  })

  it('does not label on an unrecognized precision tier', () => {
    // A future tier must be opted IN to the label deliberately. Defaulting an unknown value to
    // "approximate" would silently caveat rows a new classifier was more confident about.
    expect(isApproximateLocation('rooftop')).toBe(false)
    expect(isApproximateLocation('LOW')).toBe(false) // the stored vocabulary is lowercase
  })

  it('pins the stored vocabulary value', () => {
    expect(APPROXIMATE_PRECISION).toBe('low')
  })
})

describe('the label copy', () => {
  /**
   * The copy makes a claim about OUR data, not about the venue. "Location approximate" on its own
   * reads to some as though the venue itself is doubtful; these courts are real and researched, and
   * the only thing in question is the pin. Asserted because it is a deliberate wording decision that
   * a later tightening pass would otherwise "simplify" out.
   */
  it('says what we do know, not just what we do not', () => {
    expect(APPROXIMATE_LOCATION_DETAIL).toContain('street')
    expect(APPROXIMATE_LOCATION_DETAIL).toContain('building')
  })

  it('never asserts the venue is uncertain', () => {
    expect(APPROXIMATE_LOCATION_DETAIL.toLowerCase()).not.toContain('unverified')
    expect(APPROXIMATE_LOCATION_DETAIL.toLowerCase()).not.toContain('may not exist')
  })

  it('keeps the list form short enough not to swamp a venue name', () => {
    expect(APPROXIMATE_LOCATION_SHORT.length).toBeLessThan(30)
  })
})

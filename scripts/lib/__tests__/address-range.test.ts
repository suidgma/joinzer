/**
 * ADDRESS RANGES — the cheap pre-flight for a coordinate failure that is deterministic.
 *
 * "132-198 Chestnut St" names a stretch of street, not a point. No geocoder resolves it to one, so
 * the structured rung has no house number to match and the ladder lands on the road centreline. That
 * is not a Nominatim quirk to be worked around; it is the correct answer to the question we asked.
 *
 * The pair of assertions that matters here is the LINK between the two functions: `houseNumberOf`
 * returning null is the mechanism, and `houseNumberRangeOf` returning a match is the explanation. A
 * change that made `houseNumberOf` permissive enough to read "132" out of "132-198" would silently
 * start geocoding venues to a house number they do not have, so both are pinned together.
 */
import { describe, expect, it } from 'vitest'
import { houseNumberOf, houseNumberRangeOf } from '../geocode-nominatim.mjs'

const num = houseNumberOf as (a: unknown) => string | null
const range = houseNumberRangeOf as (a: unknown) => { raw: string; from: string; to: string } | null

describe('houseNumberRangeOf', () => {
  it('reads the pilot case — William J Farley Community Park, Phoenix NY', () => {
    expect(range('132-198 Chestnut St, Phoenix, NY')).toEqual({ raw: '132-198', from: '132', to: '198' })
    // ...and the reason it matters: the ladder has no number to match on this row.
    expect(num('132-198 Chestnut St, Phoenix, NY')).toBeNull()
  })

  it('tolerates the spacing and dash characters a workbook actually carries', () => {
    expect(range('100 - 140 Main Street')?.to).toBe('140')
    expect(range('100–140 Main Street')?.to).toBe('140')   // en dash
    expect(range('100—140 Main Street')?.to).toBe('140')   // em dash
    expect(range('12-14, Elm Ave')?.to).toBe('14')
  })

  it('stays silent on an ordinary address, which is the other 1,700 rows', () => {
    expect(range('1000 Hicks Avenue')).toBeNull()
    expect(range('5950 E Taft Rd, North Syracuse, NY 13212')).toBeNull()
    expect(range('')).toBeNull()
    expect(range(null)).toBeNull()
    expect(range(undefined)).toBeNull()
  })

  it('does not fire on a hyphen that is not between two leading numbers', () => {
    expect(range('7350 Canton St')).toBeNull()
    expect(range('221 Bur-Mil Club Road')).toBeNull()
    expect(range('One Arkie Albanese Ave')).toBeNull()
  })

  it('matches the Queens shape too — reported, not resolved', () => {
    // "132-05 41st Ave" is a REAL house number in Queens, not a range, and nothing in the string
    // distinguishes it from one. The check therefore reports the shape and its consequence and leaves
    // the call to a human; it is a note, and nothing downstream branches on it.
    expect(range('132-05 41st Ave, Flushing, NY')).toEqual({ raw: '132-05', from: '132', to: '05' })
  })
})

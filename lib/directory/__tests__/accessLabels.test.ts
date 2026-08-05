/**
 * Access-type labels (ADR-17).
 *
 * These assertions are about the two ways this can be wrong in production, not about string
 * equality. Under the old gate `access_type='unknown'` held the row, so the label never rendered and
 * the two surfaces were free to disagree — list rows mapped it to `''`, the venue page to "Access
 * varies". Coverage-first publishes those rows, so the label became the only thing telling a reader
 * we do not know the access rules, and both surfaces have to say so.
 *
 * The harmful direction is silence: a published row showing no access information at all reads as
 * though we simply had nothing to say, rather than as "we looked and could not find out".
 */
import { describe, expect, it } from 'vitest'
import {
  ACCESS_UNKNOWN_DETAIL,
  ACCESS_UNKNOWN_SHORT,
  KNOWN_ACCESS_TYPES,
  accessLabel,
} from '../accessLabels'

/** Mirrors the CHECK constraint on facility_listings.access_type. */
const CHECK_VOCABULARY = ['public', 'private', 'membership', 'school', 'hoa', 'unknown']

describe('the unknown label — the whole of ADR-17 on the render side', () => {
  /** This returned '' on list rows before ADR-17, which rendered nothing at all. */
  it('renders on BOTH surfaces rather than being suppressed', () => {
    expect(accessLabel('unknown', 'detail')).toBe(ACCESS_UNKNOWN_DETAIL)
    expect(accessLabel('unknown', 'short')).toBe(ACCESS_UNKNOWN_SHORT)
    expect(accessLabel('unknown', 'detail')).toBeTruthy()
    expect(accessLabel('unknown', 'short')).toBeTruthy()
  })

  /**
   * The owner's ruling is specifically that the reader is told what to DO. A label that says only
   * "unknown" states our ignorance without resolving it; the venue page is where someone decides
   * whether to drive somewhere, so that is where the instruction has to be.
   */
  it('carries the call to action on the detail surface', () => {
    expect(ACCESS_UNKNOWN_DETAIL).toMatch(/call ahead/i)
  })

  /**
   * The short form exists so a metro list stays scannable. If it ever grows to the full sentence it
   * will swamp two sibling chips in a right-aligned text-xs column, so the length relationship is
   * pinned rather than left to whoever edits the string next.
   */
  it('keeps the list form shorter than the detail form, and still a phrase', () => {
    expect(ACCESS_UNKNOWN_SHORT.length).toBeLessThan(ACCESS_UNKNOWN_DETAIL.length)
    expect(ACCESS_UNKNOWN_SHORT).toMatch(/unknown/i)
    expect(ACCESS_UNKNOWN_SHORT.length).toBeLessThan(25)
  })

  /**
   * 'unknown' and NULL are DIFFERENT FACTS and the directory has conflated them before.
   * 'unknown' is stored and means "researched, undetermined"; NULL means "never researched"
   * (migration 20260724000002). Labelling NULL would claim a research pass that never happened and
   * overstate our coverage.
   */
  it('renders nothing for a row that was never researched', () => {
    expect(accessLabel(null, 'detail')).toBeNull()
    expect(accessLabel(undefined, 'detail')).toBeNull()
    expect(accessLabel('', 'short')).toBeNull()
  })
})

describe('the affirmative labels', () => {
  it('labels every stored access type on both surfaces', () => {
    for (const value of CHECK_VOCABULARY) {
      expect(accessLabel(value, 'detail'), `detail label for ${value}`).toBeTruthy()
      expect(accessLabel(value, 'short'), `short label for ${value}`).toBeTruthy()
    }
  })

  /**
   * The guard against a vocabulary change landing in the database ahead of this map. A new
   * access_type would otherwise render `undefined` on a public page.
   */
  it('covers exactly the CHECK vocabulary — no more, no less', () => {
    expect([...KNOWN_ACCESS_TYPES].sort()).toEqual([...CHECK_VOCABULARY].sort())
  })

  it('renders nothing for an unrecognized value rather than "undefined"', () => {
    expect(accessLabel('resort', 'detail')).toBeNull()
    expect(accessLabel('PUBLIC', 'detail')).toBeNull() // the stored vocabulary is lowercase
  })

  /** Only 'unknown' differs between the two surfaces; the rest must not drift apart. */
  it('uses identical wording on both surfaces for every affirmative value', () => {
    for (const value of CHECK_VOCABULARY.filter((v) => v !== 'unknown')) {
      expect(accessLabel(value, 'detail')).toBe(accessLabel(value, 'short'))
    }
  })
})

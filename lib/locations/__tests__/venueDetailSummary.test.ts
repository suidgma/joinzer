/**
 * The reviewer must be able to tell "they said no" from "they didn't say". Rendering a NULL as
 * "No" or "Unknown" destroys that distinction, which is the same corruption the write path avoids
 * by never storing 'unknown' for a skipped field.
 */
import { describe, expect, it } from 'vitest'
import { summarizeVenueDetail, type SubmittedVenueDetail } from '../venueDetailSummary'

const EMPTY: SubmittedVenueDetail = {
  court_count: null,
  court_configuration: null,
  indoor: null,
  surface: null,
  lighting: null,
  line_type: null,
  net_setup: null,
  nets_provided_count: null,
  access_type: null,
  fee_type: null,
  reservation_policy: null,
  reservation_url: null,
  website: null,
  phone: null,
  restrooms: null,
  water_fountain: null,
  accessibility: null,
  parking: null,
  public_notes: null,
}

describe('summarizeVenueDetail', () => {
  it('shows nothing for a submission with no optional detail', () => {
    expect(summarizeVenueDetail(EMPTY)).toEqual({ entries: [], notes: null })
  })

  it('handles a missing listing entirely', () => {
    expect(summarizeVenueDetail(null)).toEqual({ entries: [], notes: null })
    expect(summarizeVenueDetail(undefined)).toEqual({ entries: [], notes: null })
  })

  it('omits unanswered fields rather than labelling them', () => {
    const { entries } = summarizeVenueDetail({ ...EMPTY, court_count: 4 })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ label: 'Courts', value: '4' })
  })

  it('distinguishes "no" from "not answered"', () => {
    const { entries } = summarizeVenueDetail({ ...EMPTY, restrooms: false })
    expect(entries).toEqual([{ label: 'Restrooms', value: 'No' }])
    // …whereas a null produces no row at all, tested above.
  })

  it('renders true as Yes', () => {
    const { entries } = summarizeVenueDetail({ ...EMPTY, lighting: true })
    expect(entries).toEqual([{ label: 'Lights', value: 'Yes' }])
  })

  it('keeps zero, which is a real answer', () => {
    const { entries } = summarizeVenueDetail({ ...EMPTY, nets_provided_count: 0 })
    expect(entries).toEqual([{ label: 'Nets provided', value: '0' }])
  })

  it('humanizes the enum vocabulary', () => {
    const { entries } = summarizeVenueDetail({
      ...EMPTY,
      court_configuration: 'shared_multi_use',
      access_type: 'hoa',
      reservation_policy: 'reservation_required',
    })
    expect(entries.map((e) => e.value)).toEqual([
      'Shared / multi-use',
      'HOA',
      'Booking required',
    ])
  })

  it('falls back to the raw value for vocabulary it has no label for', () => {
    const { entries } = summarizeVenueDetail({ ...EMPTY, surface: 'brand_new_surface' })
    expect(entries[0].value).toBe('brand_new_surface')
  })

  it('marks URL fields as links and leaves the rest plain', () => {
    const { entries } = summarizeVenueDetail({
      ...EMPTY,
      website: 'https://example.com',
      phone: '702-555-0100',
    })
    expect(entries.find((e) => e.label === 'Website')?.href).toBe('https://example.com')
    expect(entries.find((e) => e.label === 'Phone')?.href).toBeUndefined()
  })

  it('returns notes separately from the field list', () => {
    const { entries, notes } = summarizeVenueDetail({ ...EMPTY, public_notes: '  Gate code 1234  ' })
    expect(entries).toEqual([])
    expect(notes).toBe('Gate code 1234')
  })

  it('treats whitespace-only notes as no notes', () => {
    expect(summarizeVenueDetail({ ...EMPTY, public_notes: '   ' }).notes).toBeNull()
  })

  it('orders fields to match the form', () => {
    const { entries } = summarizeVenueDetail({
      ...EMPTY,
      accessibility: true,
      court_count: 2,
      website: 'https://example.com',
    })
    expect(entries.map((e) => e.label)).toEqual(['Courts', 'Website', 'Accessible'])
  })
})

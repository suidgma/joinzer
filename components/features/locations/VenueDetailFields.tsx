'use client'

import { useId } from 'react'
import type { NewLocationDetail } from '@/lib/locations/createLocation'

/**
 * The optional venue detail, grouped, inside the collapsed "Add more detail" disclosure.
 *
 * TWO THINGS HERE ARE NOT STYLE CHOICES.
 *
 * 1. EVERY SELECT'S FIRST OPTION IS BLANK, AND BLANK IS NOT "unknown". A blank submits nothing and
 *    the column is written NULL, meaning "not yet researched". `'unknown'` means "researched and
 *    undetermined" and is deliberately absent from every list here — offering it would let a user
 *    who simply skipped a question assert that somebody looked into it and couldn't tell.
 *
 * 2. THE YES/NO FIELDS ARE SELECTS, NOT CHECKBOXES. An unchecked checkbox submits `false`, which
 *    asserts "this venue has no restrooms" — a claim the user never made. A three-option select is
 *    the only control that can say "I don't know" at all.
 *
 * Server-side validation is the real boundary; the vocabularies below mirror
 * lib/locations/submissionFields.ts and a value that drifts out of sync is dropped there, not
 * persisted.
 */

const TRI_STATE = [
  { value: '', label: '—' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

type Option = { value: string; label: string }

const COURT_CONFIGURATION: Option[] = [
  { value: '', label: '—' },
  { value: 'dedicated', label: 'Dedicated pickleball' },
  { value: 'shared_multi_use', label: 'Shared / multi-use' },
  { value: 'mixed', label: 'A mix of both' },
]

const SURFACE: Option[] = [
  { value: '', label: '—' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'asphalt', label: 'Asphalt' },
  { value: 'acrylic', label: 'Acrylic / cushioned' },
  { value: 'sport_court', label: 'Sport court tiles' },
  { value: 'wood', label: 'Wood (indoor)' },
  { value: 'other', label: 'Something else' },
]

const LINE_TYPE: Option[] = [
  { value: '', label: '—' },
  { value: 'permanent_painted', label: 'Permanent painted lines' },
  { value: 'temporary_provided', label: 'Temporary lines provided' },
  { value: 'byo_required', label: 'Bring your own lines' },
  { value: 'none', label: 'No pickleball lines' },
  { value: 'mixed', label: 'Varies by court' },
]

const NET_SETUP: Option[] = [
  { value: '', label: '—' },
  { value: 'permanent', label: 'Permanent nets' },
  { value: 'portable_provided', label: 'Portable nets provided' },
  { value: 'shared_tennis_net', label: 'Shared tennis nets' },
  { value: 'byo_required', label: 'Bring your own net' },
  { value: 'none', label: 'No nets' },
  { value: 'mixed', label: 'Varies by court' },
]

const ACCESS_TYPE: Option[] = [
  { value: '', label: '—' },
  { value: 'public', label: 'Open to the public' },
  { value: 'private', label: 'Private' },
  { value: 'membership', label: 'Members only' },
  { value: 'school', label: 'School / university' },
  { value: 'hoa', label: 'HOA / community' },
]

const FEE_TYPE: Option[] = [
  { value: '', label: '—' },
  { value: 'free', label: 'Free' },
  { value: 'fee', label: 'Pay to play' },
  { value: 'membership', label: 'Membership required' },
]

const RESERVATION_POLICY: Option[] = [
  { value: '', label: '—' },
  { value: 'none', label: 'No booking needed' },
  { value: 'drop_in', label: 'Drop-in play' },
  { value: 'reservation_recommended', label: 'Booking recommended' },
  { value: 'reservation_required', label: 'Booking required' },
]

const PARKING: Option[] = [
  { value: '', label: '—' },
  { value: 'lot', label: 'Parking lot' },
  { value: 'street', label: 'Street parking' },
  { value: 'none', label: 'No parking' },
]

const lbl = 'block text-[11px] font-medium text-brand-muted mb-0.5'
const groupHeading = 'text-[11px] font-semibold text-brand-dark uppercase tracking-wide'

export default function VenueDetailFields({
  detail,
  onChange,
}: {
  detail: NewLocationDetail
  onChange: (detail: NewLocationDetail) => void
}) {
  const idPrefix = useId()
  const fieldId = (key: string) => `${idPrefix}-${key}`

  const setText =
    (key: keyof NewLocationDetail) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange({ ...detail, [key]: e.target.value })

  /** '' → null so a skipped question stays "not answered" all the way to the column. */
  const setTriState =
    (key: keyof NewLocationDetail) => (e: React.ChangeEvent<HTMLSelectElement>) =>
      onChange({
        ...detail,
        [key]: e.target.value === '' ? null : e.target.value === 'true',
      })

  const triValue = (v: boolean | null) => (v === null ? '' : String(v))

  const Select = ({
    name,
    label,
    options,
    value,
    onSelectChange,
  }: {
    name: string
    label: string
    options: Option[]
    value: string
    onSelectChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  }) => (
    <div>
      <label htmlFor={fieldId(name)} className={lbl}>
        {label}
      </label>
      <select
        id={fieldId(name)}
        name={name}
        value={value}
        onChange={onSelectChange}
        className="input text-sm touch-manipulation"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-4 pt-1">
      <p className="text-[11px] text-brand-muted">
        All optional — leave anything blank if you&apos;re not sure. Blank means &ldquo;not
        answered&rdquo;, so a guess is worse than a gap.
      </p>

      <fieldset className="space-y-2">
        <legend className={groupHeading}>Courts &amp; play</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fieldId('court_count')} className={lbl}>
              Number of courts
            </label>
            <input
              id={fieldId('court_count')}
              name="court_count"
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              autoComplete="off"
              value={detail.court_count}
              onChange={setText('court_count')}
              placeholder="e.g. 6"
              className="input text-sm touch-manipulation"
            />
          </div>
          <Select
            name="court_configuration"
            label="Court setup"
            options={COURT_CONFIGURATION}
            value={detail.court_configuration}
            onSelectChange={setText('court_configuration')}
          />
          <Select
            name="surface"
            label="Surface"
            options={SURFACE}
            value={detail.surface}
            onSelectChange={setText('surface')}
          />
          <Select
            name="indoor"
            label="Indoor"
            options={TRI_STATE}
            value={triValue(detail.indoor)}
            onSelectChange={setTriState('indoor')}
          />
          <Select
            name="lighting"
            label="Lights for night play"
            options={TRI_STATE}
            value={triValue(detail.lighting)}
            onSelectChange={setTriState('lighting')}
          />
          <Select
            name="line_type"
            label="Court lines"
            options={LINE_TYPE}
            value={detail.line_type}
            onSelectChange={setText('line_type')}
          />
          <Select
            name="net_setup"
            label="Nets"
            options={NET_SETUP}
            value={detail.net_setup}
            onSelectChange={setText('net_setup')}
          />
          <div>
            <label htmlFor={fieldId('nets_provided_count')} className={lbl}>
              Nets provided
            </label>
            <input
              id={fieldId('nets_provided_count')}
              name="nets_provided_count"
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
              autoComplete="off"
              value={detail.nets_provided_count}
              onChange={setText('nets_provided_count')}
              placeholder="e.g. 4"
              className="input text-sm touch-manipulation"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={groupHeading}>Access &amp; cost</legend>
        <div className="grid grid-cols-2 gap-2">
          <Select
            name="access_type"
            label="Who can play"
            options={ACCESS_TYPE}
            value={detail.access_type}
            onSelectChange={setText('access_type')}
          />
          <Select
            name="fee_type"
            label="Cost"
            options={FEE_TYPE}
            value={detail.fee_type}
            onSelectChange={setText('fee_type')}
          />
          <Select
            name="reservation_policy"
            label="Booking"
            options={RESERVATION_POLICY}
            value={detail.reservation_policy}
            onSelectChange={setText('reservation_policy')}
          />
          <div>
            <label htmlFor={fieldId('reservation_url')} className={lbl}>
              Booking link
            </label>
            <input
              id={fieldId('reservation_url')}
              name="reservation_url"
              type="url"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={detail.reservation_url}
              onChange={setText('reservation_url')}
              placeholder="https://…"
              className="input text-sm touch-manipulation"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={groupHeading}>Contact</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fieldId('website')} className={lbl}>
              Website
            </label>
            <input
              id={fieldId('website')}
              name="website"
              type="url"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={detail.website}
              onChange={setText('website')}
              placeholder="https://…"
              className="input text-sm touch-manipulation"
            />
          </div>
          <div>
            <label htmlFor={fieldId('phone')} className={lbl}>
              Phone
            </label>
            <input
              id={fieldId('phone')}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={detail.phone}
              onChange={setText('phone')}
              placeholder="(702) 555-0100"
              className="input text-sm touch-manipulation"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={groupHeading}>Amenities</legend>
        <div className="grid grid-cols-2 gap-2">
          <Select
            name="restrooms"
            label="Restrooms"
            options={TRI_STATE}
            value={triValue(detail.restrooms)}
            onSelectChange={setTriState('restrooms')}
          />
          <Select
            name="water_fountain"
            label="Water fountain"
            options={TRI_STATE}
            value={triValue(detail.water_fountain)}
            onSelectChange={setTriState('water_fountain')}
          />
          <Select
            name="parking"
            label="Parking"
            options={PARKING}
            value={detail.parking}
            onSelectChange={setText('parking')}
          />
          <Select
            name="accessibility"
            label="Wheelchair accessible"
            options={TRI_STATE}
            value={triValue(detail.accessibility)}
            onSelectChange={setTriState('accessibility')}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={groupHeading}>Anything else</legend>
        <div>
          <label htmlFor={fieldId('public_notes')} className={lbl}>
            Notes for other players
          </label>
          <textarea
            id={fieldId('public_notes')}
            name="public_notes"
            rows={3}
            maxLength={1000}
            value={detail.public_notes}
            onChange={setText('public_notes')}
            placeholder="e.g. Courts 3–4 are usually free on weekday mornings…"
            className="input text-sm touch-manipulation"
          />
        </div>
      </fieldset>
    </div>
  )
}

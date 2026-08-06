'use client'

import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  filledDetailCount,
  type NewLocationDraft,
  type NewLocationDetail,
} from '@/lib/locations/createLocation'
import AddressAutocomplete, { type ResolvedAddress } from './locations/AddressAutocomplete'
import VenueDetailFields from './locations/VenueDetailFields'

/**
 * Editable inputs shown when the organizer's venue isn't in the directory yet.
 *
 * SHARED BY SIX FORMS — league create/edit, tournament create/edit, event create/edit. A change
 * here reaches all of them, which is why the optional half is collapsed by default: the default
 * experience stays the two interactions it has always been (name, then address), and the extra
 * detail is opt-in for the people who want to give it.
 *
 * The address fields are pre-filled by the autocomplete and remain FULLY EDITABLE. That is load-
 * bearing rather than cosmetic: the row is stored with `address_source='organizer'`, which asserts
 * the person supplied the address. Making these read-only would turn that provenance into a false
 * claim (ADR-12). Do not "tidy" them into a disabled summary of the Places result.
 */
export default function NewLocationFields({
  draft,
  onChange,
}: {
  draft: NewLocationDraft
  onChange: (draft: NewLocationDraft) => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const idPrefix = useId()
  const fieldId = (key: string) => `${idPrefix}-${key}`
  const detailPanelId = `${idPrefix}-detail`

  const set =
    (key: 'name' | 'address' | 'city' | 'state' | 'zip_code' | 'country') =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...draft, [key]: e.target.value })

  const setDetail = (detail: NewLocationDetail) => onChange({ ...draft, detail })

  /** A selection fills the address parts and records the place_id — the one Places field we may
   *  persist. The venue NAME is deliberately left alone: the user already named their venue, and
   *  a Places label ("Sunset Park", "24 Hour Fitness") is frequently not what they'd call it. */
  const applyResolved = (resolved: ResolvedAddress) =>
    onChange({
      ...draft,
      address: resolved.address,
      city: resolved.city,
      state: resolved.state,
      zip_code: resolved.zip_code,
      country: resolved.country || 'US',
      google_place_id: resolved.place_id,
    })

  const filled = filledDetailCount(draft.detail)
  const field = 'input text-sm touch-manipulation'
  const lbl = 'block text-[11px] font-medium text-brand-muted mb-0.5'

  return (
    <div className="mt-2 rounded-xl border border-brand-border bg-brand-soft/40 p-3 space-y-3">
      <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">
        New location details
      </p>

      <div>
        <label htmlFor={fieldId('name')} className={lbl}>
          Location name <span className="text-red-500">*</span>
        </label>
        <input
          id={fieldId('name')}
          name="venue-name"
          type="text"
          required
          autoComplete="off"
          value={draft.name}
          onChange={set('name')}
          placeholder="e.g. Sunrise Community Courts"
          className={field}
        />
      </div>

      <AddressAutocomplete onResolved={applyResolved} />

      <div className="space-y-2">
        <div>
          <label htmlFor={fieldId('address')} className={lbl}>
            Street address
          </label>
          <input
            id={fieldId('address')}
            name="street-address"
            type="text"
            autoComplete="street-address"
            value={draft.address}
            onChange={set('address')}
            placeholder="123 Main St"
            className={field}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fieldId('city')} className={lbl}>
              City
            </label>
            <input
              id={fieldId('city')}
              name="address-level2"
              type="text"
              autoComplete="address-level2"
              value={draft.city}
              onChange={set('city')}
              className={field}
            />
          </div>
          <div>
            <label htmlFor={fieldId('state')} className={lbl}>
              State
            </label>
            <input
              id={fieldId('state')}
              name="address-level1"
              type="text"
              autoComplete="address-level1"
              value={draft.state}
              onChange={set('state')}
              placeholder="NV"
              className={field}
            />
          </div>
          <div>
            <label htmlFor={fieldId('zip_code')} className={lbl}>
              ZIP
            </label>
            <input
              id={fieldId('zip_code')}
              name="postal-code"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              spellCheck={false}
              value={draft.zip_code}
              onChange={set('zip_code')}
              className={field}
            />
          </div>
          <div>
            <label htmlFor={fieldId('country')} className={lbl}>
              Country
            </label>
            <input
              id={fieldId('country')}
              name="country-name"
              type="text"
              autoComplete="country-name"
              spellCheck={false}
              value={draft.country}
              onChange={set('country')}
              className={field}
            />
          </div>
        </div>
      </div>

      {/* A real <button> with aria-expanded rather than a div, so it is keyboard-operable and
          announced as a disclosure without any of it being re-implemented. */}
      <div className="pt-1 border-t border-brand-border">
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          aria-expanded={detailOpen}
          aria-controls={detailPanelId}
          className="w-full flex items-center justify-between gap-2 py-2 text-left touch-manipulation rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="text-xs font-medium text-brand-dark">
            Add more detail{' '}
            <span className="font-normal text-brand-muted">(optional)</span>
          </span>
          <span className="flex items-center gap-2">
            {filled > 0 && (
              <span className="text-[11px] text-brand-muted">
                {filled} added
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={`w-4 h-4 text-brand-muted transition-transform motion-reduce:transition-none ${
                detailOpen ? 'rotate-180' : ''
              }`}
            />
          </span>
        </button>

        <div id={detailPanelId} hidden={!detailOpen}>
          <VenueDetailFields detail={draft.detail} onChange={setDetail} />
        </div>
      </div>
    </div>
  )
}

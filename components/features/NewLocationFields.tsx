'use client'

import type { NewLocationDraft } from '@/lib/locations/createLocation'

// Editable inputs shown when the organizer's venue isn't in the directory yet.
// Mirrors the read-only LocationAddress layout so the two modes look consistent.
export default function NewLocationFields({
  draft,
  onChange,
}: {
  draft: NewLocationDraft
  onChange: (draft: NewLocationDraft) => void
}) {
  const set = (key: keyof NewLocationDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...draft, [key]: e.target.value })

  const field = 'w-full input text-sm'
  const lbl = 'block text-[11px] font-medium text-brand-muted mb-0.5'

  return (
    <div className="mt-2 rounded-xl border border-brand-border bg-brand-soft/40 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">New location details</p>
      <div>
        <label className={lbl}>Location name <span className="text-red-500">*</span></label>
        <input type="text" value={draft.name} onChange={set('name')} placeholder="e.g. Sunrise Community Courts" className={field} />
      </div>
      <div>
        <label className={lbl}>Street address</label>
        <input type="text" value={draft.address} onChange={set('address')} placeholder="123 Main St" className={field} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lbl}>City</label>
          <input type="text" value={draft.city} onChange={set('city')} className={field} />
        </div>
        <div>
          <label className={lbl}>State</label>
          <input type="text" value={draft.state} onChange={set('state')} placeholder="NV" className={field} />
        </div>
        <div>
          <label className={lbl}>ZIP</label>
          <input type="text" value={draft.zip_code} onChange={set('zip_code')} className={field} />
        </div>
        <div>
          <label className={lbl}>Country</label>
          <input type="text" value={draft.country} onChange={set('country')} className={field} />
        </div>
      </div>
    </div>
  )
}

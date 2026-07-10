import type { LocationOption } from '@/lib/types'

// Read-only address block that auto-fills from the selected location. Rendered in
// the create forms' Location area (League / Tournament / Play Session) so the
// organizer can confirm the venue's full postal address. The location record is
// the source of truth, so these fields are display-only.
export default function LocationAddress({ location }: { location?: LocationOption | null }) {
  if (!location) return null

  const cell = 'w-full input bg-brand-soft text-brand-body text-sm select-none'
  const lbl = 'block text-[11px] font-medium text-brand-muted mb-0.5'
  const val = (v?: string | null) => (v && v.trim() ? v : '—')

  return (
    <div className="mt-2 rounded-xl border border-brand-border bg-brand-soft/40 p-3 space-y-2">
      <div>
        <label className={lbl}>Street address</label>
        <div className={cell}>{val(location.address)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lbl}>City</label>
          <div className={cell}>{val(location.city)}</div>
        </div>
        <div>
          <label className={lbl}>State</label>
          <div className={cell}>{val(location.state)}</div>
        </div>
        <div>
          <label className={lbl}>ZIP</label>
          <div className={cell}>{val(location.zip_code)}</div>
        </div>
        <div>
          <label className={lbl}>Country</label>
          <div className={cell}>{val(location.country)}</div>
        </div>
      </div>
    </div>
  )
}

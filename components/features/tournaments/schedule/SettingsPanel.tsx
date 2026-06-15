'use client'
import { useState } from 'react'
import { Settings2, ChevronDown } from 'lucide-react'
import type { ScheduleSettings } from '@/lib/types'

type Props = {
  tournamentId: string
  settings: ScheduleSettings
  onChange: (next: ScheduleSettings) => void
  onError: (msg: string) => void
  onSaved: (msg: string) => void
}

// Small labeled number input row.
function NumField({ label, value, onChange, min = 0, max = 240, suffix }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="text-brand-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className="input w-20 text-right"
        />
        {suffix && <span className="text-brand-muted w-8">{suffix}</span>}
      </span>
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
      <span className="text-brand-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  )
}

export default function SettingsPanel({ tournamentId, settings, onChange, onError, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ScheduleSettings>(settings)
  const [saving, setSaving] = useState(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  function set<K extends keyof ScheduleSettings>(key: K, value: ScheduleSettings[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) { onError(json.error ?? 'Failed to save settings'); return }
      onChange(json.settings as ScheduleSettings)
      setDraft(json.settings as ScheduleSettings)
      onSaved('Scheduling settings saved')
    } catch {
      onError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-brand-dark">
          <Settings2 size={14} className="text-brand-muted" />
          Scheduling Settings
        </span>
        <ChevronDown size={16} className={`text-brand-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-brand-border px-4 py-4 space-y-4">
          <p className="text-[11px] text-brand-muted">
            These drive every capacity estimate and the generated draft schedule.
          </p>

          <div className="space-y-2.5">
            <NumField label="Match duration" value={draft.match_duration_minutes} onChange={v => set('match_duration_minutes', v)} min={1} suffix="min" />
            <NumField label="Buffer between matches" value={draft.buffer_minutes} onChange={v => set('buffer_minutes', v)} suffix="min" />
            <NumField label="Min rest for same team" value={draft.min_rest_minutes} onChange={v => set('min_rest_minutes', v)} suffix="min" />
          </div>

          <div className="border-t border-brand-border pt-3 space-y-2.5">
            <Toggle label="Keep divisions grouped on courts" checked={draft.keep_divisions_grouped} onChange={v => set('keep_divisions_grouped', v)} />
            <Toggle label="Allow courts to be shared across divisions" checked={draft.allow_court_sharing} onChange={v => set('allow_court_sharing', v)} />
            <Toggle label="Allow divisions to overlap (no shared players)" checked={draft.allow_division_overlap} onChange={v => set('allow_division_overlap', v)} />
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="text-brand-muted">Player conflicts are</span>
              <select
                value={draft.conflict_policy}
                onChange={e => set('conflict_policy', e.target.value as ScheduleSettings['conflict_policy'])}
                className="input w-32"
              >
                <option value="warning">Warnings</option>
                <option value="error">Hard errors</option>
              </select>
            </label>
          </div>

          <div className="border-t border-brand-border pt-3 space-y-2.5">
            <Toggle label="Leave buffer at end of each block" checked={draft.leave_end_buffer} onChange={v => set('leave_end_buffer', v)} />
            {draft.leave_end_buffer && (
              <NumField label="End buffer" value={draft.end_buffer_minutes} onChange={v => set('end_buffer_minutes', v)} suffix="min" />
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
            </button>
            {dirty && (
              <button
                onClick={() => setDraft(settings)}
                className="px-4 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

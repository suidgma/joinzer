'use client'
import { useState } from 'react'
import { CalendarRange, Plus } from 'lucide-react'
import type { ScheduleBlock, ScheduleSettings } from '@/lib/types'
import type { BuilderDay, BuilderLocation, BuilderDivision } from './types'
import SettingsPanel from './SettingsPanel'
import BlockCard from './BlockCard'
import BlockFormModal from './BlockFormModal'

type Props = {
  tournamentId: string
  primaryLocationId: string | null
  days: BuilderDay[]
  locations: BuilderLocation[]
  divisions: BuilderDivision[]
  initialBlocks: ScheduleBlock[]
  initialSettings: ScheduleSettings
}

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; block: ScheduleBlock }
  | null

export default function ScheduleBuilderView({
  tournamentId, primaryLocationId, days, locations, divisions, initialBlocks, initialSettings,
}: Props) {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialBlocks)
  const [settings, setSettings] = useState<ScheduleSettings>(initialSettings)
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<string | null>(null)

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  const locationName = (id: string | null) => locations.find(l => l.id === id)?.name ?? null

  function upsertBlock(b: ScheduleBlock) {
    setBlocks(prev => {
      const idx = prev.findIndex(x => x.id === b.id)
      const next = idx === -1 ? [...prev, b] : prev.map(x => (x.id === b.id ? b : x))
      return next.sort((a, c) =>
        a.block_date === c.block_date ? a.start_time.localeCompare(c.start_time) : a.block_date.localeCompare(c.block_date)
      )
    })
  }

  async function duplicate(block: ScheduleBlock) {
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${block.name} (copy)`,
          block_date: block.block_date,
          start_time: block.start_time,
          end_time: block.end_time,
          location_id: block.location_id,
          court_numbers: block.court_numbers,
          notes: block.notes,
          priority: block.priority,
          max_divisions: block.max_divisions,
        }),
      })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to duplicate'); return }
      upsertBlock(json.block as ScheduleBlock)
      flash('Block duplicated')
    } catch {
      flash('Network error')
    }
  }

  async function remove(block: ScheduleBlock) {
    if (!window.confirm(`Delete "${block.name}"? Any division assignments to this block will be removed.`)) return
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-blocks/${block.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to delete'); return }
      setBlocks(prev => prev.filter(b => b.id !== block.id))
      flash('Block deleted')
    } catch {
      flash('Network error')
    }
  }

  // Group blocks by date for display.
  const byDate = new Map<string, ScheduleBlock[]>()
  for (const b of blocks) {
    if (!byDate.has(b.block_date)) byDate.set(b.block_date, [])
    byDate.get(b.block_date)!.push(b)
  }
  const dateGroups = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-lg font-bold text-brand-dark flex items-center gap-2">
          <CalendarRange size={18} className="text-brand-muted" />
          Schedule Builder
        </h1>
        <p className="text-xs text-brand-muted mt-1 max-w-lg">
          Define date/time/court blocks, then assign divisions to them and generate a draft
          schedule. Capacity estimates use your scheduling settings.
        </p>
      </div>

      <SettingsPanel
        tournamentId={tournamentId}
        settings={settings}
        onChange={setSettings}
        onError={flash}
        onSaved={flash}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
            Schedule Blocks {blocks.length > 0 && `(${blocks.length})`}
          </h2>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-brand text-brand-dark hover:bg-brand-hover transition-colors"
          >
            <Plus size={14} /> Add block
          </button>
        </div>

        {blocks.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-brand-border text-center py-10 px-4">
            <p className="text-2xl mb-2">🗓️</p>
            <p className="text-sm font-semibold text-brand-dark">No blocks yet</p>
            <p className="text-xs text-brand-muted mt-1 max-w-xs mx-auto">
              Create blocks like “Saturday Morning” or “Sunday Championship” to carve up your
              courts and dates.
            </p>
          </div>
        ) : (
          dateGroups.map(([date, group]) => (
            <div key={date} className="space-y-2">
              <div className="grid sm:grid-cols-2 gap-3">
                {group.map(b => (
                  <BlockCard
                    key={b.id}
                    block={b}
                    locationName={locationName(b.location_id)}
                    settings={settings}
                    onEdit={() => setModal({ mode: 'edit', block: b })}
                    onDuplicate={() => duplicate(b)}
                    onDelete={() => remove(b)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
          Divisions to schedule ({divisions.length})
        </h2>
        {divisions.length === 0 ? (
          <p className="text-xs text-brand-muted">No divisions created yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {divisions.map(d => (
              <span key={d.id} className="px-3 py-1.5 rounded-full bg-white border border-brand-border text-xs text-brand-dark">
                {d.name}
                <span className="text-brand-muted"> · {d.bracket_type.replace(/_/g, ' ')}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-brand-muted">Assigning divisions to blocks comes next.</p>
      </section>

      {modal && (
        <BlockFormModal
          tournamentId={tournamentId}
          mode={modal.mode}
          block={modal.mode === 'edit' ? modal.block : undefined}
          days={days}
          locations={locations}
          primaryLocationId={primaryLocationId}
          settings={settings}
          onClose={() => setModal(null)}
          onSaved={(b) => { upsertBlock(b); flash(modal.mode === 'create' ? 'Block created' : 'Block updated') }}
          onError={flash}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-brand-dark text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

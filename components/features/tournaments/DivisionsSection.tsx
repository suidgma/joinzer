'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import FormatSettingsFields, {
  FORMAT_DEFAULTS, FormatType, FormatSettings,
  validateFormatSettings, formatSummaryLines,
} from './FormatSettingsFields'

const CATEGORY_LABELS: Record<string, string> = {
  mens_doubles:   "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles:  "Mixed Doubles",
  singles:        "Singles",
  open:           "Open",
}

const SKILL_OPTIONS = ['Beginner', 'Beginner Plus', 'Intermediate', 'Intermediate Plus', 'Advanced', 'Open']

type Registration = {
  id: string
  user_id: string
  partner_user_id: string | null
  team_name: string | null
  status: string
  user_profile: { name: string } | null
}

type Division = {
  id: string
  name: string
  category: string
  skill_level: string | null
  team_type: string
  max_entries: number
  waitlist_enabled: boolean
  status: string
  format_type: FormatType
  format_settings_json: FormatSettings
  tournament_registrations: Registration[]
}

type Props = {
  tournamentId: string
  initialDivisions: Division[]
  isOrganizer: boolean
  currentUserId: string | null
}

export default function DivisionsSection({ tournamentId, initialDivisions, isOrganizer, currentUserId }: Props) {
  const router = useRouter()
  const [divisions, setDivisions] = useState<Division[]>(initialDivisions)
  const [loading, setLoading] = useState(initialDivisions.length === 0)

  useEffect(() => {
    fetch(`/api/tournaments/${tournamentId}/divisions`)
      .then(r => r.json())
      .then(({ divisions: fetched }) => {
        if (fetched) setDivisions(fetched)
      })
      .finally(() => setLoading(false))
  }, [tournamentId])
  const [showAddForm, setShowAddForm] = useState(false)
  const [managingId, setManagingId] = useState<string | null>(null)
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null)
  const [registeringDiv, setRegisteringDiv] = useState<Division | null>(null)

  // Add-division form state
  const [fName, setFName] = useState('')
  const [fCategory, setFCategory] = useState('mixed_doubles')
  const [fSkill, setFSkill] = useState('')
  const [fTeamType, setFTeamType] = useState('doubles')
  const [fMax, setFMax] = useState(16)
  const [fWaitlist, setFWaitlist] = useState(false)
  const [fFormatType, setFFormatType] = useState<FormatType>('round_robin')
  const [fFormatSettings, setFFormatSettings] = useState<FormatSettings>(FORMAT_DEFAULTS.round_robin)
  const [fLoading, setFLoading] = useState(false)
  const [fError, setFError] = useState<string | null>(null)

  // Inline format edit state (per division)
  const [editFormatType, setEditFormatType] = useState<FormatType>('round_robin')
  const [editFormatSettings, setEditFormatSettings] = useState<FormatSettings>(FORMAT_DEFAULTS.round_robin)
  const [editFormatLoading, setEditFormatLoading] = useState(false)
  const [editFormatError, setEditFormatError] = useState<string | null>(null)

  // Registration modal state
  const [teamName, setTeamName] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)

  // ── Add division ──────────────────────────────────────────────────
  async function handleAddDivision(e: React.FormEvent) {
    e.preventDefault()
    const validErr = validateFormatSettings(fFormatType, fFormatSettings)
    if (validErr) { setFError(validErr); return }

    setFLoading(true)
    setFError(null)

    const autoName = fName.trim() ||
      [CATEGORY_LABELS[fCategory], fSkill].filter(Boolean).join(' — ')

    const supabase = createClient()
    const { data, error } = await supabase
      .from('tournament_divisions')
      .insert({
        tournament_id: tournamentId,
        name: autoName,
        category: fCategory,
        skill_level: fSkill || null,
        team_type: fTeamType,
        max_entries: fMax,
        waitlist_enabled: fWaitlist,
        status: 'active',
        format_type: fFormatType,
        format_settings_json: fFormatSettings,
      })
      .select('id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, format_type, format_settings_json')
      .single()

    if (error || !data) { setFError(error?.message ?? 'Failed'); setFLoading(false); return }

    setDivisions(prev => [...prev, { ...data, tournament_registrations: [] }])
    router.refresh()
    setShowAddForm(false)
    setFName(''); setFCategory('mixed_doubles'); setFSkill('')
    setFTeamType('doubles'); setFMax(16); setFWaitlist(false)
    setFFormatType('round_robin'); setFFormatSettings(FORMAT_DEFAULTS.round_robin)
    setFLoading(false)
  }

  // ── Open format editor for a division ────────────────────────────
  function openFormatEdit(div: Division) {
    setEditFormatType(div.format_type)
    setEditFormatSettings(div.format_settings_json ?? FORMAT_DEFAULTS[div.format_type])
    setEditFormatError(null)
    setEditingFormatId(div.id)
  }

  // ── Save format edits ─────────────────────────────────────────────
  async function handleSaveFormat(divisionId: string) {
    const validErr = validateFormatSettings(editFormatType, editFormatSettings)
    if (validErr) { setEditFormatError(validErr); return }

    setEditFormatLoading(true)
    setEditFormatError(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_divisions')
      .update({ format_type: editFormatType, format_settings_json: editFormatSettings })
      .eq('id', divisionId)

    if (error) { setEditFormatError(error.message); setEditFormatLoading(false); return }

    setDivisions(prev => prev.map(d =>
      d.id === divisionId
        ? { ...d, format_type: editFormatType, format_settings_json: editFormatSettings }
        : d
    ))
    setEditingFormatId(null)
    setEditFormatLoading(false)
  }

  // ── Register ─────────────────────────────────────────────────────
  async function handleRegister(div: Division) {
    if (!currentUserId) return
    setRegLoading(true)
    setRegError(null)

    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${div.id}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_name: teamName.trim() || null }) }
    )
    const json = await res.json()

    if (!res.ok) { setRegError(json.error ?? 'Registration failed'); setRegLoading(false); return }

    const reg: Registration = { ...json.registration, user_profile: null }
    setDivisions(prev => prev.map(d =>
      d.id === div.id
        ? { ...d, tournament_registrations: [...d.tournament_registrations, reg] }
        : d
    ))
    router.refresh()
    setRegisteringDiv(null)
    setTeamName('')
    setRegLoading(false)
  }

  // ── Cancel own registration ───────────────────────────────────────
  async function handleCancel(divisionId: string, regId: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_registrations')
      .update({ status: 'cancelled' })
      .eq('id', regId)
    if (error) return
    updateReg(divisionId, regId, 'cancelled')
  }

  // ── Organizer: remove registrant ──────────────────────────────────
  async function handleRemove(divisionId: string, regId: string) {
    await handleCancel(divisionId, regId)
  }

  // ── Organizer: promote waitlisted → registered ────────────────────
  async function handlePromote(divisionId: string, regId: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_registrations')
      .update({ status: 'registered' })
      .eq('id', regId)
    if (error) return
    updateReg(divisionId, regId, 'registered')
  }

  // ── Organizer: close division ─────────────────────────────────────
  async function handleClose(divisionId: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_divisions')
      .update({ status: 'closed' })
      .eq('id', divisionId)
    if (error) return
    setDivisions(prev => prev.map(d => d.id === divisionId ? { ...d, status: 'closed' } : d))
  }

  function updateReg(divisionId: string, regId: string, status: string) {
    setDivisions(prev => prev.map(d =>
      d.id !== divisionId ? d : {
        ...d,
        tournament_registrations: d.tournament_registrations.map(r =>
          r.id === regId ? { ...r, status } : r
        ),
      }
    ))
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Divisions</h2>
        {isOrganizer && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm font-medium text-brand-active hover:underline"
          >
            + Add Division
          </button>
        )}
      </div>

      {/* ── Add Division Form ── */}
      {isOrganizer && showAddForm && (
        <form onSubmit={handleAddDivision} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
          <h3 className="font-heading text-sm font-bold text-brand-dark">New Division</h3>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Division Name</label>
            <input
              type="text"
              value={fName}
              onChange={e => setFName(e.target.value)}
              placeholder="Auto-generated if blank"
              className="w-full input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Category</label>
              <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="w-full input">
                <option value="mixed_doubles">Mixed Doubles</option>
                <option value="mens_doubles">Men&apos;s Doubles</option>
                <option value="womens_doubles">Women&apos;s Doubles</option>
                <option value="singles">Singles</option>
                <option value="open">Open</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Team Type</label>
              <select value={fTeamType} onChange={e => setFTeamType(e.target.value)} className="w-full input">
                <option value="doubles">Doubles</option>
                <option value="singles">Singles</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Skill Level</label>
              <select value={fSkill} onChange={e => setFSkill(e.target.value)} className="w-full input">
                <option value="">Any</option>
                {SKILL_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Max Entries</label>
              <input
                type="number"
                value={fMax}
                onChange={e => setFMax(Math.max(2, Number(e.target.value)))}
                min={2}
                max={256}
                className="w-full input"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={fWaitlist}
              onChange={e => setFWaitlist(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            <span className="text-sm text-brand-dark">Enable waitlist when full</span>
          </label>

          <div className="border-t border-brand-border pt-3">
            <FormatSettingsFields
              formatType={fFormatType}
              formatSettings={fFormatSettings}
              onTypeChange={t => { setFFormatType(t); setFFormatSettings(FORMAT_DEFAULTS[t]) }}
              onSettingsChange={setFFormatSettings}
            />
          </div>

          {fError && <p className="text-sm text-red-600">{fError}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={fLoading}
              className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {fLoading ? 'Creating…' : 'Create Division'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setFError(null) }}
              className="px-4 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── Division list ── */}
      {loading ? (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center">
          <p className="text-sm text-brand-muted">Loading divisions…</p>
        </div>
      ) : divisions.length === 0 ? (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-sm text-brand-muted">No divisions yet.</p>
          {isOrganizer && (
            <button onClick={() => setShowAddForm(true)} className="text-sm font-medium text-brand-active hover:underline">
              Add the first division
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {divisions.map(div => {
            const active    = div.tournament_registrations.filter(r => r.status === 'registered')
            const waitlist  = div.tournament_registrations.filter(r => r.status === 'waitlisted')
            const myReg     = currentUserId
              ? div.tournament_registrations.find(r => r.user_id === currentUserId && r.status !== 'cancelled')
              : undefined
            const isFull    = active.length >= div.max_entries
            const isClosed  = div.status === 'closed'
            const canReg    = !myReg && !isClosed && (!isFull || div.waitlist_enabled)
            const isManaging = managingId === div.id
            const isEditingFormat = editingFormatId === div.id
            const hasRegistrants = div.tournament_registrations.filter(r => r.status !== 'cancelled').length > 0

            const fType = div.format_type ?? 'round_robin'
            const fSettings = div.format_settings_json ?? FORMAT_DEFAULTS[fType]
            const summaryLines = formatSummaryLines(fType, fSettings)

            return (
              <div key={div.id} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">

                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-heading text-sm font-bold text-brand-dark">{div.name}</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      {CATEGORY_LABELS[div.category] ?? div.category}
                      {' · '}
                      {div.team_type === 'doubles' ? 'Doubles' : 'Singles'}
                      {div.skill_level && ` · ${div.skill_level}`}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                    isClosed                             ? 'bg-gray-100 text-gray-500'       :
                    isFull && !div.waitlist_enabled      ? 'bg-red-100 text-red-700'         :
                                                          'bg-brand-soft text-brand-active'
                  }`}>
                    {isClosed ? 'Closed' : isFull && !div.waitlist_enabled ? 'Full' : 'Open'}
                  </span>
                </div>

                {/* Format summary */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    {summaryLines.map((line, i) => (
                      <p key={i} className={`text-xs ${i === 0 ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>
                        {line}
                      </p>
                    ))}
                  </div>
                  {isOrganizer && !isEditingFormat && (
                    <button
                      onClick={() => openFormatEdit(div)}
                      className="shrink-0 text-xs text-brand-active hover:underline"
                    >
                      Edit Format
                    </button>
                  )}
                </div>

                {/* Inline format editor */}
                {isOrganizer && isEditingFormat && (
                  <div className="border border-brand-border rounded-xl p-3 space-y-3 bg-white">
                    {hasRegistrants && (
                      <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                        This division has registrants. Changing the format may affect match generation.
                      </p>
                    )}
                    <FormatSettingsFields
                      formatType={editFormatType}
                      formatSettings={editFormatSettings}
                      onTypeChange={t => { setEditFormatType(t); setEditFormatSettings(FORMAT_DEFAULTS[t]) }}
                      onSettingsChange={setEditFormatSettings}
                    />
                    {editFormatError && <p className="text-xs text-red-600">{editFormatError}</p>}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleSaveFormat(div.id)}
                        disabled={editFormatLoading}
                        className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
                      >
                        {editFormatLoading ? 'Saving…' : 'Save Format'}
                      </button>
                      <button
                        onClick={() => { setEditingFormatId(null); setEditFormatError(null) }}
                        className="px-4 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Counts */}
                <div className="flex items-center gap-3 text-xs text-brand-muted">
                  <span>
                    <span className="font-semibold text-brand-dark">{active.length}</span>
                    {' / '}{div.max_entries}{' '}
                    {div.team_type === 'doubles' ? 'teams' : 'players'}
                  </span>
                  {waitlist.length > 0 && <span>· {waitlist.length} waitlisted</span>}
                </div>

                {/* My status */}
                {myReg && (
                  <div className={`text-xs px-2.5 py-1.5 rounded-lg font-medium ${
                    myReg.status === 'registered' ? 'bg-brand-soft text-brand-active' : 'bg-yellow-50 text-yellow-700'
                  }`}>
                    {myReg.status === 'registered' ? '✓ Registered' : '⏳ On waitlist'}
                    {myReg.team_name && ` · ${myReg.team_name}`}
                  </div>
                )}

                {/* Action buttons */}
                {currentUserId && (
                  <div className="flex gap-2">
                    {canReg && (
                      <button
                        onClick={() => { setRegisteringDiv(div); setTeamName(''); setRegError(null) }}
                        className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
                      >
                        {isFull && div.waitlist_enabled ? 'Join Waitlist' : 'Register'}
                      </button>
                    )}
                    {myReg && (
                      <button
                        onClick={() => handleCancel(div.id, myReg.id)}
                        className="flex-1 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
                      >
                        Cancel Registration
                      </button>
                    )}
                    {isOrganizer && (
                      <button
                        onClick={() => setManagingId(isManaging ? null : div.id)}
                        className="px-3 py-2 rounded-xl border border-brand-border text-xs text-brand-muted hover:bg-brand-soft transition-colors"
                      >
                        {isManaging ? 'Done' : 'Manage'}
                      </button>
                    )}
                  </div>
                )}

                {/* Organizer management panel */}
                {isManaging && (
                  <div className="border-t border-brand-border pt-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Registrants</p>
                      {!isClosed && (
                        <button onClick={() => handleClose(div.id)} className="text-xs text-red-500 hover:underline">
                          Close Division
                        </button>
                      )}
                    </div>

                    {div.tournament_registrations.filter(r => r.status !== 'cancelled').length === 0 ? (
                      <p className="text-xs text-brand-muted">No registrants yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {div.tournament_registrations
                          .filter(r => r.status !== 'cancelled')
                          .map(reg => (
                            <li key={reg.id} className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-medium text-brand-dark truncate">
                                  {reg.user_profile?.name ?? reg.user_id.slice(0, 8)}
                                </span>
                                {reg.team_name && (
                                  <span className="text-brand-muted truncate">· {reg.team_name}</span>
                                )}
                                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  reg.status === 'registered' ? 'bg-brand-soft text-brand-active' : 'bg-yellow-50 text-yellow-700'
                                }`}>
                                  {reg.status === 'registered' ? 'Registered' : 'Waitlisted'}
                                </span>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                {reg.status === 'waitlisted' && !isFull && (
                                  <button onClick={() => handlePromote(div.id, reg.id)} className="text-brand-active hover:underline">
                                    Promote
                                  </button>
                                )}
                                <button onClick={() => handleRemove(div.id, reg.id)} className="text-red-500 hover:underline">
                                  Remove
                                </button>
                              </div>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Registration modal ── */}
      {registeringDiv && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={e => { if (e.target === e.currentTarget) { setRegisteringDiv(null); setRegError(null) } }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            <h2 className="font-heading text-base font-bold text-brand-dark">
              Register: {registeringDiv.name}
            </h2>

            <p className="text-sm text-brand-muted">
              {CATEGORY_LABELS[registeringDiv.category]}
              {' · '}
              {registeringDiv.team_type === 'doubles' ? 'Doubles' : 'Singles'}
              {registeringDiv.skill_level && ` · ${registeringDiv.skill_level}`}
            </p>

            {registeringDiv.team_type === 'doubles' && (
              <div>
                <label className="block text-sm font-medium mb-1">Team Name <span className="text-brand-muted font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  placeholder="e.g. Power Smashers"
                  className="w-full input"
                />
                <p className="text-xs text-brand-muted mt-1.5">
                  Partner can be coordinated with the organizer after registration.
                </p>
              </div>
            )}

            {regError && <p className="text-sm text-red-600">{regError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => handleRegister(registeringDiv)}
                disabled={regLoading}
                className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
              >
                {regLoading ? 'Registering…' : (() => {
                  const active = registeringDiv.tournament_registrations.filter(r => r.status === 'registered').length
                  return active >= registeringDiv.max_entries && registeringDiv.waitlist_enabled
                    ? 'Join Waitlist' : 'Confirm Registration'
                })()}
              </button>
              <button
                onClick={() => { setRegisteringDiv(null); setRegError(null) }}
                className="px-4 py-2.5 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

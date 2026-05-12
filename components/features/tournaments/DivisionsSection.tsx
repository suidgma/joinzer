'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import FormatSettingsFields, {
  FORMAT_DEFAULTS, FormatType, FormatSettings,
  validateFormatSettings, formatSummaryLines,
} from './FormatSettingsFields'
import QrCheckinModal from './QrCheckinModal'
import PrepTournamentModal from './PrepTournamentModal'

const CATEGORY_LABELS: Record<string, string> = {
  mens_doubles:   'Men',
  womens_doubles: 'Women',
  mixed_doubles:  'Mixed',
  singles:        'Singles',
  open:           'Open',
}

const SKILL_OPTIONS = ['Beginner', 'Beginner Plus', 'Intermediate', 'Intermediate Plus', 'Advanced', 'Open']

type Registration = {
  id: string
  user_id: string
  partner_user_id: string | null
  partner_registration_id: string | null
  team_name: string | null
  status: string
  registration_type: 'team' | 'solo'
  payment_status?: string
  stripe_payment_intent_id?: string | null
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
  cost_cents: number | null
  tournament_registrations: Registration[]
}

type Props = {
  tournamentId: string
  initialDivisions: Division[]
  isOrganizer: boolean
  currentUserId: string | null
  tournamentCostCents: number
}

export default function DivisionsSection({ tournamentId, initialDivisions, isOrganizer, currentUserId, tournamentCostCents }: Props) {
  const router = useRouter()
  const [divisions, setDivisions] = useState<Division[]>(initialDivisions)
  const [paymentBanner, setPaymentBanner] = useState<'success' | 'cancelled' | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const payment = params.get('payment')
    if (payment === 'success') {
      setPaymentBanner('success')
      // Optimistically mark current user's registrations as paid so button disappears immediately
      setDivisions(prev => prev.map(d => ({
        ...d,
        tournament_registrations: d.tournament_registrations.map(r =>
          r.user_id === currentUserId ? { ...r, payment_status: 'paid' } : r
        ),
      })))
      router.refresh()
      window.history.replaceState({}, '', window.location.pathname)
    } else if (payment === 'cancelled') {
      setPaymentBanner('cancelled')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [router, currentUserId])
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
  const [fCostDollars, setFCostDollars] = useState('')
  const [fMinAge, setFMinAge] = useState('')
  const [fMaxAge, setFMaxAge] = useState('')
  const [fStartTime, setFStartTime] = useState('')
  const [fLoading, setFLoading] = useState(false)
  const [fError, setFError] = useState<string | null>(null)

  // Inline format edit state (per division)
  const [editFormatType, setEditFormatType] = useState<FormatType>('round_robin')
  const [editFormatSettings, setEditFormatSettings] = useState<FormatSettings>(FORMAT_DEFAULTS.round_robin)
  const [editFormatLoading, setEditFormatLoading] = useState(false)
  const [editFormatError, setEditFormatError] = useState<string | null>(null)

  // Registration modal state
  const [teamName, setTeamName] = useState('')
  const [regType, setRegType] = useState<'team' | 'solo'>('team')
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)
  // Partner invite step (shown after registration succeeds for doubles)
  const [justRegistered, setJustRegistered] = useState<{ regId: string; divisionId: string } | null>(null)
  const [partnerEmail, setPartnerEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState(false)

  // Add player state (organizer)
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null) // division id
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerResults, setPlayerResults] = useState<{ id: string; name: string }[]>([])
  const [addPlayerLoading, setAddPlayerLoading] = useState(false)
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null)

  // QR check-in modal
  const [qrDivision, setQrDivision] = useState<{ id: string; name: string } | null>(null)

  // Prep tournament modal
  const [showPrep, setShowPrep] = useState(false)
  const [regClosed, setRegClosed] = useState(false)

  // Merge state
  const [mergingFromId, setMergingFromId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string>('')
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)

  // Discount code state (per division)
  const [discountInputs, setDiscountInputs] = useState<Record<string, string>>({})

  // Move player state (per reg)
  const [movingRegId, setMovingRegId] = useState<string | null>(null)
  const [moveTargetId, setMoveTargetId] = useState<string>('')
  const [moveLoading, setMoveLoading] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

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
        cost_cents: fCostDollars ? Math.round(parseFloat(fCostDollars) * 100) : null,
        min_age: fMinAge ? parseInt(fMinAge) : null,
        max_age: fMaxAge ? parseInt(fMaxAge) : null,
        start_time: fStartTime || null,
      })
      .select('id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, format_type, format_settings_json, cost_cents')
      .single()

    if (error || !data) { setFError(error?.message ?? 'Failed'); setFLoading(false); return }

    setDivisions(prev => [...prev, { ...data, tournament_registrations: [] }])
    setShowAddForm(false)
    setFName(''); setFCategory('mixed_doubles'); setFSkill('')
    setFTeamType('doubles'); setFMax(16); setFWaitlist(false)
    setFFormatType('round_robin'); setFFormatSettings(FORMAT_DEFAULTS.round_robin)
    setFCostDollars(''); setFMinAge(''); setFMaxAge(''); setFStartTime('')
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
        body: JSON.stringify({ team_name: regType === 'team' ? (teamName.trim() || null) : null, registration_type: regType }) }
    )
    const json = await res.json()

    if (!res.ok) { setRegError(json.error ?? 'Registration failed'); setRegLoading(false); return }

    const reg: Registration = { ...json.registration, registration_type: regType, partner_registration_id: null, user_profile: null }
    setDivisions(prev => prev.map(d =>
      d.id === div.id
        ? { ...d, tournament_registrations: [...d.tournament_registrations, reg] }
        : d
    ))
    router.refresh()

    // For team doubles, show partner invite step; solos are auto-matched
    if (div.team_type === 'doubles' && regType === 'team') {
      setJustRegistered({ regId: json.registration.id, divisionId: div.id })
      setPartnerEmail('')
      setInviteError(null)
      setInviteSent(false)
    } else {
      setRegisteringDiv(null)
    }
    setTeamName('')
    setRegLoading(false)
  }

  // ── Send partner invite ───────────────────────────────────────────
  async function handleSendInvite() {
    if (!justRegistered || !partnerEmail.trim()) return
    setInviteLoading(true)
    setInviteError(null)

    // Prevent self-invite — check against current user's profile email
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email && user.email.toLowerCase() === partnerEmail.trim().toLowerCase()) {
      setInviteError("You can't invite yourself as a partner.")
      setInviteLoading(false)
      return
    }
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${justRegistered.divisionId}/invite-partner`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: justRegistered.regId, partner_email: partnerEmail.trim() }),
      }
    )
    const json = await res.json()
    if (!res.ok) { setInviteError(json.error ?? 'Failed to send invite'); setInviteLoading(false); return }
    setInviteSent(true)
    setInviteLoading(false)
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
    router.refresh()
  }

  // ── Organizer: remove registrant ──────────────────────────────────
  async function handleRemove(divisionId: string, regId: string) {
    await handleCancel(divisionId, regId)
  }

  // ── Organizer: mark payment as paid ───────────────────────────────
  async function handleMarkPaid(divisionId: string, regId: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_registrations')
      .update({ payment_status: 'paid' })
      .eq('id', regId)
    if (error) return
    setDivisions(prev => prev.map(d =>
      d.id !== divisionId ? d : {
        ...d,
        tournament_registrations: d.tournament_registrations.map(r =>
          r.id === regId ? { ...r, payment_status: 'paid' } : r
        ),
      }
    ))
  }

  // ── Organizer: refund a paid registration ────────────────────────
  async function handleRefund(divisionId: string, regId: string) {
    if (!confirm('Issue a full refund to this player via Stripe?')) return
    const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${regId}/refund`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(body.error ?? 'Refund failed')
      return
    }
    setDivisions(prev => prev.map(d =>
      d.id !== divisionId ? d : {
        ...d,
        tournament_registrations: d.tournament_registrations.map(r =>
          r.id === regId ? { ...r, payment_status: 'refunded' } : r
        ),
      }
    ))
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

  // ── Organizer: search players ─────────────────────────────────────
  async function searchPlayers(query: string, excludeUserIds: string[] = [], category?: string) {
    setPlayerSearch(query)
    const supabase = createClient()
    let q = supabase.from('profiles').select('id, name, gender').order('name').limit(500)
    if (query.trim().length >= 1) q = (q as any).ilike('name', `%${query}%`)
    const excludeIds = Array.from(new Set((currentUserId ? [currentUserId] : []).concat(excludeUserIds)))
    if (excludeIds.length > 0) q = q.not('id', 'in', `(${excludeIds.join(',')})`)
    // Filter by gender based on stored category value
    if (category === 'mens_doubles') q = (q as any).eq('gender', 'male')
    else if (category === 'womens_doubles') q = (q as any).eq('gender', 'female')
    const { data } = await q
    setPlayerResults(data ?? [])
  }

  // ── Organizer: add player to division ─────────────────────────────
  async function handleAddPlayer(divisionId: string, userId: string, userName: string) {
    setAddPlayerLoading(true)
    setAddPlayerError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${divisionId}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }) }
    )
    const json = await res.json()
    if (!res.ok) { setAddPlayerError(json.error ?? 'Failed to add player'); setAddPlayerLoading(false); return }

    const reg = { ...json.registration, user_profile: { name: userName } }
    setDivisions(prev => prev.map(d =>
      d.id === divisionId
        ? { ...d, tournament_registrations: [...d.tournament_registrations, reg] }
        : d
    ))
    setAddingPlayerId(null)
    setPlayerSearch('')
    setPlayerResults([])
    setAddPlayerLoading(false)
    router.refresh()
  }

  // ── Merge division into another ────────────────────────────────────
  async function handleMerge(fromDivisionId: string) {
    if (!mergeTargetId || mergeTargetId === fromDivisionId) return
    if (!confirm('Move all registrations from this division into the selected one and close this division?')) return
    setMergeLoading(true)
    setMergeError(null)
    const supabase = createClient()
    // Move all active regs from source to target
    const sourceRegs = divisions
      .find(d => d.id === fromDivisionId)
      ?.tournament_registrations.filter(r => r.status !== 'cancelled')
      .map(r => r.id) ?? []
    if (sourceRegs.length > 0) {
      const { error: moveErr } = await supabase
        .from('tournament_registrations')
        .update({ division_id: mergeTargetId })
        .in('id', sourceRegs)
      if (moveErr) { setMergeError(moveErr.message); setMergeLoading(false); return }
    }
    // Close source division
    const { error: closeErr } = await supabase
      .from('tournament_divisions')
      .update({ status: 'closed' })
      .eq('id', fromDivisionId)
    if (closeErr) { setMergeError(closeErr.message); setMergeLoading(false); return }

    // Update local state: move regs + close source
    setDivisions(prev => {
      const movedRegs = prev.find(d => d.id === fromDivisionId)?.tournament_registrations.filter(r => r.status !== 'cancelled') ?? []
      return prev.map(d => {
        if (d.id === fromDivisionId) return { ...d, status: 'closed', tournament_registrations: [] }
        if (d.id === mergeTargetId) return { ...d, tournament_registrations: [...d.tournament_registrations, ...movedRegs] }
        return d
      })
    })
    setMergingFromId(null)
    setMergeTargetId('')
    setMergeLoading(false)
    router.refresh()
  }

  // ── Move single player to another division ─────────────────────────
  async function handleMovePlayer(fromDivisionId: string, regId: string) {
    if (!moveTargetId || moveTargetId === fromDivisionId) return
    setMoveLoading(true)
    setMoveError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_registrations')
      .update({ division_id: moveTargetId })
      .eq('id', regId)
    if (error) { setMoveError(error.message); setMoveLoading(false); return }

    setDivisions(prev => {
      const movedReg = prev.find(d => d.id === fromDivisionId)?.tournament_registrations.find(r => r.id === regId)
      return prev.map(d => {
        if (d.id === fromDivisionId) return { ...d, tournament_registrations: d.tournament_registrations.filter(r => r.id !== regId) }
        if (d.id === moveTargetId && movedReg) return { ...d, tournament_registrations: [...d.tournament_registrations, { ...movedReg, division_id: moveTargetId }] }
        return d
      })
    })
    setMovingRegId(null)
    setMoveTargetId('')
    setMoveLoading(false)
  }

  // ── Pay for registration via Stripe Checkout ─────────────────────
  async function handlePay(regId: string, divisionId: string, payForPartner = false) {
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_id: regId,
          pay_for_partner: payForPartner,
          discount_code: discountInputs[divisionId]?.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { alert(`Payment error: ${json.error ?? 'Unknown error'}`); return }
      if (json.free) { router.refresh(); return }
      if (json.url) { window.location.href = json.url; return }
      alert('No checkout URL returned — check console')
    } catch (err) {
      alert(`Failed to start checkout: ${err}`)
    }
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
      {paymentBanner === 'success' && (
        <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-sm text-green-700 font-medium">✓ Payment received — you&apos;re all set!</p>
          <button onClick={() => setPaymentBanner(null)} className="text-green-500 text-lg leading-none">×</button>
        </div>
      )}
      {paymentBanner === 'cancelled' && (
        <div className="flex items-center justify-between gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <p className="text-sm text-yellow-700 font-medium">Payment was cancelled — your spot is still reserved.</p>
          <button onClick={() => setPaymentBanner(null)} className="text-yellow-500 text-lg leading-none">×</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Divisions</h2>
        <div className="flex items-center gap-3">
          {isOrganizer && divisions.some(d => d.tournament_registrations.filter(r => r.status === 'registered').length > 0) && !regClosed && (
            <button
              onClick={() => setShowPrep(true)}
              className="text-xs font-semibold text-amber-700 hover:text-amber-800"
            >
              Prep →
            </button>
          )}
          {isOrganizer && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm font-medium text-brand-active hover:underline"
            >
              + Add Division
            </button>
          )}
        </div>
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
                <option value="mixed_doubles">Mixed</option>
                <option value="mens_doubles">Men</option>
                <option value="womens_doubles">Women</option>
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

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Entry Fee <span className="font-normal">(leave blank to use tournament fee)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-sm">$</span>
              <input
                type="number"
                min="0"
                step="5"
                value={fCostDollars}
                onChange={e => setFCostDollars(e.target.value)}
                placeholder="0.00"
                className="w-full input pl-7"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Start Time <span className="font-normal">(optional)</span></label>
              <input
                type="time"
                value={fStartTime}
                onChange={e => setFStartTime(e.target.value)}
                className="w-full input"
              />
            </div>
            <div />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Min Age</label>
              <input
                type="number"
                min="0"
                max="99"
                value={fMinAge}
                onChange={e => setFMinAge(e.target.value)}
                placeholder="Any"
                className="w-full input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Max Age</label>
              <input
                type="number"
                min="0"
                max="99"
                value={fMaxAge}
                onChange={e => setFMaxAge(e.target.value)}
                placeholder="Any"
                className="w-full input"
              />
            </div>
          </div>

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
      {divisions.length === 0 ? (
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
            const active       = div.tournament_registrations.filter(r => r.status === 'registered')
            const waitlist     = div.tournament_registrations.filter(r => r.status === 'waitlisted')
            const teamRegs     = active.filter(r => !r.registration_type || r.registration_type === 'team').length
            const soloRegs     = active.filter(r => r.registration_type === 'solo').length
            const matchedSolos = active.filter(r => r.registration_type === 'solo' && r.partner_registration_id).length
            const unmatchedSolos = soloRegs - matchedSolos
            const effectiveTeams = teamRegs + Math.floor(soloRegs / 2)
            const myReg     = currentUserId
              ? div.tournament_registrations.find(r => r.user_id === currentUserId && r.status !== 'cancelled')
              : undefined
            const isFull    = effectiveTeams >= div.max_entries
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
                    <p className="text-xs text-brand-muted mt-0.5">{summaryLines.join(' · ')}</p>
                    {div.cost_cents != null && div.cost_cents > 0 && (
                      <p className="text-xs text-brand-muted mt-0.5">
                        Entry fee: ${(div.cost_cents / 100).toFixed(2)}
                      </p>
                    )}
                    {isOrganizer && !isEditingFormat && (
                      <button
                        onClick={() => openFormatEdit(div)}
                        className="text-xs text-brand-active hover:underline mt-0.5"
                      >
                        Edit Format
                      </button>
                    )}
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                    isClosed                             ? 'bg-gray-100 text-gray-500'       :
                    isFull && !div.waitlist_enabled      ? 'bg-red-100 text-red-700'         :
                                                          'bg-brand-soft text-brand-active'
                  }`}>
                    {isClosed ? 'Closed' : isFull && !div.waitlist_enabled ? 'Full' : 'Open'}
                  </span>
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
                    <span className="font-semibold text-brand-dark">{div.team_type === 'doubles' ? effectiveTeams : active.length}</span>
                    {' / '}{div.max_entries}{' '}
                    {div.team_type === 'doubles' ? 'teams' : 'players'}
                    {unmatchedSolos > 0 && (
                      <span className="text-amber-600 ml-1">(+{unmatchedSolos} solo{unmatchedSolos > 1 ? 's' : ''} seeking partner)</span>
                    )}
                  </span>
                  {waitlist.length > 0 && <span>· {waitlist.length} waitlisted</span>}
                </div>

                {/* My status */}
                {myReg && (
                  <div className="space-y-2">
                    <div className={`text-xs px-2.5 py-1.5 rounded-lg font-medium ${
                      myReg.status === 'registered' ? 'bg-brand-soft text-brand-active' : 'bg-yellow-50 text-yellow-700'
                    }`}>
                      {myReg.status === 'registered' ? '✓ Registered' : '⏳ On waitlist'}
                      {myReg.team_name && ` · ${myReg.team_name}`}
                      {myReg.registration_type === 'solo' && (
                        myReg.partner_registration_id
                          ? (() => {
                              const partner = div.tournament_registrations.find(r => r.id === myReg.partner_registration_id)
                              return partner ? ` · Partner: ${partner.user_profile?.name ?? 'Matched'}` : ' · Partner matched'
                            })()
                          : ' · Solo — awaiting partner match'
                      )}
                    </div>
                    {(!myReg.payment_status || myReg.payment_status === 'unpaid') && (() => {
                      const effectiveCost = div.cost_cents != null ? div.cost_cents : tournamentCostCents
                      if (effectiveCost <= 0) return null
                      return (
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={discountInputs[div.id] ?? ''}
                            onChange={e => setDiscountInputs(prev => ({ ...prev, [div.id]: e.target.value }))}
                            placeholder="Discount code (optional)"
                            className="w-full input text-xs font-mono uppercase"
                          />
                          <button
                            onClick={() => handlePay(myReg.id, div.id)}
                            className="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                          >
                            Pay My Fee · ${(effectiveCost / 100).toFixed(2)}
                          </button>
                          {myReg.partner_user_id && (
                            <button
                              onClick={() => handlePay(myReg.id, div.id, true)}
                              className="w-full py-2 rounded-xl bg-indigo-100 text-indigo-700 text-xs font-semibold hover:bg-indigo-200 transition-colors"
                            >
                              Pay for Both · ${((effectiveCost * 2) / 100).toFixed(2)}
                            </button>
                          )}
                        </div>
                      )
                    })()}
                    {myReg.payment_status === 'paid' && (
                      <p className="text-xs text-green-600 font-medium">$ Payment received</p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                {currentUserId && (
                  <div className="flex gap-2">
                    {canReg && (
                      <button
                        onClick={() => { setRegisteringDiv(div); setTeamName(''); setRegType('team'); setRegError(null) }}
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
                      <div className="flex items-center gap-3">
                        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Registrants</p>
                        <button
                          onClick={() => setQrDivision({ id: div.id, name: div.name })}
                          className="text-xs text-brand-active hover:underline"
                        >
                          QR Check-in
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isClosed && divisions.filter(d => d.id !== div.id && d.status !== 'closed').length > 0 && (
                          <button
                            onClick={() => { setMergingFromId(mergingFromId === div.id ? null : div.id); setMergeTargetId(''); setMergeError(null) }}
                            className="text-xs text-amber-600 hover:underline"
                          >
                            Merge
                          </button>
                        )}
                        {!isClosed && (
                          <button onClick={() => handleClose(div.id)} className="text-xs text-red-500 hover:underline">
                            Close
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Merge panel */}
                    {mergingFromId === div.id && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-2">
                        <p className="text-xs font-medium text-amber-800">Merge this division into:</p>
                        <select
                          value={mergeTargetId}
                          onChange={e => setMergeTargetId(e.target.value)}
                          className="w-full input text-xs"
                        >
                          <option value="">Select target division…</option>
                          {divisions.filter(d => d.id !== div.id && d.status !== 'closed').map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        {mergeError && <p className="text-xs text-red-600">{mergeError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleMerge(div.id)}
                            disabled={!mergeTargetId || mergeLoading}
                            className="flex-1 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
                          >
                            {mergeLoading ? 'Merging…' : 'Confirm Merge'}
                          </button>
                          <button
                            onClick={() => { setMergingFromId(null); setMergeTargetId('') }}
                            className="px-3 py-1.5 rounded-lg border border-brand-border text-xs text-brand-muted hover:bg-brand-soft"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isManaging && (
                  <div className="space-y-2">

                    {div.tournament_registrations.filter(r => r.status !== 'cancelled').length === 0 ? (
                      <p className="text-xs text-brand-muted">No registrants yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {div.tournament_registrations
                          .filter(r => r.status !== 'cancelled')
                          .map(reg => (
                            <li key={reg.id} className="text-xs border border-brand-border rounded-xl px-3 py-2 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-medium text-brand-dark truncate">
                                    {reg.user_profile?.name ?? reg.user_id.slice(0, 8)}
                                  </span>
                                  {reg.team_name && (
                                    <span className="text-brand-muted truncate">· {reg.team_name}</span>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    reg.status === 'registered' ? 'bg-brand-soft text-brand-active' : 'bg-yellow-50 text-yellow-700'
                                  }`}>
                                    {reg.status === 'registered' ? 'Registered' : 'Waitlisted'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    reg.payment_status === 'paid'     ? 'bg-green-100 text-green-700' :
                                    reg.payment_status === 'waived'   ? 'bg-gray-100 text-gray-500'   :
                                    reg.payment_status === 'refunded' ? 'bg-purple-100 text-purple-700' :
                                                                        'bg-red-50 text-red-600'
                                  }`}>
                                    {reg.payment_status === 'paid'     ? '$ Paid'    :
                                     reg.payment_status === 'waived'   ? 'Waived'    :
                                     reg.payment_status === 'refunded' ? 'Refunded'  : '$ Unpaid'}
                                  </span>
                                  {reg.partner_user_id ? (
                                    <span className="text-brand-muted">Partner ✓</span>
                                  ) : div.team_type === 'doubles' ? (
                                    <span className="text-amber-600">No partner</span>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 gap-2 flex-wrap justify-end">
                                  {reg.payment_status !== 'paid' && reg.payment_status !== 'refunded' && (
                                    <button onClick={() => handleMarkPaid(div.id, reg.id)} className="text-green-600 hover:underline">
                                      Mark Paid
                                    </button>
                                  )}
                                  {reg.payment_status === 'paid' && reg.stripe_payment_intent_id && (
                                    <button onClick={() => handleRefund(div.id, reg.id)} className="text-purple-600 hover:underline">
                                      Refund
                                    </button>
                                  )}
                                  {reg.status === 'waitlisted' && !isFull && (
                                    <button onClick={() => handlePromote(div.id, reg.id)} className="text-brand-active hover:underline">
                                      Promote
                                    </button>
                                  )}
                                  {divisions.filter(d => d.id !== div.id && d.status !== 'closed').length > 0 && (
                                    <button
                                      onClick={() => { setMovingRegId(movingRegId === reg.id ? null : reg.id); setMoveTargetId(''); setMoveError(null) }}
                                      className="text-brand-muted hover:underline"
                                    >
                                      Move
                                    </button>
                                  )}
                                  <button onClick={() => handleRemove(div.id, reg.id)} className="text-red-500 hover:underline">
                                    Remove
                                  </button>
                                </div>
                              </div>
                              {/* Move-to-division inline picker */}
                              {movingRegId === reg.id && (
                                <div className="flex gap-2 pt-1">
                                  <select
                                    value={moveTargetId}
                                    onChange={e => setMoveTargetId(e.target.value)}
                                    className="flex-1 input text-xs"
                                  >
                                    <option value="">Move to…</option>
                                    {divisions.filter(d => d.id !== div.id && d.status !== 'closed').map(d => (
                                      <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleMovePlayer(div.id, reg.id)}
                                    disabled={!moveTargetId || moveLoading}
                                    className="px-2 py-1 rounded-lg bg-brand-dark text-white text-xs font-semibold disabled:opacity-50"
                                  >
                                    {moveLoading ? '…' : 'Move'}
                                  </button>
                                </div>
                              )}
                              {movingRegId === reg.id && moveError && <p className="text-xs text-red-600">{moveError}</p>}
                            </li>
                          ))}
                      </ul>
                    )}

                    {/* Add Player */}
                    {addingPlayerId === div.id ? (
                      <div className="pt-2 space-y-2">
                        <input
                          type="text"
                          value={playerSearch}
                          onChange={e => searchPlayers(e.target.value, div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.category)}
                          onFocus={() => searchPlayers(playerSearch, div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.category)}
                          placeholder="Search player by name…"
                          className="w-full input text-xs"
                          autoFocus
                        />
                        {playerResults.length > 0 && (
                          <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-64">
                            {playerResults.map(p => (
                              <li key={p.id}>
                                <button
                                  onClick={() => handleAddPlayer(div.id, p.id, p.name)}
                                  disabled={addPlayerLoading}
                                  className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft transition-colors"
                                >
                                  {p.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {addPlayerError && <p className="text-xs text-red-600">{addPlayerError}</p>}
                        <button
                          onClick={() => { setAddingPlayerId(null); setPlayerSearch(''); setPlayerResults([]); setAddPlayerError(null) }}
                          className="text-xs text-brand-muted hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingPlayerId(div.id); setPlayerSearch(''); setAddPlayerError(null); searchPlayers('', div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.category) }}
                        className="text-xs text-brand-active font-medium hover:underline pt-1"
                      >
                        + Add Player
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Registration modal ── */}
      {registeringDiv && !justRegistered && (
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
              <div className="space-y-3">
                {/* Team vs Solo toggle */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">Register as</label>
                  <div className="flex rounded-xl overflow-hidden border border-brand-border">
                    <button
                      type="button"
                      onClick={() => setRegType('team')}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${regType === 'team' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
                    >
                      Team (with partner)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegType('solo')}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${regType === 'solo' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
                    >
                      Individual (solo)
                    </button>
                  </div>
                </div>

                {regType === 'team' ? (
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
                      You&apos;ll invite your partner in the next step.
                    </p>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs text-amber-800 font-medium">Auto-matched with a partner</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      You&apos;ll be automatically paired with another solo player. Both players will be notified by email when matched.
                    </p>
                  </div>
                )}
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

      {/* ── Partner invite modal (shown after doubles registration) ── */}
      {justRegistered && registeringDiv && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            {inviteSent ? (
              <>
                <div className="text-center space-y-2">
                  <p className="text-3xl">📧</p>
                  <h2 className="font-heading text-base font-bold text-brand-dark">Invite Sent!</h2>
                  <p className="text-sm text-brand-muted">
                    We emailed <span className="font-medium text-brand-dark">{partnerEmail}</span> with a link to accept your partner invitation.
                  </p>
                </div>
                <button
                  onClick={() => { setJustRegistered(null); setRegisteringDiv(null) }}
                  className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold text-brand-active uppercase tracking-wide mb-1">Step 2 of 2</p>
                  <h2 className="font-heading text-base font-bold text-brand-dark">Invite Your Partner</h2>
                  <p className="text-sm text-brand-muted mt-1">
                    You&apos;re registered! Now invite your doubles partner.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Partner&apos;s Email</label>
                  <input
                    type="email"
                    value={partnerEmail}
                    onChange={e => setPartnerEmail(e.target.value)}
                    placeholder="partner@email.com"
                    className="w-full input"
                    autoFocus
                  />
                </div>

                {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}

                <div className="flex gap-2">
                  <button
                    onClick={handleSendInvite}
                    disabled={inviteLoading || !partnerEmail.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
                  >
                    {inviteLoading ? 'Sending…' : 'Send Invite'}
                  </button>
                  <button
                    onClick={() => { setJustRegistered(null); setRegisteringDiv(null) }}
                    className="px-4 py-2.5 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
                  >
                    Skip
                  </button>
                </div>
                <p className="text-xs text-brand-muted text-center">
                  You can also coordinate your partner with the organizer later.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* QR check-in modal */}
      {qrDivision && (
        <QrCheckinModal
          tournamentId={tournamentId}
          divisionId={qrDivision.id}
          divisionName={qrDivision.name}
          onClose={() => setQrDivision(null)}
        />
      )}

      {/* Prep tournament modal */}
      {showPrep && (
        <PrepTournamentModal
          tournamentId={tournamentId}
          tournamentCostCents={tournamentCostCents}
          divisions={divisions}
          hasMatches={false}
          onClose={() => setShowPrep(false)}
          onRegistrationClosed={() => { setRegClosed(true); router.refresh() }}
        />
      )}
    </div>
  )
}

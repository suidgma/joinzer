'use client'

import { useState, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import FormatSettingsFields, {
  FORMAT_DEFAULTS, BracketType, FormatSettings,
  validateFormatSettings, formatSummaryLines,
} from './FormatSettingsFields'
import QrCheckinModal from './QrCheckinModal'
import PrepTournamentModal from './PrepTournamentModal'
import TimeSelect from '@/components/features/events/TimeSelect'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { prepareDivisionWrite } from '@/lib/taxonomy/write-helpers'
import { isDoublesFormat, formatSkillRange } from '@/lib/taxonomy/formats'
import AddToCalendarMenu from '@/components/features/AddToCalendarMenu'

const FORMAT_LABELS: Record<string, string> = {
  mens_doubles:           "Men's Doubles",
  womens_doubles:         "Women's Doubles",
  mixed_doubles:          'Mixed Doubles',
  coed_doubles:           'Coed Doubles',
  open_doubles:           'Open Doubles',
  mens_singles:           "Men's Singles",
  womens_singles:         "Women's Singles",
  open_singles:           'Open Singles',
  individual_round_robin: 'Individual Round Robin',
  custom:                 'Custom',
}

// Category is the cleaned-up gender slice (see migration
// 20260528000001_tournament_division_category_clean). The auto-name builder
// uses these labels when the organizer didn't type a name.
const CATEGORY_LABELS: Record<string, string> = {
  men:   'Men',
  women: 'Women',
  mixed: 'Mixed',
  coed:  'Coed',
  open:  'Open',
}

const CATEGORY_OPTIONS = [
  { value: 'men',   label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'coed',  label: 'Coed' },
  { value: 'open',  label: 'Open' },
] as const

const SKILL_OPTIONS = ['Beginner', 'Beginner Plus', 'Intermediate', 'Intermediate Plus', 'Advanced']

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
  user_profile: { name: string | null; is_stub?: boolean } | null
}

type Division = {
  id: string
  name: string
  format: string
  category: string
  team_type: string
  partner_mode?: string
  skill_level: string | null
  skill_min: number | null
  skill_max: number | null
  max_entries: number
  waitlist_enabled: boolean
  status: string
  bracket_type: BracketType
  format_settings_json: FormatSettings
  cost_cents: number | null
  min_age: number | null
  max_age: number | null
  start_time: string | null
  tournament_registrations: Registration[]
}

type LocationOption = { id: string; name: string; subarea?: string | null }

type Props = {
  tournamentId: string
  tournamentName?: string
  initialDivisions: Division[]
  isOrganizer: boolean
  currentUserId: string | null
  tournamentCostCents: number
  registrationClosesAt?: string | null
  tournamentStartDate?: string | null
  tournamentStartTime?: string | null
  tournamentEndTime?: string | null
  tournamentLocationName?: string | null
  defaultWinBy?: number
  defaultGamesTo?: number
  defaultBracketType?: BracketType
  defaultLocationId?: string | null
  locations?: LocationOption[]
}

export default function DivisionsSection({ tournamentId, tournamentName, initialDivisions, isOrganizer, currentUserId, tournamentCostCents, registrationClosesAt, tournamentStartDate, tournamentStartTime, tournamentEndTime, tournamentLocationName, defaultWinBy = 1, defaultGamesTo = 11, defaultBracketType = 'round_robin', defaultLocationId = null, locations = [] }: Props) {
  const router = useRouter()
  const [divisions, setDivisions] = useState<Division[]>(initialDivisions)
  const [paymentBanner, setPaymentBanner] = useState<'success' | 'cancelled' | null>(null)
  const [cancelPending, setCancelPending] = useState<{ divId: string; regId: string; divName: string; paymentStatus: string | null } | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

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

  // When an invitee accepts, the server sets partner_user_id on the inviter's row.
  // Without this subscription the inviter's page stays stale and "Pay for Both" never appears.
  useEffect(() => {
    if (!currentUserId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`partner-update-${tournamentId}-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournament_registrations',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updated = payload.new as any
          if (updated.tournament_id !== tournamentId) return
          setDivisions(prev => prev.map(d => ({
            ...d,
            tournament_registrations: d.tournament_registrations.map(r =>
              r.id === updated.id
                ? { ...r, partner_user_id: updated.partner_user_id ?? null, partner_registration_id: updated.partner_registration_id ?? null }
                : r
            ),
          })))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tournamentId, currentUserId])
  const [showAddForm, setShowAddForm] = useState(false)
  const [managingId, setManagingId] = useState<string | null>(null)
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null)
  const [registeringDiv, setRegisteringDiv] = useState<Division | null>(null)

  // Add-division form state
  const [fName, setFName] = useState('')
  const [fCategory, setFCategory] = useState('mixed')
  const [fSkill, setFSkill] = useState('')
  const [fTeamType, setFTeamType] = useState('doubles')
  const [fPartnerMode, setFPartnerMode] = useState<'fixed' | 'rotating'>('fixed')
  const [fMax, setFMax] = useState(16)
  const [fWaitlist, setFWaitlist] = useState(false)
  const [fBracketType, setFBracketType] = useState<BracketType>(defaultBracketType)
  const [fFormatSettings, setFFormatSettings] = useState<FormatSettings>({ ...FORMAT_DEFAULTS[defaultBracketType], win_by: defaultWinBy, games_to: defaultGamesTo })
  const [fLocationId, setFLocationId] = useState<string>(defaultLocationId ?? '')
  const [fCostDollars, setFCostDollars] = useState('')
  const [fMinAge, setFMinAge] = useState('')
  const [fMaxAge, setFMaxAge] = useState('')
  const [fStartTime, setFStartTime] = useState('08:00')
  const [fStartTimeEnabled, setFStartTimeEnabled] = useState(false)
  const [fLoading, setFLoading] = useState(false)
  const [fError, setFError] = useState<string | null>(null)

  // Delete division state
  const [deleteDivPending, setDeleteDivPending] = useState<{ divId: string; divName: string } | null>(null)
  const [deleteDivLoading, setDeleteDivLoading] = useState(false)
  const [deleteDivError, setDeleteDivError] = useState<string | null>(null)

  // Inline division edit state (per division) — mirrors the add-division form
  // so an organizer can change any field after creation, not just format.
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('mixed')
  const [editSkill, setEditSkill] = useState('')
  const [editTeamType, setEditTeamType] = useState('doubles')
  const [editPartnerMode, setEditPartnerMode] = useState<'fixed' | 'rotating'>('fixed')
  const [editMax, setEditMax] = useState(16)
  const [editWaitlist, setEditWaitlist] = useState(false)
  const [editBracketType, setEditBracketType] = useState<BracketType>('round_robin')
  const [editFormatSettings, setEditFormatSettings] = useState<FormatSettings>(FORMAT_DEFAULTS.round_robin)
  const [editLocationId, setEditLocationId] = useState<string>('')
  const [editCostDollars, setEditCostDollars] = useState('')
  const [editMinAge, setEditMinAge] = useState('')
  const [editMaxAge, setEditMaxAge] = useState('')
  const [editStartTime, setEditStartTime] = useState('08:00')
  const [editStartTimeEnabled, setEditStartTimeEnabled] = useState(false)
  const [editFormatLoading, setEditFormatLoading] = useState(false)
  const [editFormatError, setEditFormatError] = useState<string | null>(null)

  // Registration modal state
  const [teamName, setTeamName] = useState('')
  const [regType, setRegType] = useState<'team' | 'solo'>('team')
  const [partnerEmail, setPartnerEmail] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)

  // Add player state (organizer)
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null) // division id
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerResults, setPlayerResults] = useState<{ id: string; name: string }[]>([])
  const [addPlayerLoading, setAddPlayerLoading] = useState(false)
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null)
  // Doubles team add state
  const [selectedP1, setSelectedP1] = useState<{ id: string; name: string } | null>(null)
  const [playerSearch2, setPlayerSearch2] = useState('')
  const [playerResults2, setPlayerResults2] = useState<{ id: string; name: string }[]>([])
  const [addTeamName, setAddTeamName] = useState('')

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

  // "Pay for Both" — partner email input (per division, shown when no partner linked yet)
  const [payBothEmails, setPayBothEmails] = useState<Record<string, string>>({})
  const [showPayBothInput, setShowPayBothInput] = useState<string | null>(null)

  // Move player state (per reg)
  const [movingRegId, setMovingRegId] = useState<string | null>(null)
  const [moveTargetId, setMoveTargetId] = useState<string>('')
  const [moveLoading, setMoveLoading] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  // Pair solo players state (per reg)
  const [pairingRegId, setPairingRegId] = useState<string | null>(null)
  const [pairTargetId, setPairTargetId] = useState<string>('')
  const [pairLoading, setPairLoading] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)

  // ── Add division ──────────────────────────────────────────────────
  async function handleAddDivision(e: React.FormEvent) {
    e.preventDefault()
    const validErr = validateFormatSettings(fBracketType, fFormatSettings)
    if (validErr) { setFError(validErr); return }

    setFLoading(true)
    setFError(null)

    const autoName = fName.trim() ||
      [CATEGORY_LABELS[fCategory], fTeamType === 'singles' ? 'Singles' : 'Doubles', fSkill].filter(Boolean).join(' — ')

    // partner_mode is only meaningful for doubles + round_robin; force 'fixed'
    // otherwise so we never store a value that the match generator would reject.
    const supportsRotating = fTeamType === 'doubles' && fBracketType === 'round_robin'
    const effectivePartnerMode = supportsRotating ? fPartnerMode : 'fixed'

    const supabase = createClient()
    const { data, error } = await supabase
      .from('tournament_divisions')
      .insert({
        tournament_id: tournamentId,
        name: autoName,
        ...prepareDivisionWrite({ category: fCategory, team_type: fTeamType, skill_level: fSkill || null }),
        partner_mode: effectivePartnerMode,
        max_entries: fMax,
        waitlist_enabled: fWaitlist,
        status: 'active',
        bracket_type: fBracketType,
        format_settings_json: fFormatSettings,
        cost_cents: fCostDollars ? Math.round(parseFloat(fCostDollars) * 100) : null,
        min_age: fMinAge ? parseInt(fMinAge) : null,
        max_age: fMaxAge ? parseInt(fMaxAge) : null,
        start_time: fStartTimeEnabled ? fStartTime : null,
        location_id: fLocationId || null,
      })
      .select('id, name, format, category, team_type, partner_mode, skill_level, skill_min, skill_max, max_entries, waitlist_enabled, status, bracket_type, format_settings_json, cost_cents, min_age, max_age, start_time, location_id')
      .single()

    if (error || !data) { setFError(error?.message ?? 'Failed'); setFLoading(false); return }

    setDivisions(prev => [...prev, { ...data, tournament_registrations: [] }])
    setShowAddForm(false)
    setFName(''); setFCategory('mixed'); setFSkill('')
    setFTeamType('doubles'); setFMax(16); setFWaitlist(false)
    setFBracketType(defaultBracketType)
    setFFormatSettings({ ...FORMAT_DEFAULTS[defaultBracketType], win_by: defaultWinBy, games_to: defaultGamesTo })
    setFCostDollars(''); setFMinAge(''); setFMaxAge(''); setFStartTime('08:00')
    setFLocationId(defaultLocationId ?? '')
    setFLoading(false)
  }

  // ── Open division editor (full form) ─────────────────────────────
  function openFormatEdit(div: Division) {
    // Populate every field from the existing row so the organizer sees current values.
    setEditName(div.name ?? '')
    setEditCategory(div.category ?? 'mixed')
    setEditTeamType(div.team_type ?? 'doubles')
    setEditPartnerMode((div.partner_mode === 'rotating' ? 'rotating' : 'fixed'))
    setEditSkill(div.skill_level ?? '')
    setEditMax(div.max_entries)
    setEditWaitlist(!!div.waitlist_enabled)
    setEditBracketType(div.bracket_type)
    setEditFormatSettings(div.format_settings_json ?? FORMAT_DEFAULTS[div.bracket_type])
    setEditCostDollars(div.cost_cents != null ? String(div.cost_cents / 100) : '')
    setEditMinAge(div.min_age != null ? String(div.min_age) : '')
    setEditMaxAge(div.max_age != null ? String(div.max_age) : '')
    setEditStartTime(div.start_time ? div.start_time.slice(0, 5) : '08:00')
    setEditStartTimeEnabled(!!div.start_time)
    setEditLocationId((div as any).location_id ?? defaultLocationId ?? '')
    setEditFormatError(null)
    setEditingFormatId(div.id)
  }

  // ── Save all division edits ──────────────────────────────────────
  async function handleSaveFormat(divisionId: string) {
    const validErr = validateFormatSettings(editBracketType, editFormatSettings)
    if (validErr) { setEditFormatError(validErr); return }

    setEditFormatLoading(true)
    setEditFormatError(null)

    const newCostCents = editCostDollars !== '' ? Math.round(parseFloat(editCostDollars) * 100) : null
    const autoName = editName.trim() ||
      [CATEGORY_LABELS[editCategory], editTeamType === 'singles' ? 'Singles' : 'Doubles', editSkill].filter(Boolean).join(' — ')

    const updatePayload = {
      name: autoName,
      ...prepareDivisionWrite({ category: editCategory, team_type: editTeamType, skill_level: editSkill || null }),
      partner_mode: (editTeamType === 'doubles' && editBracketType === 'round_robin') ? editPartnerMode : 'fixed',
      max_entries: editMax,
      waitlist_enabled: editWaitlist,
      bracket_type: editBracketType,
      format_settings_json: editFormatSettings,
      cost_cents: newCostCents,
      min_age: editMinAge ? parseInt(editMinAge) : null,
      max_age: editMaxAge ? parseInt(editMaxAge) : null,
      start_time: editStartTimeEnabled ? editStartTime : null,
      location_id: editLocationId || null,
    }

    const supabase = createClient()
    const { data: updated, error } = await supabase
      .from('tournament_divisions')
      .update(updatePayload)
      .eq('id', divisionId)
      .select('id, name, format, category, team_type, partner_mode, skill_level, skill_min, skill_max, max_entries, waitlist_enabled, status, bracket_type, format_settings_json, cost_cents, min_age, max_age, start_time, location_id')
      .single()

    if (error || !updated) { setEditFormatError(error?.message ?? 'Save failed'); setEditFormatLoading(false); return }

    setDivisions(prev => prev.map(d =>
      d.id === divisionId
        ? { ...d, ...updated }
        : d
    ))
    setEditingFormatId(null)
    setEditFormatLoading(false)
  }

  // ── Register ─────────────────────────────────────────────────────
  async function handleRegister(div: Division) {
    if (!currentUserId) return

    // Client-side guard: doubles team requires a partner email before committing
    if (isDoublesFormat(div.format) && regType === 'team') {
      if (!partnerEmail.trim()) {
        setRegError("Partner's email is required for doubles registration.")
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail.trim())) {
        setRegError('Please enter a valid email address for your partner.')
        return
      }
    }

    setRegLoading(true)
    setRegError(null)

    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${div.id}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_name: regType === 'team' ? (teamName.trim() || null) : null,
          registration_type: regType,
          discount_code: discountInputs[div.id]?.trim() || undefined,
          ...(isDoublesFormat(div.format) && regType === 'team' ? { partner_email: partnerEmail.trim() } : {}),
        }) }
    )
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg = json.error === 'partner_email_required' ? "Partner's email is required."
        : json.error === 'invalid_partner_email' ? 'Please enter a valid partner email address.'
        : (json.error ?? 'Registration failed')
      setRegError(msg)
      setRegLoading(false)
      return
    }

    // B7.3: paid solo registered → Stripe Checkout (no registration object yet)
    if (json.url) {
      window.location.href = json.url
      return
    }

    const reg: Registration = { ...json.registration, registration_type: regType, partner_registration_id: null, user_profile: null }
    setDivisions(prev => prev.map(d =>
      d.id === div.id
        ? { ...d, tournament_registrations: [...d.tournament_registrations, reg] }
        : d
    ))
    router.refresh()
    setRegisteringDiv(null)
    setTeamName('')
    setPartnerEmail('')
    setRegLoading(false)
  }

  // ── Cancel own registration ───────────────────────────────────────
  async function handleCancel(divisionId: string, regId: string) {
    setCancelLoading(true)
    setCancelError(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${regId}/cancel`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setCancelError(body.error === 'Already cancelled' ? 'Already cancelled — refreshing…' : (body.error ?? "Couldn't cancel — please try again"))
      setCancelLoading(false)
      router.refresh()
      return
    }
    setCancelPending(null)
    setCancelLoading(false)
    updateReg(divisionId, regId, 'cancelled')
    router.refresh()
  }

  // ── Organizer: remove registrant ──────────────────────────────────
  async function handleRemove(divisionId: string, regId: string) {
    await handleCancel(divisionId, regId)
  }

  // ── Organizer: comp a registration (manual override, not real payment) ──
  async function handleMarkComped(divisionId: string, regId: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_registrations')
      .update({ payment_status: 'comped' })
      .eq('id', regId)
    if (error) { alert(error.message); return }
    setDivisions(prev => prev.map(d =>
      d.id !== divisionId ? d : {
        ...d,
        tournament_registrations: d.tournament_registrations.map(r =>
          r.id === regId ? { ...r, payment_status: 'comped' } : r
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
    if (error) { alert(error.message); return }
    updateReg(divisionId, regId, 'registered')
  }

  // ── Organizer: delete division ────────────────────────────────────
  async function handleDeleteDivision(divisionId: string) {
    setDeleteDivLoading(true)
    setDeleteDivError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_divisions')
      .delete()
      .eq('id', divisionId)
    if (error) { setDeleteDivError(error.message); setDeleteDivLoading(false); return }
    setDivisions(prev => prev.filter(d => d.id !== divisionId))
    setDeleteDivPending(null)
    setDeleteDivLoading(false)
  }

  // ── Organizer: close division ─────────────────────────────────────
  async function handleClose(divisionId: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('tournament_divisions')
      .update({ status: 'closed' })
      .eq('id', divisionId)
    if (error) { alert(error.message); return }
    setDivisions(prev => prev.map(d => d.id === divisionId ? { ...d, status: 'closed' } : d))
  }

  // ── Organizer: search players ─────────────────────────────────────
  async function searchPlayers(
    query: string,
    excludeUserIds: string[] = [],
    format?: string,
    setSearch: (v: string) => void = setPlayerSearch,
    setResults: (v: { id: string; name: string }[]) => void = setPlayerResults,
  ) {
    setSearch(query)
    const supabase = createClient()
    let q = supabase.from('profiles').select('id, name, gender').order('name').limit(500)
    if (query.trim().length >= 1) q = (q as any).ilike('name', `%${query}%`)
    const excludeIds = Array.from(new Set((currentUserId ? [currentUserId] : []).concat(excludeUserIds)))
    if (excludeIds.length > 0) q = q.not('id', 'in', `(${excludeIds.join(',')})`)
    if (format === 'mens_doubles' || format === 'mens_singles') q = (q as any).eq('gender', 'male')
    else if (format === 'womens_doubles' || format === 'womens_singles') q = (q as any).eq('gender', 'female')
    const { data } = await q
    setResults(data ?? [])
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

  // ── Organizer: add doubles team (calls register_doubles_pair RPC via route) ──
  async function handleAddTeam(
    divisionId: string,
    p1: { id: string; name: string },
    p2: { id: string; name: string },
    teamName: string,
  ) {
    setAddPlayerLoading(true)
    setAddPlayerError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${divisionId}/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: p1.id, partner_user_id: p2.id, team_name: teamName || null }),
      }
    )
    const json = await res.json()
    if (!res.ok) {
      const errorMessages: Record<string, string> = {
        division_full: 'Division is full',
        division_closed: 'Registration is closed for this division',
        already_registered: `${p1.name} or ${p2.name} is already registered in this division`,
        gender_mismatch: "Both players must match the division's gender requirement",
        not_doubles_format: 'This division is singles — use the singles add flow',
      }
      setAddPlayerError(errorMessages[json.error as string] ?? (json.error ?? 'Failed to add team'))
      setAddPlayerLoading(false)
      return
    }

    const reg1 = { ...json.reg1, user_profile: { name: p1.name } }
    const reg2 = { ...json.reg2, user_profile: { name: p2.name } }
    setDivisions(prev => prev.map(d =>
      d.id === divisionId
        ? { ...d, tournament_registrations: [...d.tournament_registrations, reg1, reg2] }
        : d
    ))
    setAddingPlayerId(null)
    setSelectedP1(null)
    setPlayerSearch('')
    setPlayerSearch2('')
    setPlayerResults([])
    setPlayerResults2([])
    setAddTeamName('')
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

  // ── Pair two solo registrants ──────────────────────────────────────
  async function handlePairSolo(divisionId: string, reg1Id: string, reg2Id: string) {
    if (!pairTargetId) return
    setPairLoading(true)
    setPairError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${divisionId}/pair-solos`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reg1_id: reg1Id, reg2_id: reg2Id }) }
    )
    const json = await res.json()
    if (!res.ok) { setPairError(json.error ?? 'Pairing failed'); setPairLoading(false); return }

    // Optimistic update: set partner links on both rows in local state
    setDivisions(prev => prev.map(d => {
      if (d.id !== divisionId) return d
      const r1 = d.tournament_registrations.find(r => r.id === reg1Id)
      const r2 = d.tournament_registrations.find(r => r.id === reg2Id)
      if (!r1 || !r2) return d
      return {
        ...d,
        tournament_registrations: d.tournament_registrations.map(r => {
          if (r.id === reg1Id) return { ...r, partner_user_id: r2.user_id, partner_registration_id: reg2Id }
          if (r.id === reg2Id) return { ...r, partner_user_id: r1.user_id, partner_registration_id: reg1Id }
          return r
        }),
      }
    }))
    setPairingRegId(null)
    setPairTargetId('')
    setPairLoading(false)
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
  async function handlePay(regId: string, divisionId: string, payForPartner = false, partnerEmailArg?: string) {
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_id: regId,
          pay_for_partner: payForPartner,
          partner_email: partnerEmailArg || undefined,
          discount_code: discountInputs[divisionId]?.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.code === 'PARTNER_ALREADY_PAID') { router.refresh(); return }
        alert(`Payment error: ${json.error ?? 'Unknown error'}`)
        return
      }
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
                {CATEGORY_OPTIONS.filter(o => fTeamType === 'doubles' || !['mixed', 'coed'].includes(o.value)).map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Team Type</label>
              <select
                value={fTeamType}
                onChange={e => { setFTeamType(e.target.value); if (e.target.value === 'singles' && ['mixed', 'coed'].includes(fCategory)) setFCategory('open') }}
                className="w-full input"
              >
                <option value="doubles">Doubles</option>
                <option value="singles">Singles</option>
              </select>
            </div>
          </div>

          {fTeamType === 'doubles' && fBracketType === 'round_robin' && (
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Partner Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFPartnerMode('fixed')}
                  className={`p-2.5 rounded-lg border text-left ${fPartnerMode === 'fixed' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                >
                  <div className="text-sm font-semibold text-brand-dark">Fixed</div>
                  <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">Captains pick partner at registration. Teams stay together every match.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setFPartnerMode('rotating')}
                  className={`p-2.5 rounded-lg border text-left ${fPartnerMode === 'rotating' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                >
                  <div className="text-sm font-semibold text-brand-dark">Rotating</div>
                  <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">Players register solo. New partner every round across the bracket.</div>
                </button>
              </div>
            </div>
          )}

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
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fStartTimeEnabled}
                  onChange={e => setFStartTimeEnabled(e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-brand-muted">Set a start time</span>
              </label>
              {fStartTimeEnabled && <TimeSelect value={fStartTime} onChange={setFStartTime} />}
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

          {locations.length > 0 && (
            <div className="border-t border-brand-border pt-3">
              <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide mb-2">Venue</p>
              <select value={fLocationId} onChange={e => setFLocationId(e.target.value)} className="w-full input text-sm">
                <option value="">— Use tournament venue —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.subarea ? ` — ${l.subarea}` : ''}</option>)}
              </select>
            </div>
          )}

          <div className="border-t border-brand-border pt-3">
            <FormatSettingsFields
              bracketType={fBracketType}
              formatSettings={fFormatSettings}
              onTypeChange={t => { setFBracketType(t); setFFormatSettings({ ...FORMAT_DEFAULTS[t], win_by: defaultWinBy, games_to: defaultGamesTo }) }}
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
            const maxPlayers = isDoublesFormat(div.format) ? div.max_entries * 2 : div.max_entries
            const isFull    = active.length >= maxPlayers
            const isClosed  = div.status === 'closed'
            const canReg    = !myReg && !isClosed && (!isFull || div.waitlist_enabled)
            const isManaging = managingId === div.id
            const isEditingFormat = editingFormatId === div.id
            const hasRegistrants = div.tournament_registrations.filter(r => r.status !== 'cancelled').length > 0

            const fType = div.bracket_type ?? 'round_robin'
            const fSettings = div.format_settings_json ?? FORMAT_DEFAULTS[fType]
            const summaryLines = formatSummaryLines(fType, fSettings)

            return (
              <div key={div.id} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">

                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-heading text-sm font-bold text-brand-dark">{div.name}</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      {FORMAT_LABELS[div.format] ?? div.format}
                      {formatSkillRange(div.skill_min, div.skill_max) && ` · ${formatSkillRange(div.skill_min, div.skill_max)}`}
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
                        Edit Division
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

                {/* Inline division editor — full form, mirrors "Add Division" */}
                {isOrganizer && isEditingFormat && (
                  <div className="border border-brand-border rounded-xl p-3 space-y-3 bg-white">
                    {hasRegistrants && (
                      <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                        This division has registrants. Changes to category, team type, or format may affect existing registrations and match generation.
                      </p>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-brand-muted mb-1">Division Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Auto-generated if blank"
                        className="w-full input"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Category</label>
                        <select value={editCategory} onChange={e => setEditCategory(e.target.value)} className="w-full input">
                          {CATEGORY_OPTIONS.filter(o => editTeamType === 'doubles' || !['mixed', 'coed'].includes(o.value)).map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Team Type</label>
                        <select
                          value={editTeamType}
                          onChange={e => { setEditTeamType(e.target.value); if (e.target.value === 'singles' && ['mixed', 'coed'].includes(editCategory)) setEditCategory('open') }}
                          className="w-full input"
                        >
                          <option value="doubles">Doubles</option>
                          <option value="singles">Singles</option>
                        </select>
                      </div>
                    </div>

                    {editTeamType === 'doubles' && editBracketType === 'round_robin' && (
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Partner Mode</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setEditPartnerMode('fixed')}
                            className={`p-2.5 rounded-lg border text-left ${editPartnerMode === 'fixed' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                          >
                            <div className="text-sm font-semibold text-brand-dark">Fixed</div>
                            <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">Captains pick partner at registration. Teams stay together every match.</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditPartnerMode('rotating')}
                            className={`p-2.5 rounded-lg border text-left ${editPartnerMode === 'rotating' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                          >
                            <div className="text-sm font-semibold text-brand-dark">Rotating</div>
                            <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">Players register solo. New partner every round across the bracket.</div>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Skill Level</label>
                        <select value={editSkill} onChange={e => setEditSkill(e.target.value)} className="w-full input">
                          <option value="">Any</option>
                          {SKILL_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Max Entries</label>
                        <input
                          type="number"
                          value={editMax}
                          onChange={e => setEditMax(Math.max(2, Number(e.target.value)))}
                          min={2}
                          max={256}
                          className="w-full input"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editWaitlist}
                        onChange={e => setEditWaitlist(e.target.checked)}
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
                          value={editCostDollars}
                          onChange={e => setEditCostDollars(e.target.value)}
                          placeholder="0.00"
                          className="w-full input pl-7"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Start Time <span className="font-normal">(optional)</span></label>
                        <label className="flex items-center gap-2 mb-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editStartTimeEnabled}
                            onChange={e => setEditStartTimeEnabled(e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-xs text-brand-muted">Set a start time</span>
                        </label>
                        {editStartTimeEnabled && <TimeSelect value={editStartTime} onChange={setEditStartTime} />}
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
                          value={editMinAge}
                          onChange={e => setEditMinAge(e.target.value)}
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
                          value={editMaxAge}
                          onChange={e => setEditMaxAge(e.target.value)}
                          placeholder="Any"
                          className="w-full input"
                        />
                      </div>
                    </div>

                    {locations.length > 0 && (
                      <div className="border-t border-brand-border pt-3">
                        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide mb-2">Venue</p>
                        <select value={editLocationId} onChange={e => setEditLocationId(e.target.value)} className="w-full input text-sm">
                          <option value="">— Use tournament venue —</option>
                          {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.subarea ? ` — ${l.subarea}` : ''}</option>)}
                        </select>
                      </div>
                    )}

                    <div className="border-t border-brand-border pt-3">
                      <FormatSettingsFields
                        bracketType={editBracketType}
                        formatSettings={editFormatSettings}
                        onTypeChange={t => { setEditBracketType(t); setEditFormatSettings(FORMAT_DEFAULTS[t]) }}
                        onSettingsChange={setEditFormatSettings}
                      />
                    </div>

                    {editFormatError && <p className="text-xs text-red-600">{editFormatError}</p>}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleSaveFormat(div.id)}
                        disabled={editFormatLoading}
                        className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
                      >
                        {editFormatLoading ? 'Saving…' : 'Save Division'}
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
                {(() => {
                  const maxPlayers = isDoublesFormat(div.format) ? div.max_entries * 2 : div.max_entries
                  return (
                    <div className="flex items-center gap-3 text-xs text-brand-muted">
                      <span>
                        <span className="font-semibold text-brand-dark">{active.length}</span>
                        {' / '}{maxPlayers}{' players'}
                        {unmatchedSolos > 0 && (
                          <span className="text-amber-600 ml-1">(+{unmatchedSolos} seeking partner)</span>
                        )}
                      </span>
                      {waitlist.length > 0 && <span>· {waitlist.length} waitlisted</span>}
                    </div>
                  )
                })()}

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
                          : ' · Solo — pending organizer pairing'
                      )}
                    </div>
                    {myReg.status === 'registered' && (() => {
                      const date = tournamentStartDate ?? new Date().toISOString().slice(0, 10)
                      const startIso = tournamentStartTime ? `${date}T${tournamentStartTime}` : date
                      const endIso = tournamentEndTime ? `${date}T${tournamentEndTime}` : undefined
                      return (
                        <AddToCalendarMenu
                          title={tournamentName ?? div.name}
                          startIso={startIso}
                          endIso={endIso}
                          location={tournamentLocationName ?? undefined}
                          icsUrl={`/api/tournaments/${tournamentId}/ics`}
                          timezone="America/Los_Angeles"
                        />
                      )
                    })()}
                    {(!myReg.payment_status || myReg.payment_status === 'unpaid') && (() => {
                      const effectiveCost = div.cost_cents != null ? div.cost_cents : tournamentCostCents
                      if (effectiveCost <= 0) return null
                      const isDoubles = isDoublesFormat(div.format)
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
                          {isDoubles && myReg.partner_user_id && (
                            <button
                              onClick={() => handlePay(myReg.id, div.id, true)}
                              className="w-full py-2 rounded-xl bg-indigo-100 text-indigo-700 text-xs font-semibold hover:bg-indigo-200 transition-colors"
                            >
                              Pay for Both · ${((effectiveCost * 2) / 100).toFixed(2)}
                            </button>
                          )}
                          {isDoubles && !myReg.partner_user_id && (
                            showPayBothInput === div.id ? (
                              <div className="space-y-1.5">
                                <input
                                  type="email"
                                  value={payBothEmails[div.id] ?? ''}
                                  onChange={e => setPayBothEmails(prev => ({ ...prev, [div.id]: e.target.value }))}
                                  placeholder="Partner's email address"
                                  className="w-full input text-xs"
                                  autoFocus
                                />
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => {
                                      const email = payBothEmails[div.id]?.trim()
                                      if (!email) return
                                      setShowPayBothInput(null)
                                      handlePay(myReg.id, div.id, true, email)
                                    }}
                                    className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                                  >
                                    Pay for Both · ${((effectiveCost * 2) / 100).toFixed(2)}
                                  </button>
                                  <button
                                    onClick={() => setShowPayBothInput(null)}
                                    className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                                <p className="text-xs text-brand-muted">Partner must have a Joinzer account.</p>
                              </div>
                            ) : (
                              <button
                                onClick={() => setShowPayBothInput(div.id)}
                                className="w-full py-2 rounded-xl bg-indigo-100 text-indigo-700 text-xs font-semibold hover:bg-indigo-200 transition-colors"
                              >
                                Pay for Both · ${((effectiveCost * 2) / 100).toFixed(2)}
                              </button>
                            )
                          )}
                          <p className="text-xs text-brand-muted">
                            {registrationClosesAt
                              ? <>Refundable until {new Date(registrationClosesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} PT. </>
                              : null}
                            <a href="/refund-policy" className="underline hover:text-brand-dark">Refund policy →</a>
                          </p>
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
                        onClick={() => setCancelPending({ divId: div.id, regId: myReg.id, divName: div.name, paymentStatus: myReg.payment_status ?? null })}
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
                        <button
                          onClick={() => { setDeleteDivError(null); setDeleteDivPending({ divId: div.id, divName: div.name }) }}
                          disabled={hasRegistrants}
                          title={hasRegistrants ? 'Cancel or remove all registrants before deleting' : undefined}
                          className="text-xs text-red-700 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                        >
                          Delete
                        </button>
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
                        {(() => {
                          const nonCancelled = div.tournament_registrations.filter(r => r.status !== 'cancelled')
                          const isConfirmed = (r: typeof nonCancelled[0]) => ['paid', 'waived', 'comped'].includes(r.payment_status ?? '')
                          const confirmed = nonCancelled.filter(isConfirmed)
                          const awaiting = nonCancelled.filter(r => !isConfirmed(r))
                          const sorted = [...confirmed, ...awaiting]
                          return sorted.map((reg, idx) => {
                            const isUnpaid = !isConfirmed(reg)
                            return (
                              <Fragment key={reg.id}>
                                {isUnpaid && idx === confirmed.length && confirmed.length > 0 && (
                                  <li className="py-0.5">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 border-t border-brand-border/60" />
                                      <span className="text-[10px] font-semibold text-brand-muted whitespace-nowrap">
                                        Awaiting payment · {awaiting.length}
                                      </span>
                                      <div className="flex-1 border-t border-brand-border/60" />
                                    </div>
                                  </li>
                                )}
                                <li className={`text-xs border border-brand-border rounded-xl px-3 py-2 space-y-1.5 ${isUnpaid ? 'opacity-60' : ''}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-medium text-brand-dark truncate">
                                    {reg.user_profile?.name ?? (reg.user_id?.slice(0, 8) ?? '—')}
                                  </span>
                                  {reg.user_profile?.is_stub && (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">
                                      Invited
                                    </span>
                                  )}
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
                                    reg.payment_status === 'comped'   ? 'bg-blue-50 text-blue-600'    :
                                    reg.payment_status === 'refunded' ? 'bg-purple-100 text-purple-700' :
                                                                        'bg-red-50 text-red-600'
                                  }`}>
                                    {reg.payment_status === 'paid'     ? '$ Paid'    :
                                     reg.payment_status === 'waived'   ? 'Waived'    :
                                     reg.payment_status === 'comped'   ? 'Comped'    :
                                     reg.payment_status === 'refunded' ? 'Refunded'  : '$ Unpaid'}
                                  </span>
                                  {reg.partner_user_id ? (
                                    <span className="text-brand-muted">Partner ✓</span>
                                  ) : isDoublesFormat(div.format) ? (
                                    <span className="text-amber-600">No partner</span>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 gap-2 flex-wrap justify-end">
                                  {reg.payment_status !== 'paid' && reg.payment_status !== 'refunded' && reg.payment_status !== 'comped' && (
                                    <button onClick={() => handleMarkComped(div.id, reg.id)} className="text-brand-active hover:underline">
                                      Mark Comped
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
                                  {isDoublesFormat(div.format) && reg.registration_type === 'solo' && !reg.partner_registration_id && reg.status === 'registered' && (
                                    <button
                                      onClick={() => { setPairingRegId(pairingRegId === reg.id ? null : reg.id); setPairTargetId(''); setPairError(null) }}
                                      className="text-brand-active hover:underline"
                                    >
                                      Pair
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
                              {/* Pair-solo inline picker */}
                              {pairingRegId === reg.id && (() => {
                                const availablePartners = div.tournament_registrations.filter(r =>
                                  r.id !== reg.id &&
                                  r.registration_type === 'solo' &&
                                  !r.partner_registration_id &&
                                  r.status === 'registered'
                                )
                                return (
                                  <div className="space-y-1 pt-1">
                                    {availablePartners.length === 0 ? (
                                      <p className="text-xs text-brand-muted">No other unpaired solos in this division.</p>
                                    ) : (
                                      <div className="flex gap-2">
                                        <select
                                          value={pairTargetId}
                                          onChange={e => setPairTargetId(e.target.value)}
                                          className="flex-1 input text-xs"
                                        >
                                          <option value="">Pair with…</option>
                                          {availablePartners.map(p => (
                                            <option key={p.id} value={p.id}>
                                              {p.user_profile?.name ?? (p.user_id?.slice(0, 8) ?? '—')}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          onClick={() => handlePairSolo(div.id, reg.id, pairTargetId)}
                                          disabled={!pairTargetId || pairLoading}
                                          className="px-2 py-1 rounded-lg bg-brand-dark text-white text-xs font-semibold disabled:opacity-50"
                                        >
                                          {pairLoading ? '…' : 'Pair'}
                                        </button>
                                      </div>
                                    )}
                                    {pairError && <p className="text-xs text-red-600">{pairError}</p>}
                                  </div>
                                )
                              })()}
                                </li>
                              </Fragment>
                            )
                          })
                        })()}
                      </ul>
                    )}

                    {/* Add Player / Add Team */}
                    {addingPlayerId === div.id ? (
                      <div className="pt-2 space-y-2">
                        {isDoublesFormat(div.format) ? (
                          /* ── Doubles: two-phase player selection ── */
                          selectedP1 ? (
                            /* Phase 2: P1 locked, pick P2 + team name */
                            <>
                              <div className="flex items-center gap-2 px-3 py-2 bg-brand-soft rounded-lg text-xs text-brand-dark">
                                <span className="font-medium">{selectedP1.name}</span>
                                <button
                                  onClick={() => { setSelectedP1(null); setPlayerSearch(''); setPlayerResults([]); setPlayerSearch2(''); setPlayerResults2([]) }}
                                  className="text-brand-muted hover:text-red-500 ml-auto"
                                  aria-label="Remove player 1"
                                >
                                  ✕
                                </button>
                              </div>
                              <input
                                type="text"
                                value={playerSearch2}
                                onChange={e => searchPlayers(e.target.value, [...div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), selectedP1.id], div.format, setPlayerSearch2, setPlayerResults2)}
                                onFocus={() => searchPlayers(playerSearch2, [...div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), selectedP1.id], div.format, setPlayerSearch2, setPlayerResults2)}
                                placeholder="Search partner by name…"
                                className="w-full input text-xs"
                                autoFocus
                              />
                              {playerResults2.length > 0 && (
                                <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-48">
                                  {playerResults2.map(p2 => (
                                    <li key={p2.id}>
                                      <button
                                        onClick={() => handleAddTeam(div.id, selectedP1, p2, addTeamName)}
                                        disabled={addPlayerLoading}
                                        className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft transition-colors"
                                      >
                                        {p2.name}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <input
                                type="text"
                                value={addTeamName}
                                onChange={e => setAddTeamName(e.target.value)}
                                placeholder="Team name (optional)"
                                className="w-full input text-xs"
                              />
                            </>
                          ) : (
                            /* Phase 1: pick P1 */
                            <>
                              <input
                                type="text"
                                value={playerSearch}
                                onChange={e => searchPlayers(e.target.value, div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.format)}
                                onFocus={() => searchPlayers(playerSearch, div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.format)}
                                placeholder="Search player 1 by name…"
                                className="w-full input text-xs"
                                autoFocus
                              />
                              {playerResults.length > 0 && (
                                <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-64">
                                  {playerResults.map(p => (
                                    <li key={p.id}>
                                      <button
                                        onClick={() => { setSelectedP1(p); setPlayerSearch(''); setPlayerResults([]); setPlayerSearch2(''); setPlayerResults2([]) }}
                                        disabled={addPlayerLoading}
                                        className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft transition-colors"
                                      >
                                        {p.name}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          )
                        ) : (
                          /* ── Singles: existing single-player search ── */
                          <>
                            <input
                              type="text"
                              value={playerSearch}
                              onChange={e => searchPlayers(e.target.value, div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.format)}
                              onFocus={() => searchPlayers(playerSearch, div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.format)}
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
                          </>
                        )}
                        {addPlayerError && <p className="text-xs text-red-600">{addPlayerError}</p>}
                        <button
                          onClick={() => {
                            setAddingPlayerId(null)
                            setSelectedP1(null)
                            setPlayerSearch('')
                            setPlayerSearch2('')
                            setPlayerResults([])
                            setPlayerResults2([])
                            setAddTeamName('')
                            setAddPlayerError(null)
                          }}
                          className="text-xs text-brand-muted hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setAddingPlayerId(div.id)
                          setSelectedP1(null)
                          setPlayerSearch('')
                          setPlayerSearch2('')
                          setPlayerResults([])
                          setPlayerResults2([])
                          setAddTeamName('')
                          setAddPlayerError(null)
                          searchPlayers('', div.tournament_registrations.filter(r => r.status !== 'cancelled').map(r => r.user_id), div.format)
                        }}
                        className="text-xs text-brand-active font-medium hover:underline pt-1"
                      >
                        {isDoublesFormat(div.format) ? '+ Add Team' : '+ Add Player'}
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
              {FORMAT_LABELS[registeringDiv.format] ?? registeringDiv.format}
              {formatSkillRange(registeringDiv.skill_min, registeringDiv.skill_max) && ` · ${formatSkillRange(registeringDiv.skill_min, registeringDiv.skill_max)}`}
            </p>

            {isDoublesFormat(registeringDiv.format) && (
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
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Team Name <span className="text-brand-muted font-normal">(optional)</span></label>
                      <input
                        type="text"
                        value={teamName}
                        onChange={e => setTeamName(e.target.value)}
                        placeholder="e.g. Power Smashers"
                        className="w-full input"
                      />
                    </div>
                    {registeringDiv && isDoublesFormat(registeringDiv.format) && (
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Partner&apos;s Email <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          value={partnerEmail}
                          onChange={e => setPartnerEmail(e.target.value)}
                          placeholder="partner@email.com"
                          className="w-full input"
                          autoComplete="off"
                        />
                        <p className="text-xs text-brand-muted mt-1">
                          Your partner will get an email to confirm their spot.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <p className="text-xs text-amber-800 font-medium">Solo registration</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      The organizer will pair you with a partner. Watch for a message from them before the event.
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

      {/* Cancel registration confirmation */}
      <ConfirmModal
        open={cancelPending !== null}
        title="Cancel registration?"
        body={cancelPending
          ? cancelPending.paymentStatus === 'paid'
            ? `Cancel your registration for ${cancelPending.divName}? Your payment will be automatically refunded. Refunds typically appear within 5–10 business days.`
            : `Cancel your registration for ${cancelPending.divName}? This can't be undone, and your spot may be given to someone on the waitlist.`
          : ''}
        confirmLabel="Cancel registration"
        loading={cancelLoading}
        error={cancelError}
        onConfirm={() => cancelPending && handleCancel(cancelPending.divId, cancelPending.regId)}
        onClose={() => { setCancelPending(null); setCancelError(null) }}
      />

      {/* Delete division confirmation */}
      <ConfirmModal
        open={deleteDivPending !== null}
        title="Delete division?"
        body={deleteDivPending ? `Permanently delete "${deleteDivPending.divName}"? This cannot be undone.` : ''}
        confirmLabel="Delete division"
        loading={deleteDivLoading}
        error={deleteDivError}
        onConfirm={() => deleteDivPending && handleDeleteDivision(deleteDivPending.divId)}
        onClose={() => { setDeleteDivPending(null); setDeleteDivError(null) }}
      />
    </div>
  )
}

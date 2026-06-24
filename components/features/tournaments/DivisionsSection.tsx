'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { isDoublesFormat, formatSkillRange, skillRangeToLevel } from '@/lib/taxonomy/formats'
import AddToCalendarMenu from '@/components/features/AddToCalendarMenu'
import SeedingPanel, { type MatchItem } from './SeedingPanel'

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

const BRACKET_LABELS: Record<string, string> = {
  single_elimination:  'Single Elimination',
  double_elimination:  'Double Elimination',
  round_robin:         'Round Robin',
  pool_play_playoffs:  'Pool Play',
}

const ageSegmentLabel = (
  min: string | number | null | undefined,
  max: string | number | null | undefined,
): string | null => {
  const lo = min ? String(min) : ''
  const hi = max ? String(max) : ''
  if (lo && hi) return `Age ${lo}–${hi}`
  if (lo) return `Age ${lo} & Over`
  if (hi) return `Under ${hi}`
  return null
}

// Single source of truth for the auto-generated division name. Used live in the
// add/edit forms and on save when the organizer hasn't typed a custom name.
const buildAutoName = (
  category: string,
  teamType: string,
  skill: string,
  ageSegment: string | null,
  bracketType: string,
): string =>
  [CATEGORY_LABELS[category], teamType === 'singles' ? 'Singles' : 'Doubles', skill, ageSegment, BRACKET_LABELS[bracketType]]
    .filter(Boolean)
    .join(' — ')

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
  seed?: number | null
  user_id: string
  partner_user_id: string | null
  partner_registration_id: string | null
  team_name: string | null
  status: string
  registration_type: 'team' | 'solo'
  payment_status?: string
  stripe_payment_intent_id?: string | null
  user_profile: {
    name: string | null
    is_stub?: boolean
    dupr_rating?: number | null
    estimated_rating?: number | null
  } | null
  partner_profile?: {
    name: string | null
    dupr_rating?: number | null
    estimated_rating?: number | null
  } | null
}

type Division = {
  id: string
  name: string
  format: string
  category: string
  team_type: string
  partner_mode?: string
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
  matchCountByDivision?: Record<string, number>
  matchesByDivision?: Record<string, MatchItem[]>
}

export default function DivisionsSection({ tournamentId, tournamentName, initialDivisions, isOrganizer, currentUserId, tournamentCostCents, registrationClosesAt, tournamentStartDate, tournamentStartTime, tournamentEndTime, tournamentLocationName, defaultWinBy = 1, defaultGamesTo = 11, defaultBracketType = 'round_robin', defaultLocationId = null, locations = [], matchCountByDivision = {}, matchesByDivision = {} }: Props) {
  const router = useRouter()
  const [divisions, setDivisions] = useState<Division[]>(initialDivisions)
  const [paymentBanner, setPaymentBanner] = useState<'success' | 'cancelled' | null>(null)
  const [cancelPending, setCancelPending] = useState<{ divId: string; regId: string; divName: string; paymentStatus: string | null } | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Fixed partner assignment (organizer-only, doubles fixed-mode divisions)
  const [assigningRegId, setAssigningRegId] = useState<string | null>(null)
  const [partnerSelections, setPartnerSelections] = useState<Record<string, string>>({})
  const [savingPartnerRegId, setSavingPartnerRegId] = useState<string | null>(null)

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
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null)
  const [registeringDiv, setRegisteringDiv] = useState<Division | null>(null)

  // Add-division form state
  const [fName, setFName] = useState('')
  // true once the organizer types a custom name; while false the name tracks fAutoName live
  const [fNameDirty, setFNameDirty] = useState(false)
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
  const [fStartTime, setFStartTime] = useState(tournamentStartTime?.slice(0, 5) ?? '08:00')
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
  // true when the division's saved name is a custom one (differs from the auto-name);
  // while false the name tracks editAutoName live as selections change
  const [editNameDirty, setEditNameDirty] = useState(false)
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

  // ── Add division ──────────────────────────────────────────────────
  async function handleAddDivision(e: React.FormEvent) {
    e.preventDefault()
    const validErr = validateFormatSettings(fBracketType, fFormatSettings)
    if (validErr) { setFError(validErr); return }

    setFLoading(true)
    setFError(null)

    const autoName = fName.trim() || fAutoName

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
      .select('id, name, format, category, team_type, partner_mode, skill_min, skill_max, max_entries, waitlist_enabled, status, bracket_type, format_settings_json, cost_cents, min_age, max_age, start_time, location_id')
      .single()

    if (error || !data) { setFError(error?.message ?? 'Failed'); setFLoading(false); return }

    setDivisions(prev => [...prev, { ...data, tournament_registrations: [] }])
    setShowAddForm(false)
    setFName(''); setFNameDirty(false); setFCategory('mixed'); setFSkill('')
    setFTeamType('doubles'); setFMax(16); setFWaitlist(false)
    setFBracketType(defaultBracketType)
    setFFormatSettings({ ...FORMAT_DEFAULTS[defaultBracketType], win_by: defaultWinBy, games_to: defaultGamesTo })
    setFCostDollars(''); setFMinAge(''); setFMaxAge(''); setFStartTime(tournamentStartTime?.slice(0, 5) ?? '08:00')
    setFLocationId(defaultLocationId ?? '')
    setFLoading(false)
  }

  // ── Open division editor (full form) ─────────────────────────────
  function openFormatEdit(div: Division) {
    // Populate every field from the existing row so the organizer sees current values.
    // Start the name in "auto" mode so it reflects the current selections and tracks
    // any changes (this also corrects a stale saved name whose selections have since
    // changed). Typing a custom name overrides; clearing it returns to auto.
    setEditName(div.name ?? '')
    setEditNameDirty(false)
    setEditCategory(div.category ?? 'mixed')
    setEditTeamType(div.team_type ?? 'doubles')
    setEditPartnerMode((div.partner_mode === 'rotating' ? 'rotating' : 'fixed'))
    setEditSkill(skillRangeToLevel(div.skill_min, div.skill_max) ?? '')
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
    const autoName = editNameDirty ? (editName.trim() || editAutoName) : editAutoName

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
      .select('id, name, format, category, team_type, partner_mode, skill_min, skill_max, max_entries, waitlist_enabled, status, bracket_type, format_settings_json, cost_cents, min_age, max_age, start_time, location_id')
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

  // ── Organizer: assign fixed partner ──────────────────────────────
  async function handleAssignPartner(divisionId: string, reg1Id: string) {
    const reg2Id = partnerSelections[reg1Id] || null
    setSavingPartnerRegId(reg1Id)
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/divisions/${divisionId}/assign-partner`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reg1_id: reg1Id, reg2_id: reg2Id }),
        }
      )
      if (!res.ok) {
        const err = await res.json()
        alert(err.error ?? 'Failed to assign partner')
        return
      }
      // Update local state bidirectionally
      setDivisions(prev => prev.map(d => {
        if (d.id !== divisionId) return d
        const reg2 = reg2Id ? d.tournament_registrations.find(r => r.id === reg2Id) : null
        return {
          ...d,
          tournament_registrations: d.tournament_registrations.map(r => {
            if (r.id === reg1Id) return { ...r, partner_registration_id: reg2Id, partner_user_id: reg2?.user_id ?? null }
            if (reg2Id && r.id === reg2Id) return { ...r, partner_registration_id: reg1Id, partner_user_id: d.tournament_registrations.find(x => x.id === reg1Id)?.user_id ?? null }
            // Clear displaced back-links
            if (r.partner_registration_id === reg1Id) return { ...r, partner_registration_id: null, partner_user_id: null }
            if (reg2Id && r.partner_registration_id === reg2Id) return { ...r, partner_registration_id: null, partner_user_id: null }
            return r
          }),
        }
      }))
      setAssigningRegId(null)
      setPartnerSelections(prev => { const n = { ...prev }; delete n[reg1Id]; return n })
    } finally {
      setSavingPartnerRegId(null)
    }
  }

  // ── Organizer: delete division ────────────────────────────────────
  async function handleDeleteDivision(divisionId: string) {
    setDeleteDivLoading(true)
    setDeleteDivError(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${divisionId}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setDeleteDivError(data.error ?? 'Failed to delete division')
      setDeleteDivLoading(false)
      return
    }
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

  // Live-preview name while the organizer fills out the add/edit forms
  const fAutoName = buildAutoName(fCategory, fTeamType, fSkill, ageSegmentLabel(fMinAge, fMaxAge), fBracketType)
  const editAutoName = buildAutoName(editCategory, editTeamType, editSkill, ageSegmentLabel(editMinAge, editMaxAge), editBracketType)

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

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Category</label>
              <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="w-full input">
                {CATEGORY_OPTIONS.filter(o => fTeamType === 'doubles' || !['mixed', 'coed'].includes(o.value)).map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {fTeamType === 'doubles' && (
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Partner Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFPartnerMode('fixed')}
                  className={`p-2.5 rounded-lg border text-left ${fPartnerMode === 'fixed' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                >
                  <div className="text-sm font-semibold text-brand-dark">Fixed</div>
                  <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">Teams register together and stay paired every match.</div>
                </button>
                <button
                  type="button"
                  onClick={() => fBracketType === 'round_robin' ? setFPartnerMode('rotating') : undefined}
                  disabled={fBracketType !== 'round_robin'}
                  className={`p-2.5 rounded-lg border text-left ${fPartnerMode === 'rotating' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'} ${fBracketType !== 'round_robin' ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="text-sm font-semibold text-brand-dark">Rotating</div>
                  <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">
                    {fBracketType !== 'round_robin' ? 'Round robin only.' : 'Players register solo. New partner every round.'}
                  </div>
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
              <label className="block text-xs font-medium text-brand-muted mb-1">
                {fTeamType === 'doubles' ? 'Max Teams' : 'Max Players'}
              </label>
              <input
                type="number"
                value={fMax}
                onChange={e => setFMax(Number(e.target.value))}
                onBlur={e => setFMax(Math.max(2, Math.min(256, Number(e.target.value) || 2)))}
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
              onTypeChange={t => { setFBracketType(t); setFFormatSettings(s => ({ ...FORMAT_DEFAULTS[t], win_by: s.win_by, games_to: s.games_to })) }}
              onSettingsChange={setFFormatSettings}
            />
          </div>

          <div className="border-t border-brand-border pt-3">
            <label className="block text-xs font-medium text-brand-muted mb-1">Division Name <span className="font-normal">(optional — auto-generated from selections above)</span></label>
            <input
              type="text"
              value={fNameDirty ? fName : fAutoName}
              onChange={e => { setFName(e.target.value); setFNameDirty(e.target.value.trim().length > 0) }}
              placeholder={fAutoName}
              className="w-full input"
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
          {[...divisions].sort((a, b) => a.name.localeCompare(b.name)).map(div => {
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
            const isDoubles  = isDoublesFormat(div.format)
            const maxPlayers = isDoubles ? div.max_entries * 2 : div.max_entries
            const isFull     = active.length >= maxPlayers
            // Display counts in teams for doubles (2 registrations per team), players for singles
            const displayCount = isDoubles ? Math.floor(active.length / 2) : active.length
            const displayMax   = div.max_entries
            const displayUnit  = isDoubles ? 'teams' : 'players'
            // Unmatched solo in a doubles division: one player registered without a partner
            const unpairedInDoubles = isDoubles ? active.length % 2 : 0
            const isClosed  = div.status === 'closed'
            const canReg    = !isOrganizer && !myReg && !isClosed && (!isFull || div.waitlist_enabled)
            const isEditingFormat = editingFormatId === div.id
            const hasRegistrants = div.tournament_registrations.filter(r => r.status !== 'cancelled').length > 0
            const isBracket = div.bracket_type === 'single_elimination' || div.bracket_type === 'double_elimination'
            const hasMatches = (matchCountByDivision[div.id] ?? 0) > 0

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

                    {editTeamType === 'doubles' && (
                      <div>
                        <label className="block text-xs font-medium text-brand-muted mb-1">Partner Mode</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setEditPartnerMode('fixed')}
                            className={`p-2.5 rounded-lg border text-left ${editPartnerMode === 'fixed' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'}`}
                          >
                            <div className="text-sm font-semibold text-brand-dark">Fixed</div>
                            <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">Teams register together and stay paired every match.</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => editBracketType === 'round_robin' ? setEditPartnerMode('rotating') : undefined}
                            disabled={editBracketType !== 'round_robin'}
                            className={`p-2.5 rounded-lg border text-left ${editPartnerMode === 'rotating' ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white'} ${editBracketType !== 'round_robin' ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            <div className="text-sm font-semibold text-brand-dark">Rotating</div>
                            <div className="text-[11px] text-brand-muted mt-0.5 leading-snug">
                              {editBracketType !== 'round_robin' ? 'Round robin only.' : 'Players register solo. New partner every round.'}
                            </div>
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
                        <label className="block text-xs font-medium text-brand-muted mb-1">
                          {editTeamType === 'doubles' ? 'Max Teams' : 'Max Players'}
                        </label>
                        <input
                          type="number"
                          value={editMax}
                          onChange={e => setEditMax(Number(e.target.value))}
                          onBlur={e => setEditMax(Math.max(2, Math.min(256, Number(e.target.value) || 2)))}
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
                        onTypeChange={t => { setEditBracketType(t); setEditFormatSettings(s => ({ ...FORMAT_DEFAULTS[t], win_by: s.win_by, games_to: s.games_to })) }}
                        onSettingsChange={setEditFormatSettings}
                      />
                    </div>

                    <div className="border-t border-brand-border pt-3">
                      <label className="block text-xs font-medium text-brand-muted mb-1">Division Name <span className="font-normal">(optional — auto-generated from selections above)</span></label>
                      <input
                        type="text"
                        value={editNameDirty ? editName : editAutoName}
                        onChange={e => { setEditName(e.target.value); setEditNameDirty(e.target.value.trim().length > 0) }}
                        placeholder={editAutoName}
                        className="w-full input"
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
                  return (
                    <div className="flex items-center gap-3 text-xs text-brand-muted">
                      <span>
                        <span className="font-semibold text-brand-dark">{displayCount}</span>
                        {' / '}{displayMax}{' '}{displayUnit}
                        {unpairedInDoubles > 0 && (
                          <span className="text-amber-600 ml-1">(+{unpairedInDoubles} seeking partner)</span>
                        )}
                      </span>
                      {waitlist.length > 0 && <span>· {waitlist.length} waitlisted</span>}
                    </div>
                  )
                })()}

                {/* Fixed partner assignment — organizer only, fixed-mode doubles. Renders only
                    when there are settled registrations (returns null otherwise), so singles
                    and empty divisions stay clean. */}
                {isOrganizer && div.partner_mode === 'fixed' && isDoublesFormat(div.format) && (() => {
                  const settled = active.filter(r =>
                    ['paid', 'waived', 'comped'].includes(r.payment_status ?? '')
                  )
                  if (settled.length === 0) return null

                  // Dedupe paired registrations into teams
                  const seenPairs = new Set<string>()
                  const teams: Array<{ r1: Registration; r2: Registration; label: string }> = []
                  for (const r of settled) {
                    if (!r.partner_registration_id) continue
                    const partner = settled.find(x => x.id === r.partner_registration_id)
                    if (!partner) continue
                    const canonical = r.id < r.partner_registration_id ? `${r.id}|${r.partner_registration_id}` : `${r.partner_registration_id}|${r.id}`
                    if (seenPairs.has(canonical)) continue
                    seenPairs.add(canonical)
                    const n1 = (r.user_profile?.name ?? '?').split(' ')[0]
                    const n2 = (partner.user_profile?.name ?? '?').split(' ')[0]
                    const [first, second] = n1.localeCompare(n2) <= 0 ? [n1, n2] : [n2, n1]
                    teams.push({ r1: r, r2: partner, label: `Team ${first}/${second}` })
                  }
                  teams.sort((a, b) => a.label.localeCompare(b.label))
                  const unassigned = settled.filter(r => !r.partner_registration_id)

                  return (
                    <div className="border-t border-brand-border pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Fixed Partners</p>
                        <span className="text-xs text-brand-muted">Required for schedule generation</span>
                      </div>
                      <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-2">

                        {teams.map(({ r1, r2, label }) => (
                          <div key={`${r1.id}-${r2.id}`} className="border-b border-brand-border last:border-0 pb-2 last:pb-0 space-y-1.5">
                            <span className="text-sm font-semibold text-brand-dark">{label}</span>
                            {[r1, r2].map(r => {
                              const isAssigning = assigningRegId === r.id
                              const eligible = settled.filter(o =>
                                o.id !== r.id &&
                                (!o.partner_registration_id || o.partner_registration_id === r.id)
                              )
                              return (
                                <div key={r.id} className="flex items-center gap-2 pl-2">
                                  <span className="text-xs text-brand-muted flex-1 truncate">{r.user_profile?.name ?? '—'}</span>
                                  {isAssigning ? (
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <select
                                        value={partnerSelections[r.id] ?? r.partner_registration_id ?? ''}
                                        onChange={e => setPartnerSelections(prev => ({ ...prev, [r.id]: e.target.value }))}
                                        className="input text-xs py-0.5"
                                      >
                                        <option value="">— No partner —</option>
                                        {eligible.map(o => (
                                          <option key={o.id} value={o.id}>{o.user_profile?.name ?? o.id}</option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => handleAssignPartner(div.id, r.id)}
                                        disabled={savingPartnerRegId === r.id}
                                        className="text-xs px-2 py-0.5 rounded bg-brand text-brand-dark font-semibold disabled:opacity-40"
                                      >
                                        {savingPartnerRegId === r.id ? '…' : 'Save'}
                                      </button>
                                      <button onClick={() => setAssigningRegId(null)} className="text-xs text-brand-muted">✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setAssigningRegId(r.id); setPartnerSelections(prev => ({ ...prev, [r.id]: r.partner_registration_id ?? '' })) }}
                                      className="text-xs text-brand-active underline underline-offset-2 flex-shrink-0"
                                    >
                                      Change
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ))}

                        {unassigned.length > 0 && (
                          <>
                            {teams.length > 0 && <p className="text-[10px] font-semibold text-brand-muted uppercase tracking-wide pt-1">Unassigned</p>}
                            {unassigned.map(r => {
                              const isAssigning = assigningRegId === r.id
                              const eligible = settled.filter(o =>
                                o.id !== r.id &&
                                (!o.partner_registration_id || o.partner_registration_id === r.id)
                              )
                              return (
                                <div key={r.id} className="flex items-center gap-2 py-1 border-b border-brand-border last:border-0">
                                  <span className="text-sm font-medium text-brand-dark flex-1 min-w-0 truncate">{r.user_profile?.name ?? '—'}</span>
                                  <span className="text-xs text-red-500 font-medium flex-shrink-0">No partner</span>
                                  {isAssigning ? (
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <select
                                        value={partnerSelections[r.id] ?? ''}
                                        onChange={e => setPartnerSelections(prev => ({ ...prev, [r.id]: e.target.value }))}
                                        className="input text-xs py-0.5"
                                      >
                                        <option value="">— Select partner —</option>
                                        {eligible.map(o => (
                                          <option key={o.id} value={o.id}>{o.user_profile?.name ?? o.id}</option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => handleAssignPartner(div.id, r.id)}
                                        disabled={savingPartnerRegId === r.id}
                                        className="text-xs px-2 py-0.5 rounded bg-brand text-brand-dark font-semibold disabled:opacity-40"
                                      >
                                        {savingPartnerRegId === r.id ? '…' : 'Save'}
                                      </button>
                                      <button onClick={() => setAssigningRegId(null)} className="text-xs text-brand-muted">✕</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setAssigningRegId(r.id); setPartnerSelections(prev => ({ ...prev, [r.id]: '' })) }}
                                      className="text-xs text-brand-active underline underline-offset-2 flex-shrink-0"
                                    >
                                      Assign
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </>
                        )}

                        {teams.length === 0 && unassigned.length === 0 && (
                          <p className="text-xs text-brand-muted">No settled registrations yet.</p>
                        )}
                      </div>
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

                {/* Player actions */}
                {currentUserId && (canReg || myReg) && (
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
                  </div>
                )}

                {/* Organizer actions — Enter Scores (when matches exist) + CTAs + lifecycle */}
                {isOrganizer && !isEditingFormat && (
                  <div className="border-t border-brand-border pt-3 space-y-2">
                    {hasMatches && (
                      <Link
                        href={`/tournaments/${tournamentId}/divisions/${div.id}#scores`}
                        className="flex items-center justify-center w-full py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
                      >
                        Enter Scores →
                      </Link>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <Link
                        href={`/tournaments/${tournamentId}/divisions/${div.id}`}
                        className="text-center py-2 rounded-xl border border-brand-border text-xs font-medium text-brand-dark hover:bg-brand-soft hover:border-brand-active transition-colors"
                      >
                        Full View
                      </Link>
                      <button
                        onClick={() => openFormatEdit(div)}
                        className="py-2 rounded-xl border border-brand-border text-xs font-medium text-brand-dark hover:bg-brand-soft hover:border-brand-active transition-colors"
                      >
                        Edit Division
                      </button>
                      <button
                        onClick={() => setQrDivision({ id: div.id, name: div.name })}
                        className="py-2 rounded-xl border border-brand-border text-xs font-medium text-brand-dark hover:bg-brand-soft hover:border-brand-active transition-colors"
                      >
                        QR Check-in
                      </button>
                    </div>

                    {/* Secondary lifecycle actions */}
                    <div className="flex items-center gap-3 text-xs pt-0.5">
                      {!isClosed && divisions.filter(d => d.id !== div.id && d.status !== 'closed').length > 0 && (
                        <button
                          onClick={() => { setMergingFromId(mergingFromId === div.id ? null : div.id); setMergeTargetId(''); setMergeError(null) }}
                          className="text-amber-600 hover:underline"
                        >
                          Merge
                        </button>
                      )}
                      {!isClosed && (
                        <button onClick={() => handleClose(div.id)} className="text-red-500 hover:underline">
                          Close
                        </button>
                      )}
                      <button
                        onClick={() => { setDeleteDivError(null); setDeleteDivPending({ divId: div.id, divName: div.name }) }}
                        disabled={hasRegistrants}
                        title={hasRegistrants ? 'Cancel or remove all registrants before deleting' : undefined}
                        className="text-red-700 hover:underline font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                      >
                        Delete
                      </button>
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
                  const activeRows = registeringDiv.tournament_registrations.filter(r => r.status === 'registered').length
                  const activeTeams = isDoublesFormat(registeringDiv.format) ? Math.floor(activeRows / 2) : activeRows
                  return activeTeams >= registeringDiv.max_entries && registeringDiv.waitlist_enabled
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

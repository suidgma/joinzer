export type LocationOption = {
  id: string
  name: string
  court_count: number
  access_type: string
  subarea: string | null
  // Postal address — optional so callers that don't select these still type-check.
  // The create forms select them to auto-fill the Location area.
  address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  country?: string | null
  lat?: number | null
  lng?: number | null
}

export type EventParticipantItem = {
  id: string
  user_id: string
  participant_status: string
  joined_at: string
  profile: { name: string } | null
}

export type EventListItem = {
  id: string
  title: string
  starts_at: string
  duration_minutes: number
  court_count: number
  max_players: number
  status: string
  session_type: 'game' | 'free_clinic' | 'paid_clinic'
  price_cents: number | null
  notes: string | null
  skill_min: number | null
  skill_max: number | null
  location_id: string
  location: { name: string; court_count: number } | null
  captain: { name: string } | null
  event_participants: { participant_status: string }[]
}

export type TournamentListItem = {
  id: string
  name: string
  description: string | null
  start_date: string
  start_time: string
  estimated_end_time: string | null
  status: string
  visibility: string
  registration_status: string
  location: { name: string } | null
  organizer: { name: string } | null
}

export type TournamentDay = {
  date: string
  start_time: string
  end_time: string
}

// ── Advanced Schedule Builder ──────────────────────────────────────────────────

export type ConflictPolicy = 'warning' | 'error'

export type ScheduleSettings = {
  match_duration_minutes: number
  buffer_minutes: number
  min_rest_minutes: number
  conflict_policy: ConflictPolicy
  keep_divisions_grouped: boolean
  allow_division_overlap: boolean
  allow_court_sharing: boolean
  schedule_by_priority: boolean
  leave_end_buffer: boolean
  end_buffer_minutes: number
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  match_duration_minutes: 15,
  buffer_minutes: 0,
  min_rest_minutes: 0,
  conflict_policy: 'warning',
  keep_divisions_grouped: true,
  allow_division_overlap: true,
  allow_court_sharing: true,
  schedule_by_priority: false,
  leave_end_buffer: false,
  end_buffer_minutes: 0,
}

export type ScheduleBlock = {
  id: string
  tournament_id: string
  name: string
  block_date: string          // 'YYYY-MM-DD'
  start_time: string          // 'HH:MM' / 'HH:MM:SS'
  end_time: string
  location_id: string | null
  court_numbers: number[]
  notes: string | null
  priority: number
  max_divisions: number | null
  created_at: string
  updated_at: string
}

export type DivisionBlockAssignment = {
  id: string
  tournament_id: string
  division_id: string
  block_id: string
  created_at: string
}

export type TournamentDetail = {
  id: string
  name: string
  description: string | null
  start_date: string
  start_time: string
  estimated_end_time: string | null
  additional_days: TournamentDay[]
  status: string
  visibility: string
  registration_status: string
  registration_closes_at: string | null
  organizer_id: string
  cost_cents: number
  scheduling_method: 'timed' | 'rolling'
  show_seeds: boolean
  location_id: string | null
  location: { id: string; name: string; subarea: string | null } | null
  organizer: { name: string } | null
  created_at: string
  updated_at: string
}

export type EventDetail = {
  id: string
  title: string
  starts_at: string
  duration_minutes: number
  court_count: number
  players_per_court: number
  max_players: number
  status: string
  notes: string | null
  skill_min: number | null
  skill_max: number | null
  registration_closes_at: string | null
  creator_user_id: string
  captain_user_id: string
  location_id: string
  location: {
    name: string
    court_count: number
    subarea: string | null
    access_type: string
  } | null
  captain: { name: string } | null
  event_participants: EventParticipantItem[]
}

// League fixture (Phase 0) — a registration-based matchup for the box/flex/team
// formats. Mirrors the tournament_matches shape so the tournament generators and
// computeStandings reuse directly. Unused until Box; the current session-based
// round-robin path does not touch it. See docs/phases/league-formats.md.
export type LeagueFixture = {
  id: string
  league_id: string
  period_id: string | null
  box_id: string | null
  round_number: number | null
  match_number: number
  match_stage: string
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: 'scheduled' | 'in_progress' | 'completed' | 'forfeited' | 'disputed' | 'cancelled'
  court_number: number | null
  scheduled_time: string | null
  window_start: string | null
  window_end: string | null
  reported_by: string | null
  confirmed_by: string | null
  parent_fixture_id: string | null
  created_at: string
  updated_at: string
}

// Box League grouping (Phase 1). league_periods is the generic competition-period
// table (Box: 'cycle'; Flex: 'window'; Team: 'matchday'). A cycle holds tiered
// boxes; each box holds member registrations. Unused until the Box format opts in.
// See docs/phases/league-box-phase1.md.
export type LeaguePeriod = {
  id: string
  league_id: string
  period_kind: 'cycle' | 'window' | 'matchday'
  period_number: number
  name: string | null
  starts_on: string | null
  ends_on: string | null
  status: 'upcoming' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}

export type LeagueBox = {
  id: string
  period_id: string
  league_id: string
  name: string | null
  tier_rank: number
  box_size: number | null
  status: 'active' | 'completed'
  created_at: string
  updated_at: string
}

export type LeagueBoxMember = {
  id: string
  box_id: string
  registration_id: string
  seed_in_box: number | null
  created_at: string
}

// Unified attendance status — the six values shared by every league format's
// attendance grid. See components/features/leagues/AttendanceGrid.tsx.
export type LeagueAttendanceStatus =
  | 'present'
  | 'coming'
  | 'late'
  | 'cannot_attend'
  | 'has_sub'
  | 'not_present'

// Format-agnostic attendance (docs/phases/unified-attendance.md, Phase 2). Keyed
// on a play occasion (a round-robin session XOR a box/flex/etc. period) and an
// attendee (a registration and/or known profile, or an ad-hoc guest). A sub is a
// row whose subbing_for_registration_id points at the covered roster member.
// Unused until the box reader/writer (Phase 3).
export type LeagueAttendance = {
  id: string
  league_id: string
  session_id: string | null
  period_id: string | null
  registration_id: string | null
  user_id: string | null
  guest_name: string | null
  status: LeagueAttendanceStatus
  subbing_for_registration_id: string | null
  arrived_after_round: number | null
  checked_in_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

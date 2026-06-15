export type LocationOption = {
  id: string
  name: string
  court_count: number
  access_type: string
  subarea: string | null
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
  match_duration_minutes: 25,
  buffer_minutes: 5,
  min_rest_minutes: 10,
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

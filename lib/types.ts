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
  min_skill_level: number | null
  max_skill_level: number | null
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

export type TournamentDetail = {
  id: string
  name: string
  description: string | null
  start_date: string
  start_time: string
  estimated_end_time: string | null
  status: string
  visibility: string
  registration_status: string
  organizer_id: string
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
  min_skill_level: number | null
  max_skill_level: number | null
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

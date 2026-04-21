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
  location: { name: string } | null
  captain: { name: string } | null
  event_participants: { participant_status: string }[]
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

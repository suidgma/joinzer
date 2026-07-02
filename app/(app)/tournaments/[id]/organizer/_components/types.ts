export type OrgMatch = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  pool_number: number | null
  sequence_number: number | null
  court_number: number | null
  scheduled_time: string | null
  scheduled_end_time?: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
  // Position placeholders for not-yet-seeded playoff slots ({label:'1st'}, …).
  team_1_source?: { label?: string } | null
  team_2_source?: { label?: string } | null
}

export type OrgRegistration = {
  id: string
  user_id: string
  division_id: string
  team_name: string | null
  status: string
  player_name: string | null
  partner_user_id: string | null
  partner_registration_id: string | null
  checked_in: boolean
  payment_status: string | null
  // Effective seed to display, already gated by the division's "show seed numbers"
  // setting — null when seeds are hidden or unset, so labels can render it blindly.
  display_seed: number | null
  // Player profile fields (denormalized onto each registration for the Players tab)
  gender: string | null
  dupr_rating: number | null
  estimated_rating: number | null
  rating_source: string | null
}

export type OrgDivision = {
  id: string
  name: string
  bracket_type: string
  format: string
}

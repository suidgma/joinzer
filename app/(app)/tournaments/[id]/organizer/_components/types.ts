export type OrgMatch = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  pool_number: number | null
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
}

export type OrgRegistration = {
  id: string
  user_id: string
  division_id: string
  team_name: string | null
  status: string
  player_name: string | null
  partner_user_id: string | null
}

export type OrgDivision = {
  id: string
  name: string
  format_type: string
}

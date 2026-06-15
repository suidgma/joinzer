// Shared prop types for the Advanced Schedule Builder UI.

export type BuilderDay = {
  date: string         // 'YYYY-MM-DD'
  start_time: string   // 'HH:MM' or 'HH:MM:SS'
  end_time: string
}

export type BuilderLocation = {
  id: string
  name: string
  court_count: number
}

export type BuilderDivision = {
  id: string
  name: string
  category: string | null
  team_type: string | null
  format: string | null
  bracket_type: string
  format_settings_json: Record<string, unknown> | null
  skill_min: number | null
  skill_max: number | null
  min_age: number | null
  max_age: number | null
  location_id: string | null
}

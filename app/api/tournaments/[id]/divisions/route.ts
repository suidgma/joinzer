import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { data, error } = await db
    .from('tournament_divisions')
    .select(`
      id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, format_type, format_settings_json,
      tournament_registrations!division_id (
        id, user_id, partner_user_id, team_name, status,
        user_profile:profiles!user_id (name)
      )
    `)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ divisions: data ?? [] })
}

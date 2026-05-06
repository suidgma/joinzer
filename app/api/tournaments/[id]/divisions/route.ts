import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: divisions, error: divErr }, { data: regs, error: regErr }] = await Promise.all([
    db
      .from('tournament_divisions')
      .select('id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, format_type, format_settings_json')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true }),
    db
      .from('tournament_registrations')
      .select('id, division_id, user_id, partner_user_id, team_name, status')
      .eq('tournament_id', params.id),
  ])

  if (divErr) return NextResponse.json({ error: divErr.message }, { status: 500 })
  if (regErr) return NextResponse.json({ error: regErr.message }, { status: 500 })

  // Attach registrations to their divisions
  const regsByDivision: Record<string, any[]> = {}
  for (const reg of regs ?? []) {
    if (!regsByDivision[reg.division_id]) regsByDivision[reg.division_id] = []
    regsByDivision[reg.division_id].push(reg)
  }

  const result = (divisions ?? []).map(div => ({
    ...div,
    tournament_registrations: regsByDivision[div.id] ?? [],
  }))

  return NextResponse.json({ divisions: result }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

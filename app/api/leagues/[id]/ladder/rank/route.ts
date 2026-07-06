import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'

type Params = { params: Promise<{ id: string }> }
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/ladder/rank
// Set the ladder order (initial seeding or a manual adjustment). Replaces every
// stored position with the given order (position = index + 1). Organizer/co-admin
// only. Body: { orderedRegistrationIds: string[] }
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ordered: string[] = Array.isArray(body.orderedRegistrationIds) ? body.orderedRegistrationIds : []
  if (ordered.length === 0) return NextResponse.json({ error: 'No order provided' }, { status: 400 })

  const db = admin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  // Guard: every id must be a registration in this league.
  const { data: regs } = await db
    .from('league_registrations')
    .select('id')
    .eq('league_id', params.id)
    .in('id', ordered)
  const valid = new Set((regs ?? []).map((r: any) => r.id))
  const rows = ordered.filter((id) => valid.has(id)).map((id, i) => ({
    league_id: params.id,
    registration_id: id,
    position: i + 1,
    updated_at: new Date().toISOString(),
  }))
  if (rows.length === 0) return NextResponse.json({ error: 'No valid entrants' }, { status: 400 })

  // Replace the whole ordering (positions are dense 1..N over current entrants).
  await db.from('ladder_positions').delete().eq('league_id', params.id)
  const { error } = await db.from('ladder_positions').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: rows.length })
}

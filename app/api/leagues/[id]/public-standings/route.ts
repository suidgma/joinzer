import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'

type Params = { params: Promise<{ id: string }> }
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/public-standings — toggle the public (no-login) standings
// page at /l/[id] on/off. Organizer/co-admin only. Body: { enabled: boolean }
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { enabled } = await req.json().catch(() => ({}))
  const db = admin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const { error } = await db.from('leagues').update({ public_standings: enabled === true }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, public_standings: enabled === true })
}

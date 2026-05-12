import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'

const service = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET — list staff for this tournament
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await canManage(params.id, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = service()
  const { data, error } = await db
    .from('tournament_staff')
    .select('id, user_id, role, created_at, profiles!user_id(name)')
    .eq('tournament_id', params.id)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}

// POST — invite a user by email as staff
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await canManage(params.id, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, role } = await req.json().catch(() => ({}))
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const staffRole = role === 'volunteer' ? 'volunteer' : 'co_organizer'

  const db = service()

  // Look up via profiles table (has email column, single indexed query)
  const { data: profileRow } = await db
    .from('profiles')
    .select('id')
    .ilike('email', email.trim())
    .single()

  // Fall back to auth.users in case profile row isn't created yet
  let targetId = profileRow?.id
  if (!targetId) {
    const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 })
    const match = users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase())
    targetId = match?.id
  }

  if (!targetId) return NextResponse.json({ error: 'No Joinzer account with that email' }, { status: 404 })
  const target = { id: targetId }

  // Prevent adding the organizer themselves
  const { data: tournament } = await db.from('tournaments').select('organizer_id').eq('id', params.id).single()
  if (tournament?.organizer_id === target.id) {
    return NextResponse.json({ error: 'User is already the organizer' }, { status: 409 })
  }

  const { data, error } = await db
    .from('tournament_staff')
    .insert({ tournament_id: params.id, user_id: target.id, role: staffRole, invited_by: user.id })
    .select('id, user_id, role')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Already a staff member' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ staff: data })
}

// DELETE — remove a staff member by user_id (query param)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await canManage(params.id, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const staffId = searchParams.get('id')
  if (!staffId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = service()
  const { error } = await db
    .from('tournament_staff')
    .delete()
    .eq('id', staffId)
    .eq('tournament_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

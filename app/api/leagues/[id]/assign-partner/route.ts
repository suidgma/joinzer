import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST — assign two players as fixed partners (bidirectional)
// Body: { userId1, userId2 }
// To unassign a player: { userId1, userId2: null }
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const userId1: string = body.userId1
  const userId2: string | null = body.userId2 ?? null
  if (!userId1) return NextResponse.json({ error: 'userId1 required' }, { status: 400 })

  // Load the involved registrations (need their ids for partner_registration_id —
  // the box engine reads that column; the round-robin scheduler reads
  // partner_user_id — so we keep both in sync).
  const userIds = [userId1, ...(userId2 ? [userId2] : [])]
  const { data: regs } = await db
    .from('league_registrations')
    .select('id, user_id, partner_user_id')
    .eq('league_id', params.id)
    .in('user_id', userIds)
  const byUser = new Map((regs ?? []).map((r: any) => [r.user_id, r]))
  const reg1 = byUser.get(userId1)
  if (!reg1) return NextResponse.json({ error: 'Player not registered in this league' }, { status: 400 })
  const reg2 = userId2 ? byUser.get(userId2) : null
  if (userId2 && !reg2) return NextResponse.json({ error: 'Partner not registered in this league' }, { status: 400 })

  // Clear both columns for the two players plus anyone they were previously linked to
  // (so we don't leave orphaned back-links), then set the new bidirectional pairing.
  const toClear = new Set<string>([userId1])
  if (userId2) toClear.add(userId2)
  if (reg1.partner_user_id && reg1.partner_user_id !== userId2) toClear.add(reg1.partner_user_id)
  if (reg2?.partner_user_id && reg2.partner_user_id !== userId1) toClear.add(reg2.partner_user_id)
  await db.from('league_registrations')
    .update({ partner_user_id: null, partner_registration_id: null })
    .eq('league_id', params.id)
    .in('user_id', [...toClear])

  if (userId2 && reg2) {
    await Promise.all([
      db.from('league_registrations').update({ partner_user_id: userId2, partner_registration_id: reg2.id }).eq('id', reg1.id),
      db.from('league_registrations').update({ partner_user_id: userId1, partner_registration_id: reg1.id }).eq('id', reg2.id),
    ])
  }

  return NextResponse.json({ ok: true })
}

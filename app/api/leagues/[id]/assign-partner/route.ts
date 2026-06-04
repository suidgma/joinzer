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

  // If userId2 is provided, first clear any existing partner links for both players
  // to avoid orphaned links when re-assigning.
  const { data: reg1 } = await db
    .from('league_registrations')
    .select('partner_user_id')
    .eq('league_id', params.id)
    .eq('user_id', userId1)
    .single()

  const oldPartner1 = reg1?.partner_user_id ?? null

  // Clear old partner's back-link if they had one
  if (oldPartner1 && oldPartner1 !== userId2) {
    await db.from('league_registrations')
      .update({ partner_user_id: null })
      .eq('league_id', params.id)
      .eq('user_id', oldPartner1)
  }

  if (userId2) {
    // Also clear userId2's existing partner's back-link
    const { data: reg2 } = await db
      .from('league_registrations')
      .select('partner_user_id')
      .eq('league_id', params.id)
      .eq('user_id', userId2)
      .single()

    const oldPartner2 = reg2?.partner_user_id ?? null
    if (oldPartner2 && oldPartner2 !== userId1) {
      await db.from('league_registrations')
        .update({ partner_user_id: null })
        .eq('league_id', params.id)
        .eq('user_id', oldPartner2)
    }

    // Set bidirectional link
    await Promise.all([
      db.from('league_registrations').update({ partner_user_id: userId2 }).eq('league_id', params.id).eq('user_id', userId1),
      db.from('league_registrations').update({ partner_user_id: userId1 }).eq('league_id', params.id).eq('user_id', userId2),
    ])
  } else {
    // Unassign: clear userId1's partner_user_id only (old partner already cleared above)
    await db.from('league_registrations')
      .update({ partner_user_id: null })
      .eq('league_id', params.id)
      .eq('user_id', userId1)
  }

  return NextResponse.json({ ok: true })
}

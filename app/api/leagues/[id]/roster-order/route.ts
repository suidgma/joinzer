import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST { order: string[] } — registration ids in the desired display order.
// Persists each row's sort_order to its index. Primary organizer or co-admin.
// Display-only order; leagues don't seed brackets.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let allowed = league.created_by === user.id
  if (!allowed) {
    const { data: myReg } = await db
      .from('league_registrations')
      .select('is_co_admin')
      .eq('league_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()
    allowed = myReg?.is_co_admin === true
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const order: string[] = Array.isArray(body.order) ? body.order.filter((x: unknown) => typeof x === 'string') : []
  if (order.length === 0) return NextResponse.json({ ok: true })

  // sort_order = position in the list. The league_id guard keeps a caller from
  // touching rows in another league even with a forged id.
  await Promise.all(order.map((id, i) =>
    db.from('league_registrations').update({ sort_order: i }).eq('id', id).eq('league_id', params.id)
  ))

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { broadcastLeagueFixtures } from '@/lib/realtime/leagueBroadcast'

// POST /api/leagues/[id]/fixtures-changed
// A thin "results changed" ping for league surfaces whose scoring happens CLIENT-side
// (round-robin organizer entry writes league_matches directly), so there's no server
// route to hang the broadcast off. The client calls this after a successful write and it
// re-emits the per-league fixtures signal that RealtimeRefresh listens for. Gated to
// league members (organizer / co-admin / registered) so it can't be used to spam refreshes.
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', id).maybeSingle()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let member = (league as any).created_by === user.id
  if (!member) {
    const { data: reg } = await db
      .from('league_registrations')
      .select('id')
      .eq('league_id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    member = !!reg
  }
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await broadcastLeagueFixtures(id)
  return NextResponse.json({ ok: true })
}

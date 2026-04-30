import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET — list sub requests (filter by ?sessionId or ?leagueId)
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  const leagueId  = searchParams.get('leagueId')

  let query = supabase
    .from('league_sub_requests')
    .select(`
      id, league_id, league_session_id, status, notes, created_at,
      requested_skill_level, division_type,
      requesting_player:profiles!requesting_player_id(name),
      claimed_by:profiles!claimed_by_user_id(name),
      session:league_sessions!league_session_id(session_date, session_number),
      league:leagues!league_id(name)
    `)
    .order('created_at', { ascending: false })

  if (sessionId) query = query.eq('league_session_id', sessionId)
  if (leagueId)  query = query.eq('league_id', leagueId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST — create a sub request
// Body: { league_id, league_session_id, notes?, requested_skill_level? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { league_id, league_session_id, notes, requested_skill_level } = body

  if (!league_id || !league_session_id) {
    return NextResponse.json({ error: 'league_id and league_session_id are required' }, { status: 400 })
  }

  const db = admin()

  // Verify user is registered for this league
  const { data: reg } = await db
    .from('league_registrations')
    .select('status')
    .eq('league_id', league_id)
    .eq('user_id', user.id)
    .single()
  if (!reg || reg.status !== 'registered') {
    return NextResponse.json({ error: 'You must be registered for this league to request a sub' }, { status: 403 })
  }

  // Prevent duplicates for the same player+session
  const { data: existing } = await db
    .from('league_sub_requests')
    .select('id, status')
    .eq('league_session_id', league_session_id)
    .eq('requesting_player_id', user.id)
    .in('status', ['open', 'claimed', 'approved'])
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'You already have an open sub request for this session' }, { status: 409 })
  }

  const { data: subReq, error } = await db
    .from('league_sub_requests')
    .insert({
      league_id,
      league_session_id,
      requesting_player_id: user.id,
      requested_skill_level: requested_skill_level ?? null,
      notes: notes ?? null,
      status: 'open',
    })
    .select()
    .single()

  if (error || !subReq) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

  // Notify organizer (fire-and-forget)
  sendOrganizerNotification(league_id, subReq.id, user.email ?? '').catch(console.error)

  return NextResponse.json(subReq, { status: 201 })
}

async function sendOrganizerNotification(
  leagueId: string,
  subRequestId: string,
  playerEmail: string
) {
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const resend = new Resend(process.env.RESEND_API_KEY)

  const { data: league } = await db.from('leagues').select('name, created_by').eq('id', leagueId).single()
  if (!league) return

  const { data: organizer } = await db.from('profiles').select('email, name').eq('id', league.created_by).single()
  if (!organizer?.email) return

  const leagueUrl = `https://joinzer.com/compete/leagues/${leagueId}`
  await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: organizer.email,
    replyTo: 'martyfit50@gmail.com',
    subject: `Sub needed: ${league.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">Sub request created</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 16px;font-size:14px;color:#374151">
            A player in <strong>${league.name}</strong> has created a sub request for an upcoming session.
          </p>
          <div style="margin-top:8px">
            <a href="${leagueUrl}/roster" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Roster →</a>
          </div>
        </div>
      </div>
    `,
  })
}

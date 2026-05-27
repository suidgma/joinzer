import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/members — organizer adds a player
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const userId: string = body.userId
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const { error } = await db
    .from('league_registrations')
    .upsert(
      { league_id: params.id, user_id: userId, status: 'registered', registered_at: new Date().toISOString() },
      { onConflict: 'league_id,user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Email the added player (fire-and-forget)
  notifyPlayerAdded(params.id, userId).catch(console.error)

  // Sync into league_session_players for non-completed sessions
  const [{ data: profile }, { data: sessions }] = await Promise.all([
    db.from('profiles').select('name, joinzer_rating, dupr_rating, estimated_rating').eq('id', userId).single(),
    db.from('league_sessions').select('id').eq('league_id', params.id).neq('status', 'completed'),
  ])

  if (sessions && sessions.length > 0 && profile) {
    const rows = sessions.map((s) => ({
      session_id: s.id,
      user_id: userId,
      display_name: (profile as { name: string }).name,
      player_type: 'roster_player',
      expected_status: 'expected',
      actual_status: 'not_present',
      joinzer_rating: (profile as { joinzer_rating: number | null }).joinzer_rating ?? 1000,
    }))
    // Only insert if not already present
    await db.from('league_session_players').upsert(rows, { onConflict: 'session_id,user_id', ignoreDuplicates: true })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

async function notifyPlayerAdded(leagueId: string, userId: string) {
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const resend = new Resend(process.env.RESEND_API_KEY)

  const [{ data: league }, { data: player }] = await Promise.all([
    db.from('leagues').select('name, format, skill_level, location_name').eq('id', leagueId).single(),
    db.from('profiles').select('email, name').eq('id', userId).single(),
  ])

  if (!league || !player?.email) return

  const leagueUrl = `https://joinzer.com/compete/leagues/${leagueId}`

  const FORMAT_LABELS: Record<string, string> = {
    individual_round_robin: 'Individual Round Robin',
    mens_doubles: "Men's Doubles",
    womens_doubles: "Women's Doubles",
    mixed_doubles: 'Mixed Doubles',
    coed_doubles: 'Coed Doubles',
    singles: 'Singles',
    custom: 'Custom',
  }

  const formatLabel = FORMAT_LABELS[(league as { format: string }).format] ?? (league as { format: string }).format

  await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: player.email,
    replyTo: 'martyfit50@gmail.com',
    subject: `You've been added to ${(league as { name: string }).name}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">You're in the league!</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 16px;font-size:14px;color:#374151">
            Hi ${(player as { name: string }).name}, you've been added to a league on Joinzer.
          </p>
          <h2 style="margin:0 0 16px;font-size:18px">${(league as { name: string }).name}</h2>
          <table style="width:100%;border-collapse:collapse">
            ${formatLabel ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🏓 Format</td><td style="padding:6px 0;font-size:14px">${formatLabel}</td></tr>` : ''}
            ${(league as { skill_level: string | null }).skill_level ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🎯 Skill Level</td><td style="padding:6px 0;font-size:14px">${(league as { skill_level: string }).skill_level}</td></tr>` : ''}
            ${(league as { location_name: string | null }).location_name ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📍 Location</td><td style="padding:6px 0;font-size:14px">${(league as { location_name: string }).location_name}</td></tr>` : ''}
          </table>
          <p style="margin:16px 0;font-size:14px;color:#374151">Log in to see your schedule, check in for sessions, and connect with your league.</p>
          <div style="margin-top:8px">
            <a href="${leagueUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View League →</a>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this because you were added to a league on Joinzer.</p>
        </div>
      </div>
    `,
  })
}

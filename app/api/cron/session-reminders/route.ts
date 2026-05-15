export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

// Vercel calls this daily at 8 AM Pacific.
// Protected by CRON_SECRET — set this in Vercel env vars and add it
// to vercel.json so Vercel sends it automatically.

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const resend = new Resend(process.env.RESEND_API_KEY)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'

  // "Tomorrow" in Pacific time
  const now = new Date()
  const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const tomorrow = new Date(pst)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10) // YYYY-MM-DD

  let totalSent = 0
  const errors: string[] = []

  // ── 1. Play sessions (events) happening tomorrow ──────────────────────────

  const tomorrowStart = `${tomorrowStr}T00:00:00.000Z`
  const tomorrowEnd   = `${tomorrowStr}T23:59:59.999Z`

  const { data: tomorrowEvents } = await db
    .from('events')
    .select(`
      id, title, starts_at, duration_minutes, max_players,
      location:locations!location_id (name)
    `)
    .gte('starts_at', tomorrowStart)
    .lte('starts_at', tomorrowEnd)
    .in('status', ['open', 'full'])

  for (const ev of tomorrowEvents ?? []) {
    const { data: participants } = await db
      .from('event_participants')
      .select('user_id')
      .eq('event_id', ev.id)
      .eq('participant_status', 'joined')

    if (!participants?.length) continue

    const userIds = participants.map((p) => p.user_id as string)
    const { data: profiles } = await db
      .from('profiles')
      .select('name, email')
      .in('id', userIds)
      .not('email', 'is', null)

    if (!profiles?.length) continue

    const startsAt = new Date(ev.starts_at as string)
    const timeStr = startsAt.toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
    })
    const dur = ev.duration_minutes as number
    const durationStr = dur % 60 === 0 ? `${dur / 60}h` : `${Math.floor(dur / 60)}h ${dur % 60}m`
    const locationName = (ev.location as any)?.name ?? ''

    const emailBatch = profiles.map((p) => ({
      from: 'Joinzer <support@joinzer.com>',
      to: p.email as string,
      replyTo: 'martyfit50@gmail.com',
      subject: `Tomorrow: ${ev.title}`,
      html: reminderHtml({
        firstName: (p.name as string)?.split(' ')[0] ?? 'there',
        heading: "You're playing tomorrow!",
        name: ev.title as string,
        details: [
          locationName && { label: 'Location', value: locationName },
          { label: 'Time', value: timeStr },
          { label: 'Duration', value: durationStr },
        ].filter(Boolean) as { label: string; value: string }[],
        ctaUrl: `${siteUrl}/events/${ev.id}`,
        ctaText: 'View Session',
        type: 'Play Session',
      }),
    }))

    const { error } = await resend.batch.send(emailBatch)
    if (error) errors.push(`event ${ev.id}: ${error.message}`)
    else totalSent += emailBatch.length
  }

  // ── 2. League sessions happening tomorrow ─────────────────────────────────

  const { data: leagueSessions } = await db
    .from('league_sessions')
    .select(`
      id, league_id, session_number, session_date,
      league:leagues!league_id (name, location_name, schedule_description)
    `)
    .eq('session_date', tomorrowStr)
    .in('status', ['scheduled', 'in_progress'])

  for (const session of leagueSessions ?? []) {
    // Get registered + confirmed players for this league
    const { data: registrations } = await db
      .from('league_registrations')
      .select('user_id')
      .eq('league_id', session.league_id as string)
      .in('status', ['registered', 'confirmed'])

    if (!registrations?.length) continue

    const userIds = registrations.map((r) => r.user_id as string)
    const { data: profiles } = await db
      .from('profiles')
      .select('name, email')
      .in('id', userIds)
      .not('email', 'is', null)

    if (!profiles?.length) continue

    const league = session.league as any
    const leagueName = league?.name ?? 'League'
    const locationName = league?.location_name ?? ''
    const schedule = league?.schedule_description ?? ''

    const emailBatch = profiles.map((p) => ({
      from: 'Joinzer <support@joinzer.com>',
      to: p.email as string,
      replyTo: 'martyfit50@gmail.com',
      subject: `Tomorrow: ${leagueName} — Session ${session.session_number}`,
      html: reminderHtml({
        firstName: (p.name as string)?.split(' ')[0] ?? 'there',
        heading: "League session tomorrow!",
        name: `${leagueName} — Session ${session.session_number as number}`,
        details: [
          locationName && { label: 'Location', value: locationName },
          schedule && { label: 'Schedule', value: schedule },
        ].filter(Boolean) as { label: string; value: string }[],
        ctaUrl: `${siteUrl}/compete/leagues/${session.league_id}`,
        ctaText: 'View League',
        type: 'League Session',
      }),
    }))

    const { error } = await resend.batch.send(emailBatch)
    if (error) errors.push(`league session ${session.id}: ${error.message}`)
    else totalSent += emailBatch.length
  }

  return NextResponse.json({
    ok: true,
    totalSent,
    errors: errors.length ? errors : undefined,
    tomorrowDate: tomorrowStr,
  })
}

// ── Email template ────────────────────────────────────────────────────────────

function reminderHtml({
  firstName, heading, name, details, ctaUrl, ctaText, type,
}: {
  firstName: string
  heading: string
  name: string
  details: { label: string; value: string }[]
  ctaUrl: string
  ctaText: string
  type: string
}) {
  const rows = details
    .map((d) => `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">${d.label}</td><td style="padding:6px 0;font-size:14px">${d.value}</td></tr>`)
    .join('')

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
      <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;font-size:20px;color:#012D0B">${heading}</h1>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="margin:0 0 20px;font-size:15px">Hey ${firstName}, just a reminder that you have a ${type} tomorrow.</p>
        <p style="margin:0 0 16px;font-size:16px;font-weight:600">${name}</p>
        ${rows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rows}</table>` : ''}
        <a href="${ctaUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${ctaText}</a>
        <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the court!</p>
      </div>
    </div>
  `
}

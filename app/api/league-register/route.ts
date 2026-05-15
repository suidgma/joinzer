import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { generateIcs } from '@/lib/email/ics'

const DOUBLES_FORMATS = ['mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles']

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual Round Robin',
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  singles: 'Singles',
  custom: 'Custom',
}

const SKILL_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  beginner_plus: 'Beginner Plus',
  intermediate: 'Intermediate',
  intermediate_plus: 'Intermediate Plus',
  advanced: 'Advanced',
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { leagueId } = body
  const registration_type: 'team' | 'solo' = body.registration_type === 'solo' ? 'solo' : 'team'

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('name, format, skill_level, location_name, start_date, end_date, max_players, registration_status, registration_closes_at, cost_cents, schedule_description')
    .eq('id', leagueId)
    .single()

  if (leagueErr || !league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  if (league.registration_status !== 'open' && league.registration_status !== 'waitlist_only') {
    return NextResponse.json({ error: 'Registration is not open' }, { status: 400 })
  }

  if ((league as any).registration_closes_at && new Date() > new Date((league as any).registration_closes_at)) {
    return NextResponse.json({ error: 'Registration is closed' }, { status: 400 })
  }

  if ((league as any).cost_cents > 0) {
    return NextResponse.json({ error: 'Payment required', requiresPayment: true }, { status: 402 })
  }

  // Solo only valid for doubles formats
  if (registration_type === 'solo' && !DOUBLES_FORMATS.includes(league.format)) {
    return NextResponse.json({ error: 'Solo registration is only available for doubles leagues' }, { status: 400 })
  }

  // Gender gate for mens/womens doubles
  const GENDER_REQUIRED: Record<string, string> = {
    mens_doubles: 'male',
    womens_doubles: 'female',
  }
  const requiredGender = GENDER_REQUIRED[league.format] ?? null
  if (requiredGender) {
    const { data: profile } = await admin.from('profiles').select('gender').eq('id', user.id).single()
    const userGender = (profile as any)?.gender ?? null
    if (userGender !== requiredGender) {
      const label = requiredGender === 'male' ? "Men's" : "Women's"
      return NextResponse.json(
        { error: `This is a ${label} Doubles league. Update your gender in your profile to register.` },
        { status: 403 }
      )
    }
  }

  // Count registered players
  const { count: registeredCount } = await admin
    .from('league_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('status', 'registered')

  const isFull = league.max_players != null && (registeredCount ?? 0) >= league.max_players
  const status = (league.registration_status === 'open' && !isFull) ? 'registered' : 'waitlist'

  const { error: upsertErr } = await admin
    .from('league_registrations')
    .upsert(
      { league_id: leagueId, user_id: user.id, status, registration_type },
      { onConflict: 'league_id,user_id' }
    )

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  // Auto-match solo players in doubles leagues
  let matchedWith: { name: string } | null = null

  if (registration_type === 'solo' && status === 'registered') {
    // For gender-specific leagues, only match with a partner of the same required gender.
    // For mixed/coed, no gender filter — any solo can match any other solo.
    let soloPartner: { id: string; user_id: string } | null = null

    if (requiredGender) {
      // Fetch all unmatched solos, then cross-reference their gender from profiles
      const { data: candidateRegs } = await admin
        .from('league_registrations')
        .select('id, user_id')
        .eq('league_id', leagueId)
        .eq('status', 'registered')
        .eq('registration_type', 'solo')
        .is('partner_user_id', null)
        .neq('user_id', user.id)
        .order('registered_at', { ascending: true })

      if (candidateRegs && candidateRegs.length > 0) {
        const candidateIds = candidateRegs.map(r => r.user_id)
        const { data: genderedProfiles } = await admin
          .from('profiles')
          .select('id, gender')
          .in('id', candidateIds)
          .eq('gender', requiredGender)

        const matchableIds = new Set((genderedProfiles ?? []).map(p => p.id))
        soloPartner = candidateRegs.find(r => matchableIds.has(r.user_id)) ?? null
      }
    } else {
      const { data } = await admin
        .from('league_registrations')
        .select('id, user_id')
        .eq('league_id', leagueId)
        .eq('status', 'registered')
        .eq('registration_type', 'solo')
        .is('partner_user_id', null)
        .neq('user_id', user.id)
        .order('registered_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      soloPartner = data
    }

    if (soloPartner) {
      // Fetch both registrations' IDs
      const { data: myReg } = await admin
        .from('league_registrations')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single()

      if (myReg) {
        await Promise.all([
          admin.from('league_registrations').update({
            partner_user_id: soloPartner.user_id,
            partner_registration_id: soloPartner.id,
          }).eq('id', myReg.id),
          admin.from('league_registrations').update({
            partner_user_id: user.id,
            partner_registration_id: myReg.id,
          }).eq('id', soloPartner.id),
        ])

        const { data: profiles } = await admin
          .from('profiles')
          .select('id, name, email')
          .in('id', [user.id, soloPartner.user_id])

        const myProfile = profiles?.find(p => p.id === user.id)
        const partnerProfile = profiles?.find(p => p.id === soloPartner.user_id)

        if (partnerProfile) matchedWith = { name: partnerProfile.name ?? 'Your partner' }

        if (myProfile && partnerProfile) {
          const resend = new Resend(process.env.RESEND_API_KEY)
          const leagueUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'}/compete/leagues/${leagueId}`

          const emailHtml = (recipientName: string, partnerName: string) => `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
              <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
                <h1 style="margin:0;font-size:20px;color:#012D0B">You've been matched with a partner! 🎉</h1>
              </div>
              <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
                <p style="margin:0 0 16px;font-size:15px">Hi ${recipientName.split(' ')[0]},</p>
                <p style="margin:0 0 16px;font-size:14px;color:#374151">
                  You've been automatically matched with <strong>${partnerName}</strong> as your doubles partner for <strong>${league.name}</strong>!
                </p>
                <p style="margin:0 0 24px;font-size:14px;color:#374151">Reach out to introduce yourselves and coordinate before the league starts.</p>
                <a href="${leagueUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View League</a>
                <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this because you registered as a solo player on Joinzer.</p>
              </div>
            </div>
          `

          if (myProfile.email) {
            resend.emails.send({
              from: 'Joinzer <support@joinzer.com>',
              to: myProfile.email,
              replyTo: 'martyfit50@gmail.com',
              subject: `Partner match confirmed — ${partnerProfile.name}`,
              html: emailHtml(myProfile.name ?? '', partnerProfile.name ?? ''),
            }).catch(() => {})
          }
          if (partnerProfile.email) {
            resend.emails.send({
              from: 'Joinzer <support@joinzer.com>',
              to: partnerProfile.email,
              replyTo: 'martyfit50@gmail.com',
              subject: `Partner match confirmed — ${myProfile.name}`,
              html: emailHtml(partnerProfile.name ?? '', myProfile.name ?? ''),
            }).catch(() => {})
          }
        }
      }
    }
  }

  // Confirmation email for the registering player (fire-and-forget)
  ;(async () => {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
      const leagueUrl = `${siteUrl}/compete/leagues/${leagueId}`

      const { data: profile } = await admin.from('profiles').select('name, email').eq('id', user.id).single()
      const toEmail = profile?.email ?? user.email
      if (!toEmail) return

      const isWaitlist = status === 'waitlist'
      const isSolo = registration_type === 'solo'
      const firstName = profile?.name?.split(' ')[0] ?? 'there'
      const partnerName = matchedWith?.name ?? null

      const fmt = (d: string | null) => d
        ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
            .format(new Date(d + 'T00:00:00'))
        : null
      const startFmt = fmt(league.start_date ?? null)
      const endFmt = fmt(league.end_date ?? null)

      const rows: EmailRow[] = [
        ['League', league.name],
        ...(league.location_name ? [['Location', league.location_name] as EmailRow] : []),
        ...(league.schedule_description ? [['Schedule', league.schedule_description] as EmailRow] : []),
        ...(startFmt && endFmt
          ? [['Dates', `${startFmt} — ${endFmt}`] as EmailRow]
          : startFmt ? [['Starts', startFmt] as EmailRow] : []),
        ...(FORMAT_LABELS[league.format] ? [['Format', FORMAT_LABELS[league.format]] as EmailRow] : []),
        ...(SKILL_LABELS[league.skill_level] ? [['Skill level', SKILL_LABELS[league.skill_level]] as EmailRow] : []),
        ['Status', isWaitlist ? "Waitlisted — you'll be notified if a spot opens" : 'Registered'],
        ['Fee', 'Free'],
        ...(isSolo && partnerName
          ? [['Partner', partnerName] as EmailRow]
          : isSolo && !partnerName
            ? [['Type', 'Solo — awaiting a partner match'] as EmailRow]
            : []),
      ]

      let attachments: { filename: string; content: Buffer }[] = []
      if (!isWaitlist) {
        const { data: sessions } = await admin
          .from('league_sessions')
          .select('id, session_date, session_number')
          .eq('league_id', leagueId)
          .order('session_number', { ascending: true })
        if (sessions && sessions.length > 0) {
          const ics = generateIcs(sessions.map(s => ({
            uid: s.id,
            title: `${league.name} — Session ${s.session_number}`,
            startDate: s.session_date,
            ...(league.location_name ? { location: league.location_name } : {}),
            url: leagueUrl,
          })))
          attachments = [{ filename: 'joinzer-league.ics', content: Buffer.from(ics) }]
        }
      }

      await resend.emails.send({
        from: 'Joinzer <support@joinzer.com>',
        to: toEmail,
        replyTo: 'martyfit50@gmail.com',
        subject: isWaitlist ? `Waitlist confirmed: ${league.name}` : `Registered: ${league.name}`,
        html: registrationEmail({
          heading: isWaitlist ? "You're on the waitlist!" : "You're registered!",
          firstName,
          rows,
          ctaLabel: 'View League',
          ctaUrl: leagueUrl,
          footerNote: "You're receiving this because you registered for a league on Joinzer.",
        }),
        ...(attachments.length > 0 ? { attachments } : {}),
      })
    } catch (err) {
      console.error('League confirmation email error:', err)
    }
  })()

  return NextResponse.json({ ok: true, status, matchedWith })
}

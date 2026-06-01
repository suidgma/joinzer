import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { createStub } from '@/lib/users/stubs'
import { createNotification } from '@/lib/notifications/create'
import { getSiteUrl } from '@/lib/utils/site-url'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any

function service(): ServiceClient {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Void the captain's Stripe auth-hold and cancel their registration.
// Called by decline endpoint (immediate) and cron (72h timeout).
export async function voidCaptainHold(
  invitationId: string,
  reason: 'declined' | 'expired'
): Promise<void> {
  const db = service()

  const { data: inv } = await db
    .from('league_partner_invitations')
    .update({ status: reason })
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select('captain_registration_id, league_id, invitee_email')
    .single()

  // Already resolved (declined, expired, or accepted) — idempotent exit
  if (!inv) return

  const { data: reg } = await db
    .from('league_registrations')
    .select('stripe_payment_intent_id, user_id')
    .eq('id', inv.captain_registration_id)
    .single()

  if (reg?.stripe_payment_intent_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      await stripe.paymentIntents.cancel(reg.stripe_payment_intent_id)
    } catch (err) {
      console.error('[voidCaptainHold] stripe cancel failed:', err)
    }
  }

  await db
    .from('league_registrations')
    .update({ status: 'cancelled', payment_status: 'free', stripe_payment_intent_id: null })
    .eq('id', inv.captain_registration_id)

  // Email the captain
  if (reg?.user_id) {
    const [{ data: profile }, { data: league }] = await Promise.all([
      db.from('profiles').select('name, email').eq('id', reg.user_id).single(),
      db.from('leagues').select('name, id').eq('id', inv.league_id).single(),
    ])

    if (profile?.email && league) {
      const siteUrl = getSiteUrl()
      const resend = new Resend(process.env.RESEND_API_KEY)
      const isDeclined = reason === 'declined'

      const rows: EmailRow[] = [
        ['League', league.name],
        ['Partner invite sent to', inv.invitee_email],
        ['Outcome', isDeclined ? 'Partner declined the invitation' : 'Invitation expired after 72 hours'],
      ]

      resend.emails.send({
        from: 'Joinzer <support@joinzer.com>',
        to: profile.email,
        replyTo: 'martyfit50@gmail.com',
        subject: isDeclined
          ? `Partner invitation declined — ${league.name}`
          : `Partner invitation expired — ${league.name}`,
        html: registrationEmail({
          heading: isDeclined ? 'Your partner declined' : 'Partner invitation expired',
          firstName: profile.name?.split(' ')[0] ?? 'there',
          intro: isDeclined
            ? `${inv.invitee_email} declined your partner invitation for ${league.name}. Your registration has been cancelled and your payment was not charged.`
            : `Your partner invitation to ${inv.invitee_email} for ${league.name} expired after 72 hours. Your registration has been cancelled and your payment was not charged.`,
          rows,
          ctaLabel: 'Register again',
          ctaUrl: `${siteUrl}/leagues/${league.id}`,
          footerNote: 'You can register again at any time while registration is open.',
        }),
      }).catch((err: unknown) => console.error('[voidCaptainHold] captain email failed:', err))
    }
  }
}

// Create an invitation + stub + send invite email for a partner.
// Idempotent: reuses an existing pending invitation if one exists for this captain registration.
export async function createInviteAndNotify(
  db: ServiceClient,
  captainRegId: string,
  leagueId: string,
  partnerEmail: string,
  siteUrl: string
): Promise<void> {
  // Check for existing invitation (idempotency)
  const { data: existing } = await db
    .from('league_partner_invitations')
    .select('id, token, invitation_email_sent_at')
    .eq('captain_registration_id', captainRegId)
    .eq('status', 'pending')
    .maybeSingle()

  let invitationId: string
  let token: string
  let emailAlreadySent: boolean

  if (existing) {
    invitationId = existing.id
    token = existing.token
    emailAlreadySent = !!existing.invitation_email_sent_at
  } else {
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    const { data: created, error } = await db
      .from('league_partner_invitations')
      .insert({
        league_id: leagueId,
        captain_registration_id: captainRegId,
        invitee_email: partnerEmail,
        expires_at: expiresAt,
      })
      .select('id, token')
      .single()

    if (error || !created) throw new Error(error?.message ?? 'Failed to create invitation')
    invitationId = created.id
    token = created.token
    emailAlreadySent = false
  }

  // Create stub user if needed and record invitee_user_id
  const { userId } = await createStub(db, partnerEmail, new Map())
  await db
    .from('league_partner_invitations')
    .update({ invitee_user_id: userId })
    .eq('id', invitationId)

  if (emailAlreadySent) return

  // In-app notification for the invitee with a direct deep link to the accept
  // page. This is the resilient path: the emailed magic link can drop its `next`
  // redirect (Supabase allowlist / flow quirks), leaving the invitee stranded on
  // /home. The bell notification + the league page's pendingInvite surface both
  // give them a way to find and accept the invite from inside the app.
  {
    const { data: invLeague } = await db
      .from('leagues')
      .select('name')
      .eq('id', leagueId)
      .single()
    await createNotification({
      recipientId: userId,
      surface: 'league',
      surfaceId: leagueId,
      kind: 'league_partner_invite',
      title: 'You have a partner invitation',
      body: `Accept to join ${invLeague?.name ?? 'the league'} as a team.`,
      url: `/leagues/${leagueId}/partner-accept?token=${token}`,
    })
  }

  const shouldSend = process.env.NODE_ENV === 'production'
  if (!shouldSend) {
    console.log(`[partner-invite] skipped (NODE_ENV=${process.env.NODE_ENV}) — would send to ${partnerEmail}`)
    await db
      .from('league_partner_invitations')
      .update({ invitation_email_sent_at: new Date().toISOString() })
      .eq('id', invitationId)
    return
  }

  const [{ data: league }, { data: captainReg }] = await Promise.all([
    db.from('leagues').select('name').eq('id', leagueId).single(),
    db.from('league_registrations').select('user_id').eq('id', captainRegId).single(),
  ])

  let captainName = 'Your partner'
  if (captainReg?.user_id) {
    const { data: captainProfile } = await db.from('profiles').select('name').eq('id', captainReg.user_id).single()
    captainName = captainProfile?.name ?? captainName
  }

  const acceptUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent(`/leagues/${leagueId}/partner-accept?token=${token}`)}`

  const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email: partnerEmail,
    options: { redirectTo: acceptUrl },
  })
  // Fallback to the accept page itself (not bare /login) so the token survives:
  // an unauthenticated visit bounces through middleware → /login?next=<accept>,
  // and every auth method now carries `next` back to the invite.
  const acceptPageUrl = `${siteUrl}/leagues/${leagueId}/partner-accept?token=${token}`
  if (linkErr || !linkData?.properties?.action_link) {
    console.error('[partner-invite] generateLink failed; emailing accept-page fallback URL:', linkErr)
  }
  const claimUrl = linkData?.properties?.action_link ?? acceptPageUrl

  const localPart = partnerEmail.split('@')[0].replace(/[^a-zA-Z]/g, '')
  const firstName = localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : 'there'

  const rows: EmailRow[] = [
    ['League', league?.name ?? leagueId],
    ['Invited by', captainName],
  ]

  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: partnerEmail,
    replyTo: 'martyfit50@gmail.com',
    subject: `${captainName} invited you as their partner — ${league?.name ?? 'League on Joinzer'}`,
    html: registrationEmail({
      heading: "You've been invited as a doubles partner",
      firstName,
      intro: `${captainName} wants you as their partner for ${league?.name ?? 'a league on Joinzer'}. This invitation expires in 72 hours.`,
      rows,
      ctaLabel: 'Accept invitation',
      ctaUrl: claimUrl,
      footerNote: "Not interested? You can decline the invitation using the link in this email. You won't be charged unless you accept.",
    }),
  })

  await db
    .from('league_partner_invitations')
    .update({ invitation_email_sent_at: new Date().toISOString() })
    .eq('id', invitationId)
}

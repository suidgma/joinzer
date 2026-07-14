import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatEventDate, formatEventTime, formatDuration, formatTimestamp } from '@/lib/utils/date'
import JoinLeaveButton from '@/components/features/events/JoinLeaveButton'
import AssignCaptainButton from '@/components/features/events/AssignCaptainButton'
import InvitePlayers from '@/components/features/events/InvitePlayers'
import AddSubForMe from '@/components/features/subs/AddSubForMe'
import UndoSubButton from '@/components/features/subs/UndoSubButton'
import ChatPanel from '@/components/features/ChatPanel'
import SessionRatingForm from '@/components/features/events/SessionRatingForm'
import type { EventDetail } from '@/lib/types'
import ShareButton from '@/components/features/ShareButton'
import PaymentTracker from '@/components/features/events/PaymentTracker'
import RefundPolicyNote from '@/components/features/RefundPolicyNote'
import EarlyBirdNote from '@/components/features/EarlyBirdNote'
import { resolvePriceCents } from '@/lib/payments/priceTiers'
import { getSiteUrl } from '@/lib/utils/site-url'

type ChatMessage = {
  id: string
  user_id: string
  message_text: string
  created_at: string
  profile: { name: string } | null
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data } = await supabase
    .from('events')
    .select('title, starts_at, location:locations!location_id(name)')
    .eq('id', params.id)
    .single()

  if (!data) return {}

  const loc = (data.location as unknown as { name: string } | null)?.name
  const date = data.starts_at
    ? new Date(data.starts_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })
    : null
  const description = [date, loc].filter(Boolean).join(' · ')

  return {
    title: data.title,
    openGraph: {
      title: data.title,
      description,
      siteName: 'Joinzer',
    },
    twitter: {
      card: 'summary',
      title: data.title,
      description,
    },
  }
}

export default async function EventDetailPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const supabase = createClient()

  const [{ data }, { data: authData }, { data: messagesData }, { data: existingRatings }] =
    await Promise.all([
      supabase
        .from('events')
        .select(`
          id, title, starts_at, duration_minutes, court_count, players_per_court,
          max_players, status, notes, registration_closes_at, skill_min, skill_max, creator_user_id, captain_user_id, location_id,
          session_type, price_cents, price_tiers, no_refund_date, refund_policy,
          location:locations!location_id (name, court_count, subarea, access_type),
          captain:profiles!captain_user_id (name),
          event_participants!event_id (
            id, user_id, participant_status, payment_status, joined_at,
            profile:profiles!user_id (name)
          )
        `)
        .eq('id', params.id)
        .single(),
      supabase.auth.getUser(),
      supabase
        .from('event_messages')
        .select(`
          id, user_id, message_text, created_at,
          profile:profiles!user_id (name)
        `)
        .eq('event_id', params.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('session_ratings')
        .select('id')
        .eq('event_id', params.id)
        .limit(1),
    ])

  if (!data) notFound()

  const event = data as unknown as EventDetail
  const currentUserId = authData.user?.id
  const initialMessages = (messagesData ?? []) as unknown as ChatMessage[]

  const joinedParticipants = event.event_participants.filter(
    (p) => p.participant_status === 'joined'
  )
  const waitlistParticipants = event.event_participants.filter(
    (p) => p.participant_status === 'waitlist'
  )
  const myParticipation = event.event_participants.find(
    (p) => p.user_id === currentUserId && p.participant_status !== 'left'
  )
  // Already in the session (joined or waitlist) — excluded from the invite picker.
  const participantUserIds = event.event_participants
    .filter((p) => p.participant_status !== 'left')
    .map((p) => p.user_id)

  const isCaptain = currentUserId === event.captain_user_id
  const isJoined = myParticipation?.participant_status === 'joined'
  const isActive = event.status !== 'cancelled' && event.status !== 'completed'

  const sessionEndedAt = new Date(event.starts_at).getTime() + event.duration_minutes * 60_000
  const sessionHasEnded = Date.now() > sessionEndedAt
  const alreadyRated = (existingRatings ?? []).length > 0
  const showRatingForm = isCaptain && sessionHasEnded

  const rateablePlayers = joinedParticipants
    .filter((p) => p.user_id !== currentUserId)
    .map((p) => ({ userId: p.user_id, name: p.profile?.name ?? 'Unknown' }))

  const sessionHasStarted = Date.now() >= new Date(event.starts_at).getTime()

  // "Add a sub for me" is available to a joined, non-captain player before the session
  // starts. Load the pickable Joinzer users (everyone not already in the session).
  const canAddSub = isActive && isJoined && !isCaptain && !sessionHasStarted
  let subCandidates: { id: string; name: string }[] = []
  if (canAddSub) {
    const { data: profs } = await supabase.from('profiles').select('id, name').order('name').limit(1000)
    const inSession = new Set(participantUserIds)
    subCandidates = ((profs ?? []) as { id: string; name: string }[])
      .filter((p) => p.id !== currentUserId && !inSession.has(p.id))
  }

  // If the current user subbed themselves out (and the swap is still intact before
  // start), offer a one-tap undo to take their spot back. sub_nominations is deny-all
  // → read via the service role.
  let myUndoableSub: { id: string; nomineeName: string } | null = null
  if (currentUserId && isActive && !sessionHasStarted && !isJoined) {
    const adminDb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: rows } = await adminDb
      .from('sub_nominations')
      .select('id, nominated_user_id')
      .eq('surface', 'play')
      .eq('event_id', event.id)
      .eq('requesting_user_id', currentUserId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1)
    const row = rows?.[0]
    if (row && joinedParticipants.some((p) => p.user_id === row.nominated_user_id)) {
      const { data: prof } = await adminDb.from('profiles').select('name').eq('id', row.nominated_user_id).maybeSingle()
      myUndoableSub = { id: row.id, nomineeName: prof?.name ?? 'Your sub' }
    }
  }

  const statusColors: Record<string, string> = {
    open: 'bg-brand-soft text-brand-active',
    full: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
    completed: 'bg-gray-100 text-gray-500',
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/play" className="text-sm text-brand-muted hover:text-brand-dark">
          ← Back
        </Link>
        <div className="flex items-center gap-3">
          <ShareButton
            title={event.title}
            url={`${getSiteUrl()}/play/${event.id}`}
          />
          {isCaptain && (
            <>
              {isActive && (
                <Link href={`/play/${event.id}/edit`} className="text-sm text-brand-active font-medium underline underline-offset-2">
                  Edit
                </Link>
              )}
              <Link href={`/play/create?from=${event.id}`} className="text-sm text-brand-muted hover:text-brand-dark font-medium underline underline-offset-2">
                Duplicate
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-heading text-xl font-bold text-brand-dark leading-tight">{event.title}</h1>
          <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${statusColors[event.status] ?? 'bg-gray-100 text-gray-500'}`}>
            {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
          </span>
        </div>

        {event.location && (
          <p className="text-sm text-brand-muted">
            {event.location.name} · {event.court_count} {event.court_count === 1 ? 'court' : 'courts'}
            {event.location.subarea && ` · ${event.location.subarea}`}
          </p>
        )}

        <p className="text-sm text-brand-muted">{formatEventDate(event.starts_at)}</p>
        <p className="text-sm text-brand-muted">
          {formatEventTime(event.starts_at)} · {formatDuration(event.duration_minutes)}
        </p>
        {(event.skill_min != null || event.skill_max != null) && (
          <p className="text-sm text-brand-muted">
            Skill:{' '}
            {event.skill_min != null && event.skill_max != null
              ? `${event.skill_min.toFixed(1)} – ${event.skill_max.toFixed(1)}`
              : event.skill_min != null
              ? `${event.skill_min.toFixed(1)} and up`
              : `Up to ${event.skill_max!.toFixed(1)}`}
          </p>
        )}

        {event.registration_closes_at && (
          <p className="text-sm text-brand-muted">
            Reg. closes {formatTimestamp(event.registration_closes_at)} PT
          </p>
        )}

        {(event as any).session_type === 'free_clinic' && (
          <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">FREE CLINIC</span>
        )}
        {(event as any).session_type === 'paid_clinic' && (event as any).price_cents && (
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              ${(resolvePriceCents((event as any).price_cents ?? 0, (event as any).price_tiers, new Date()) / 100).toFixed(0)}/person
            </span>
            <span className="text-xs text-brand-muted">Fee required · pay your captain directly</span>
          </div>
        )}

        <div className="pt-2 border-t border-brand-border flex items-center justify-between text-sm">
          <span className="text-brand-muted">Captain: <span className="text-brand-dark font-medium">{event.captain?.name ?? 'Unknown'}</span></span>
          <span className="font-semibold text-brand-dark">
            {joinedParticipants.length} / {event.max_players} players
            {waitlistParticipants.length > 0 && (
              <span className="text-brand-muted font-normal ml-1">· {waitlistParticipants.length} waitlist</span>
            )}
          </span>
        </div>
      </div>

      <EarlyBirdNote baseCents={(event as any).price_cents ?? 0} tiers={(event as any).price_tiers} />
      <RefundPolicyNote policy={(event as any).refund_policy} noRefundDate={(event as any).no_refund_date} />

      {/* Join / Leave */}
      {isActive && currentUserId && (
        <JoinLeaveButton
          eventId={event.id}
          currentStatus={myParticipation?.participant_status ?? null}
          isCaptain={isCaptain}
          calendarTitle={event.title}
          calendarStart={event.starts_at}
          calendarEnd={new Date(new Date(event.starts_at).getTime() + event.duration_minutes * 60_000).toISOString()}
          calendarLocation={(event.location as any)?.name}
        />
      )}

      {/* Player: undo a sub I added (take my spot back) */}
      {myUndoableSub && (
        <UndoSubButton nominationId={myUndoableSub.id} nomineeName={myUndoableSub.nomineeName} />
      )}

      {/* Player: pick my own sub (before the session starts, takes effect immediately) */}
      {canAddSub && (
        <AddSubForMe
          surface="play"
          scope={{ eventId: event.id }}
          candidates={subCandidates}
          caption="Your sub takes your spot right away — no approval needed."
        />
      )}

      {/* Captain: invite players */}
      {isCaptain && isActive && currentUserId && (
        <InvitePlayers eventId={event.id} existingUserIds={participantUserIds} />
      )}

      {/* Captain: reassign */}
      {isCaptain && isActive && currentUserId && (
        <AssignCaptainButton
          eventId={event.id}
          joinedParticipants={joinedParticipants}
          currentUserId={currentUserId}
        />
      )}

      {/* Notes */}
      {event.notes && (
        <div className="bg-brand-soft border border-brand-border rounded-xl p-3 text-sm text-brand-muted whitespace-pre-wrap">
          {event.notes}
        </div>
      )}

      {/* Players list with payment tracking for paid sessions */}
      {joinedParticipants.length > 0 && (
        <PaymentTracker
          eventId={event.id}
          participants={joinedParticipants as unknown as Parameters<typeof PaymentTracker>[0]['participants']}
          captainUserId={event.captain_user_id}
          isCaptain={isCaptain}
          priceCents={(event as any).price_cents ?? 0}
        />
      )}

      {/* Waitlist */}
      {waitlistParticipants.length > 0 && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
          <h2 className="font-heading text-sm font-semibold text-brand-dark">
            Waitlist ({waitlistParticipants.length})
          </h2>
          <ul className="space-y-1.5">
            {waitlistParticipants.map((p, idx) => (
              <li key={p.id} className="text-sm text-brand-muted">
                #{idx + 1} {p.profile?.name ?? 'Unknown'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Captain rating form — shown after session ends */}
      {showRatingForm && rateablePlayers.length > 0 && (
        <SessionRatingForm
          eventId={event.id}
          players={rateablePlayers}
          alreadyRated={alreadyRated}
        />
      )}

      {/* Realtime chat */}
      {currentUserId && (
        <ChatPanel
          table="event_messages"
          entityField="event_id"
          entityId={event.id}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          canChat={isJoined}
          joinHint="Join the session to chat"
        />
      )}
    </main>
  )
}

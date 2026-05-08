import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatEventDate, formatEventTime, formatDuration } from '@/lib/utils/date'
import JoinLeaveButton from '@/components/features/events/JoinLeaveButton'
import AssignCaptainButton from '@/components/features/events/AssignCaptainButton'
import EventChat from '@/components/features/events/EventChat'
import SessionRatingForm from '@/components/features/events/SessionRatingForm'
import type { EventDetail } from '@/lib/types'
import ShareButton from '@/components/features/ShareButton'
import PaymentTracker from '@/components/features/events/PaymentTracker'

type ChatMessage = {
  id: string
  user_id: string
  message_text: string
  created_at: string
  profile: { name: string } | null
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data } = await supabase
    .from('events')
    .select('title, starts_at, location:locations!location_id(name)')
    .eq('id', params.id)
    .single()

  if (!data) return {}

  const loc = (data.location as { name: string } | null)?.name
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

export default async function EventDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  const [{ data }, { data: authData }, { data: messagesData }, { data: existingRatings }] =
    await Promise.all([
      supabase
        .from('events')
        .select(`
          id, title, starts_at, duration_minutes, court_count, players_per_court,
          max_players, status, notes, min_skill_level, max_skill_level, creator_user_id, captain_user_id, location_id,
          session_type, price_cents,
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

  const statusColors: Record<string, string> = {
    open: 'bg-brand-soft text-brand-active',
    full: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
    completed: 'bg-gray-100 text-gray-500',
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/events" className="text-sm text-brand-muted hover:text-brand-dark">
          ← Back
        </Link>
        <div className="flex items-center gap-3">
          <ShareButton
            title={event.title}
            url={`${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'}/events/${event.id}`}
          />
          {isCaptain && (
            <>
              {isActive && (
                <Link href={`/events/${event.id}/edit`} className="text-sm text-brand-active font-medium underline underline-offset-2">
                  Edit
                </Link>
              )}
              <Link href={`/events/create?from=${event.id}`} className="text-sm text-brand-muted hover:text-brand-dark font-medium underline underline-offset-2">
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
        {(event.min_skill_level != null || event.max_skill_level != null) && (
          <p className="text-sm text-brand-muted">
            Skill:{' '}
            {event.min_skill_level != null ? event.min_skill_level.toFixed(1) : '2.0'}
            {' – '}
            {event.max_skill_level != null ? event.max_skill_level.toFixed(1) : '& up'}
          </p>
        )}

        {(event as any).session_type === 'free_clinic' && (
          <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">FREE CLINIC</span>
        )}
        {(event as any).session_type === 'paid_clinic' && (event as any).price_cents && (
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              ${((event as any).price_cents / 100).toFixed(0)}/person
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

      {/* Join / Leave */}
      {isActive && currentUserId && (
        <JoinLeaveButton
          eventId={event.id}
          currentStatus={myParticipation?.participant_status ?? null}
          isCaptain={isCaptain}
        />
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
        <EventChat
          eventId={event.id}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
          isJoined={isJoined}
        />
      )}
    </main>
  )
}

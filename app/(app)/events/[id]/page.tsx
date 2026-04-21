import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatEventDate, formatEventTime } from '@/lib/utils/date'
import JoinLeaveButton from '@/components/features/events/JoinLeaveButton'
import AssignCaptainButton from '@/components/features/events/AssignCaptainButton'
import EventChat from '@/components/features/events/EventChat'
import type { EventDetail } from '@/lib/types'

type ChatMessage = {
  id: string
  user_id: string
  message_text: string
  created_at: string
  profile: { name: string } | null
}

export default async function EventDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  const [{ data }, { data: authData }, { data: messagesData }] =
    await Promise.all([
      supabase
        .from('events')
        .select(`
          id, title, starts_at, duration_minutes, court_count, players_per_court,
          max_players, status, notes, creator_user_id, captain_user_id, location_id,
          location:locations!location_id (name, court_count, subarea, access_type),
          captain:profiles!captain_user_id (name),
          event_participants!event_id (
            id, user_id, participant_status, joined_at,
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

  const statusColors: Record<string, string> = {
    open: 'bg-green-100 text-green-700',
    full: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
    completed: 'bg-gray-100 text-gray-500',
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-5">
      <Link href="/events" className="text-sm text-gray-500 hover:text-black">
        ← Back to sessions
      </Link>

      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold leading-tight">{event.title}</h1>
          <span
            className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
              statusColors[event.status] ?? 'bg-gray-100 text-gray-500'
            }`}
          >
            {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
          </span>
        </div>

        {event.location && (
          <p className="text-gray-600">
            {event.location.name} · {event.location.court_count} courts
            {event.location.subarea && ` · ${event.location.subarea}`}
          </p>
        )}

        <p className="text-gray-600">{formatEventDate(event.starts_at)}</p>
        <p className="text-sm text-gray-500">
          {formatEventTime(event.starts_at)} · {event.duration_minutes} min
        </p>
      </div>

      {/* Captain */}
      <div className="text-sm">
        <span className="text-gray-500">Captain: </span>
        <span className="font-medium">{event.captain?.name ?? 'Unknown'}</span>
      </div>

      {/* Capacity */}
      <div className="text-sm">
        <span className="font-semibold">
          {joinedParticipants.length} / {event.max_players} players joined
        </span>
        {waitlistParticipants.length > 0 && (
          <span className="text-gray-500 ml-2">
            · {waitlistParticipants.length} on waitlist
          </span>
        )}
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
        <div className="border rounded-lg p-3 text-sm text-gray-700 bg-gray-50 whitespace-pre-wrap">
          {event.notes}
        </div>
      )}

      {/* Players list */}
      {joinedParticipants.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">
            Players ({joinedParticipants.length})
          </h2>
          <ul className="space-y-1">
            {joinedParticipants.map((p) => (
              <li key={p.id} className="text-sm flex items-center gap-2">
                <span>{p.profile?.name ?? 'Unknown'}</span>
                {p.user_id === event.captain_user_id && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    Captain
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Waitlist */}
      {waitlistParticipants.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">
            Waitlist ({waitlistParticipants.length})
          </h2>
          <ul className="space-y-1">
            {waitlistParticipants.map((p, idx) => (
              <li key={p.id} className="text-sm text-gray-500">
                #{idx + 1} {p.profile?.name ?? 'Unknown'}
              </li>
            ))}
          </ul>
        </div>
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

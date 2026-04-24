import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Score adjustments per rating
const SCORE_DELTA: Record<number, number> = {
  [-1]: -8,  // below my level
  [0]:   2,  // about the same
  [1]:  12,  // above my level
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { eventId, ratings } = await request.json() as {
    eventId: string
    ratings: { userId: string; score: number }[]
  }

  if (!eventId || !Array.isArray(ratings) || ratings.length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Verify caller is the captain of this event
  const { data: event } = await supabase
    .from('events')
    .select('captain_user_id, starts_at, duration_minutes')
    .eq('id', eventId)
    .single()

  if (!event || event.captain_user_id !== user.id) {
    return NextResponse.json({ error: 'Only the captain can rate players' }, { status: 403 })
  }

  // Verify session has ended
  const endsAt = new Date(event.starts_at).getTime() + event.duration_minutes * 60_000
  if (Date.now() < endsAt) {
    return NextResponse.json({ error: 'Session has not ended yet' }, { status: 400 })
  }

  // Check captain hasn't already rated this session
  const { data: existing } = await supabase
    .from('session_ratings')
    .select('id')
    .eq('event_id', eventId)
    .eq('rater_id', user.id)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Already rated this session' }, { status: 409 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Insert all ratings
  const { error: insertError } = await service.from('session_ratings').insert(
    ratings.map((r) => ({
      event_id: eventId,
      rater_id: user.id,
      rated_user_id: r.userId,
      score: r.score,
    }))
  )

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Apply score deltas — fetch current ratings then update each
  const userIds = ratings.map((r) => r.userId)
  const { data: profiles } = await service
    .from('profiles')
    .select('id, joinzer_rating')
    .in('id', userIds)

  if (profiles) {
    for (const profile of profiles) {
      const rating = ratings.find((r) => r.userId === profile.id)
      if (!rating) continue
      const delta = SCORE_DELTA[rating.score] ?? 0
      const newRating = Math.max(0, (profile.joinzer_rating ?? 1000) + delta)
      await service.from('profiles').update({ joinzer_rating: newRating }).eq('id', profile.id)
    }
  }

  return NextResponse.json({ ok: true })
}

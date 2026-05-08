import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

const VALID_STATUSES = ['unpaid', 'paid', 'waived'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { payment_status } = body
  if (!VALID_STATUSES.includes(payment_status)) {
    return NextResponse.json({ error: 'Invalid payment_status' }, { status: 400 })
  }

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Only the captain of the event can update payment status
  const { data: event } = await admin
    .from('events')
    .select('captain_user_id')
    .eq('id', params.id)
    .single()

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (event.captain_user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin
    .from('event_participants')
    .update({ payment_status })
    .eq('event_id', params.id)
    .eq('user_id', params.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

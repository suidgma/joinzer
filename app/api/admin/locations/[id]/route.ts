import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { isPlatformAdmin } from '@/lib/auth/admin'

// POST /api/admin/locations/[id] — approve or reject a user-added (pending) venue.
// Platform-admin only. Approve → status 'approved' (selectable for everyone).
// Reject → is_active false (dropped from every picker and the queue; not deleted,
// so any event already pointing at it still resolves). Both are guarded on the
// row still being pending, so an approved/curated venue can't be touched here.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const patch = action === 'approve' ? { status: 'approved' } : { is_active: false }

  const { error } = await db.from('locations').update(patch).eq('id', id).eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

// PATCH /api/admin/locations/[id] — set (or clear) the venue's manual map-pin
// short code. Empty/blank clears it, so the map falls back to the auto code.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const raw = typeof body.short_code === 'string' ? body.short_code.trim().slice(0, 12) : ''
  const short_code = raw || null

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { error } = await db.from('locations').update({ short_code }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, short_code })
}

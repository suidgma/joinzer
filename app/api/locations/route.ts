import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Trim + cap a client-supplied string; empty → null.
function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

// POST /api/locations — add a venue that isn't in the directory yet.
// Any authenticated user creating a league / tournament / play session may add
// one; it becomes a normal active location (crowd-sourced). Operational fields
// (metro_area, court_count, is_active, sort_order) use table defaults; access_type
// is server-set to a safe value. locations has no client INSERT policy, so this
// service-role route is the write path (and the auth boundary).
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw = clip(body.name, 200)
  if (!raw) return NextResponse.json({ error: 'Location name is required' }, { status: 400 })
  const name = raw.replace(/\s+/g, ' ') // collapse internal whitespace

  const db = admin()
  const cols = 'id, name, court_count, access_type, subarea, address, city, state, zip_code, country'

  // Dedup: reuse an existing venue with the same name (case-insensitive) rather
  // than creating a twin. Escape LIKE metacharacters so ilike is an exact match.
  const escaped = name.replace(/[\\%_]/g, (c) => `\\${c}`)
  const { data: existing } = await db.from('locations').select(cols).ilike('name', escaped).limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ location: existing[0], reused: true }, { status: 200 })
  }

  const row = {
    name,
    address: clip(body.address, 300),
    city: clip(body.city, 120),
    state: clip(body.state, 60),
    zip_code: clip(body.zip_code, 20),
    country: clip(body.country, 60) ?? 'US',
    access_type: 'public', // constrained enum; user venues default to public
    created_by: user.id,
    status: 'pending', // hidden from other users' pickers until approved
  }

  const { data, error } = await db.from('locations').insert(row).select(cols).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ location: data }, { status: 201 })
}

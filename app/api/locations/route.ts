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
  const name = clip(body.name, 200)
  if (!name) return NextResponse.json({ error: 'Location name is required' }, { status: 400 })

  const row = {
    name,
    address: clip(body.address, 300),
    city: clip(body.city, 120),
    state: clip(body.state, 60),
    zip_code: clip(body.zip_code, 20),
    country: clip(body.country, 60) ?? 'US',
    access_type: 'public', // constrained enum; user venues default to public
  }

  const { data, error } = await admin()
    .from('locations')
    .insert(row)
    .select('id, name, court_count, access_type, subarea, address, city, state, zip_code, country')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ location: data }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'

export const dynamic = 'force-dynamic'

const service = () => createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Shared validation for create/update. Returns an error string, or null if valid.
function validateBlock(b: Record<string, unknown>): string | null {
  if (typeof b.name !== 'string' || b.name.trim() === '') return 'Block name is required'
  if (typeof b.block_date !== 'string' || b.block_date === '') return 'Block date is required'
  if (typeof b.start_time !== 'string' || typeof b.end_time !== 'string') return 'Start and end time are required'
  if (b.end_time <= b.start_time) return 'End time must be after start time'
  if (!Array.isArray(b.court_numbers) || b.court_numbers.some(c => typeof c !== 'number')) {
    return 'court_numbers must be an array of numbers'
  }
  return null
}

// GET /api/tournaments/[id]/schedule-blocks — list blocks for a tournament
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await service()
    .from('tournament_schedule_blocks')
    .select('*')
    .eq('tournament_id', id)
    .order('block_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ blocks: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

// POST /api/tournaments/[id]/schedule-blocks — create a block
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const invalid = validateBlock(body)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  const { data, error } = await service()
    .from('tournament_schedule_blocks')
    .insert({
      tournament_id: id,
      name: (body.name as string).trim(),
      block_date: body.block_date,
      start_time: body.start_time,
      end_time: body.end_time,
      location_id: body.location_id ?? null,
      court_numbers: body.court_numbers ?? [],
      notes: body.notes ?? null,
      priority: typeof body.priority === 'number' ? body.priority : 0,
      max_divisions: typeof body.max_divisions === 'number' ? body.max_divisions : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ block: data })
}

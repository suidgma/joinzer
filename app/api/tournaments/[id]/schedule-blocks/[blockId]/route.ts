import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'
import { tournamentValidDates } from '@/lib/tournament/tournamentDays'

export const dynamic = 'force-dynamic'

const service = () => createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Only these fields are editable on a block.
const EDITABLE = ['name', 'block_date', 'start_time', 'end_time', 'location_id', 'court_numbers', 'notes', 'priority', 'max_divisions'] as const

// PATCH /api/tournaments/[id]/schedule-blocks/[blockId] — update a block
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; blockId: string }> }) {
  const { id, blockId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (key in body) patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }
  if (typeof patch.name === 'string' && patch.name.trim() === '') {
    return NextResponse.json({ error: 'Block name cannot be empty' }, { status: 400 })
  }
  if (typeof patch.start_time === 'string' && typeof patch.end_time === 'string' && patch.end_time <= patch.start_time) {
    return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
  }
  if (typeof patch.block_date === 'string') {
    const validDates = await tournamentValidDates(id)
    if (validDates && !validDates.includes(patch.block_date)) {
      return NextResponse.json(
        { error: `Block date must be one of the tournament's dates (${validDates.join(', ')}).` },
        { status: 400 },
      )
    }
  }
  if (typeof patch.name === 'string') patch.name = patch.name.trim()
  patch.updated_at = new Date().toISOString()

  const { data, error } = await service()
    .from('tournament_schedule_blocks')
    .update(patch)
    .eq('id', blockId)
    .eq('tournament_id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ block: data })
}

// DELETE /api/tournaments/[id]/schedule-blocks/[blockId] — delete a block.
// Cascades remove division assignments; generated matches keep their rows with
// schedule_block_id reset to null (ON DELETE SET NULL).
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; blockId: string }> }) {
  const { id, blockId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service()
    .from('tournament_schedule_blocks')
    .delete()
    .eq('id', blockId)
    .eq('tournament_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

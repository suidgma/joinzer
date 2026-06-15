import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'

export const dynamic = 'force-dynamic'

const service = () => createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PUT /api/tournaments/[id]/division-blocks/[divisionId]
// Body: { block_id, priority? }. Assigns a division to a block (and optionally
// sets its scheduling priority within that block). MVP enforces one block per
// division, so any prior assignment for this division is replaced.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string; divisionId: string }> }) {
  const { id, divisionId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const blockId = body.block_id
  if (typeof blockId !== 'string' || !blockId) {
    return NextResponse.json({ error: 'block_id is required' }, { status: 400 })
  }
  const priority = Number.isFinite(Number(body.priority)) ? Math.max(0, Math.round(Number(body.priority))) : 0

  const db = service()

  // Confirm the block belongs to this tournament before linking to it.
  const { data: block } = await db
    .from('tournament_schedule_blocks')
    .select('id')
    .eq('id', blockId)
    .eq('tournament_id', id)
    .single()
  if (!block) return NextResponse.json({ error: 'Block not found' }, { status: 404 })

  // Replace any existing assignment for this division (single-block MVP).
  await db.from('tournament_division_blocks').delete().eq('tournament_id', id).eq('division_id', divisionId)

  const { data, error } = await db
    .from('tournament_division_blocks')
    .insert({ tournament_id: id, division_id: divisionId, block_id: blockId, priority })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assignment: data })
}

// DELETE /api/tournaments/[id]/division-blocks/[divisionId] — unassign a division.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; divisionId: string }> }) {
  const { id, divisionId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service()
    .from('tournament_division_blocks')
    .delete()
    .eq('tournament_id', id)
    .eq('division_id', divisionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

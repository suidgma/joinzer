import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify organizer owns this tournament
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Block deletion if active registrations exist
  const { count: regCount } = await service
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', params.divisionId)
    .neq('status', 'cancelled')
  if (regCount && regCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete a division with active registrations. Cancel or remove all registrants first.' },
      { status: 409 }
    )
  }

  // Delete matches first (may not cascade depending on FK config)
  await service.from('tournament_matches').delete().eq('division_id', params.divisionId)

  // Delete any cancelled registrations
  await service.from('tournament_registrations').delete().eq('division_id', params.divisionId)

  const { error } = await service
    .from('tournament_divisions')
    .delete()
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings } from '@/lib/types'

export const dynamic = 'force-dynamic'

const service = () => createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Coerce an incoming partial settings object onto the known shape, clamping to
// sane bounds. Unknown keys are dropped; missing keys fall back to current/default.
function normalizeSettings(input: Record<string, unknown>, current: ScheduleSettings): ScheduleSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    match_duration_minutes: num(input.match_duration_minutes, current.match_duration_minutes, 1, 240),
    buffer_minutes: num(input.buffer_minutes, current.buffer_minutes, 0, 120),
    min_rest_minutes: num(input.min_rest_minutes, current.min_rest_minutes, 0, 240),
    conflict_policy: input.conflict_policy === 'error' ? 'error'
      : input.conflict_policy === 'warning' ? 'warning'
      : current.conflict_policy,
    keep_divisions_grouped: bool(input.keep_divisions_grouped, current.keep_divisions_grouped),
    allow_division_overlap: bool(input.allow_division_overlap, current.allow_division_overlap),
    leave_end_buffer: bool(input.leave_end_buffer, current.leave_end_buffer),
    end_buffer_minutes: num(input.end_buffer_minutes, current.end_buffer_minutes, 0, 240),
  }
}

// PATCH /api/tournaments/[id]/schedule-settings — update scheduling settings
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const db = service()

  const { data: row } = await db
    .from('tournaments')
    .select('schedule_settings_json')
    .eq('id', id)
    .single()

  const current = { ...DEFAULT_SCHEDULE_SETTINGS, ...(row?.schedule_settings_json ?? {}) } as ScheduleSettings
  const next = normalizeSettings(body, current)

  const { error } = await db
    .from('tournaments')
    .update({ schedule_settings_json: next })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: next })
}

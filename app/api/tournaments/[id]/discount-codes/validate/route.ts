import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Validate a tournament discount code so the bundle panel can show the stacked total before
// checkout. Returns only the code's type/value for a valid code (which the player would see at
// checkout anyway) — the orders route re-validates authoritatively, so this is display-only.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code: string = (body?.code ?? '').toString().trim()
  if (!code) return NextResponse.json({ valid: false, reason: 'empty' })

  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: codeRow } = await service
    .from('tournament_discount_codes')
    .select('discount_type, discount_value, max_uses, uses_count, expires_at, is_active')
    .eq('tournament_id', params.id)
    .eq('code', code.toUpperCase())
    .eq('is_active', true)
    .maybeSingle()

  if (!codeRow) return NextResponse.json({ valid: false, reason: 'not_found' })
  const nowIso = new Date().toISOString()
  if (codeRow.expires_at && codeRow.expires_at < nowIso) return NextResponse.json({ valid: false, reason: 'expired' })
  if (codeRow.max_uses != null && codeRow.uses_count >= codeRow.max_uses) return NextResponse.json({ valid: false, reason: 'exhausted' })

  return NextResponse.json({
    valid: true,
    discount_type: codeRow.discount_type,
    discount_value: codeRow.discount_value,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseCsvRows, applyCsvRows } from '@/lib/tournament/csv'
import { canManage } from '@/lib/tournament/access'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; divisionId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await canManage(params.id, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { csv, mode } = await req.json().catch(() => ({}))
  if (!csv?.trim()) return NextResponse.json({ error: 'csv required' }, { status: 400 })

  const rows = await parseCsvRows(csv, params.id, params.divisionId)

  if (mode === 'apply') {
    const created = await applyCsvRows(rows, params.id, params.divisionId)
    return NextResponse.json({ ok: true, created, rows })
  }

  // default: preview
  return NextResponse.json({ rows })
}

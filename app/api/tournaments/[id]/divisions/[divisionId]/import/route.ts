import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { parseCsvRows, commitCsvRows } from '@/lib/tournament/csv'
import { canManage } from '@/lib/tournament/access'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(params.id, user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: division }, { data: tournament }] = await Promise.all([
    service.from('tournament_divisions').select('format').eq('id', params.divisionId).eq('tournament_id', params.id).single(),
    service.from('tournaments').select('dummy').eq('id', params.id).single(),
  ])

  const format = division?.format ?? ''
  const isDummy = tournament?.dummy ?? false

  // Commit path: body contains pre-validated rows returned by a prior preview call
  if (Array.isArray(body.rows)) {
    const result = await commitCsvRows(body.rows, params.id, params.divisionId, format, isDummy)
    return NextResponse.json({ ok: true, ...result })
  }

  // Preview path: body contains raw CSV text
  if (!body.csv?.trim()) return NextResponse.json({ error: 'csv required' }, { status: 400 })
  const rows = await parseCsvRows(body.csv, params.id, params.divisionId, format)
  return NextResponse.json({ rows })
}

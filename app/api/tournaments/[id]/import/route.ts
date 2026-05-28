/**
 * Tournament-level multi-division CSV import.
 *
 *   POST /api/tournaments/[id]/import
 *
 *   Preview: { csv: string }                  → { rows, unknownColumns, headerError? }
 *   Commit:  { rows: MultiDivRow[] }          → { ok, registered, stubs, byDivision }
 *
 * Differs from the existing /divisions/[divisionId]/import in two ways:
 *   1. No division in the URL — each CSV row carries its own `division` column
 *   2. Wider column set (name, phone, skill, gender) populated into stub
 *      profiles when those emails don't yet have Joinzer accounts.
 *
 * The older per-division route is left untouched for backward compatibility.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { parseMultiDivisionCsv, commitMultiDivisionRows, type MultiDivRow } from '@/lib/tournament/csv-multi'
import { canManage } from '@/lib/tournament/access'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(params.id, user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  // ── Commit path ──────────────────────────────────────────────────────────────
  if (Array.isArray(body.rows)) {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: tournament } = await service
      .from('tournaments')
      .select('dummy')
      .eq('id', params.id)
      .single()
    const isDummy = (tournament as { dummy?: boolean } | null)?.dummy ?? false

    try {
      const result = await commitMultiDivisionRows(body.rows as MultiDivRow[], params.id, isDummy)
      return NextResponse.json({ ok: true, ...result })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ── Preview path ─────────────────────────────────────────────────────────────
  if (!body.csv?.trim()) {
    return NextResponse.json({ error: 'csv required' }, { status: 400 })
  }

  const result = await parseMultiDivisionCsv(body.csv, params.id)
  return NextResponse.json(result)
}

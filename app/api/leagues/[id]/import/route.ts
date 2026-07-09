import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { parseLeagueCsv, commitLeagueCsv, type LeagueCsvRow } from '@/lib/leagues/csvImport'

type Params = { params: Promise<{ id: string }> }
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// POST /api/leagues/[id]/import
//   body { csv }  → preview: parse + classify rows (nothing written)
//   body { rows } → commit: register everyone, stub + invite unknown emails
// Organizer or co-admin only.
export async function POST(req: NextRequest, props: Params) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by, dummy').eq('id', id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let allowed = league.created_by === user.id
  if (!allowed) {
    const { data: reg } = await db
      .from('league_registrations').select('is_co_admin')
      .eq('league_id', id).eq('user_id', user.id).maybeSingle()
    allowed = reg?.is_co_admin === true
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))

  if (Array.isArray(body.rows)) {
    try {
      const result = await commitLeagueCsv(body.rows as LeagueCsvRow[], id, league.dummy === true)
      return NextResponse.json(result)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed' }, { status: 500 })
    }
  }

  if (typeof body.csv === 'string') {
    const result = await parseLeagueCsv(body.csv, id)
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Provide csv (preview) or rows (commit)' }, { status: 400 })
}

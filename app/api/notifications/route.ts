import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? '25'), 50)
  const offset = Number(searchParams.get('offset') ?? '0')

  const [listResult, unreadResult] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, surface, surface_id, kind, title, body, url, read_at, created_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .is('read_at', null),
  ])

  if (listResult.error) return NextResponse.json({ error: listResult.error.message }, { status: 500 })

  return NextResponse.json({
    notifications: listResult.data ?? [],
    unread: unreadResult.count ?? 0,
  })
}

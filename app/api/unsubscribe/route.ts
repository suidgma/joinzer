import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get('uid')

  if (!uid) {
    return NextResponse.redirect(new URL('/unsubscribed?error=1', request.url))
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await supabase
    .from('profiles')
    .update({ notify_new_sessions: false })
    .eq('id', uid)

  if (error) {
    return NextResponse.redirect(new URL('/unsubscribed?error=1', request.url))
  }

  return NextResponse.redirect(new URL('/unsubscribed', request.url))
}

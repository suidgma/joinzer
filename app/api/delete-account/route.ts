import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('id', user.id)
    .single()

  const name = profile?.name ?? 'Unknown'
  const email = profile?.email ?? user.email ?? 'Unknown'

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })

  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: 'martyfit50@gmail.com',
    subject: `Account deleted: ${name}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1F2A1C">
        <div style="background:#ef4444;padding:20px 28px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:18px;color:#fff">Account Deleted</h1>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 12px;font-size:15px">A user has deleted their Joinzer account.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Name</td><td style="padding:6px 0;font-size:14px">${name}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Email</td><td style="padding:6px 0;font-size:14px">${email}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">User ID</td><td style="padding:6px 0;font-size:13px;color:#9ca3af">${user.id}</td></tr>
          </table>
        </div>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}

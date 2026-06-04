import { sendEmail } from '@/lib/email/send'
import { NextRequest, NextResponse } from 'next/server'

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

export async function POST(request: NextRequest) {
  const { name, email, question } = await request.json()

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 })
  }
  if (!question || typeof question !== 'string' || question.trim().length < 5) {
    return NextResponse.json({ error: 'Question is required.' }, { status: 400 })
  }

  const safeName = name ? escapeHtml(String(name).trim()) : null
  const safeEmail = escapeHtml(email.trim())
  const safeQuestion = escapeHtml(question.trim())
  const displayFrom = safeName ? `${safeName} (${safeEmail})` : safeEmail

  await sendEmail({
    to: 'support@joinzer.com',
    replyTo: email.trim(),
    subject: `Contact form: ${safeName ?? safeEmail}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">New contact form submission</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:80px">From</td><td style="padding:6px 0;font-size:14px">${displayFrom}</td></tr>
          </table>
          <p style="font-size:14px;font-weight:600;color:#012D0B;margin:0 0 8px">Question</p>
          <p style="font-size:14px;line-height:1.6;color:#1F2A1C;background:#F5F7F2;padding:16px;border-radius:8px;margin:0">${safeQuestion}</p>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af">Reply directly to this email to respond to ${safeEmail}.</p>
        </div>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}

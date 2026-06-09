import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

type SendEmailParams = {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
  attachments?: { filename: string; content: Buffer }[]
}

// Shared brand header prepended to every transactional email so logo placement
// stays consistent across all ~25 templates. Centered on the white email
// background above each template's own content. Uses the canonical www URL
// (the apex 307-redirects, which some email clients won't follow for images).
const BRAND_LOGO_HEADER = `
  <div style="text-align:center;padding:24px 0 12px;font-family:sans-serif">
    <img src="https://www.joinzer.com/logo.png" alt="Joinzer" width="56" height="56" style="display:inline-block;border:0;outline:none;text-decoration:none" />
  </div>
`

// Exported for the few routes that call resend.emails.send directly instead of
// going through sendEmail — they prepend this so branding stays consistent.
export function withBrandHeader(html: string): string {
  return `${BRAND_LOGO_HEADER}${html}`
}

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function logEmail(recipient: string, subject: string, resendId: string | null, status: 'sent' | 'failed', error: string | null) {
  try {
    await service().from('email_log').insert({ recipient_email: recipient, subject, resend_id: resendId, status, error })
  } catch {
    // never let logging failure surface to callers
  }
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const recipients = Array.isArray(params.to) ? params.to : [params.to]

  let resendId: string | null = null
  let status: 'sent' | 'failed' = 'sent'
  let errorMsg: string | null = null

  try {
    const { data, error } = await resend.emails.send({
      from: 'Joinzer <support@joinzer.com>',
      replyTo: params.replyTo ?? 'martyfit50@gmail.com',
      to: params.to,
      subject: params.subject,
      html: withBrandHeader(params.html),
      ...(params.attachments ? { attachments: params.attachments } : {}),
    })
    if (error) {
      status = 'failed'
      errorMsg = error.message
    } else {
      resendId = data?.id ?? null
    }
  } catch (err: unknown) {
    status = 'failed'
    errorMsg = err instanceof Error ? err.message : 'unknown error'
  }

  await Promise.all(recipients.map(r => logEmail(r, params.subject, resendId, status, errorMsg)))
}

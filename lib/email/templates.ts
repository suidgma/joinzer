export type EmailRow = [string, string]

export function registrationEmail({
  heading,
  firstName,
  intro,
  rows,
  ctaLabel,
  ctaUrl,
  footerNote = "You're receiving this because you registered on Joinzer.",
}: {
  heading: string
  firstName: string
  intro?: string
  rows: EmailRow[]
  ctaLabel: string
  ctaUrl: string
  footerNote?: string
}): string {
  const tableRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;width:40%">${label}</td>
        <td style="padding:6px 0;font-size:14px;font-weight:500">${value}</td>
      </tr>`
    )
    .join('')

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
      <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;font-size:20px;color:#012D0B">${heading}</h1>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="margin:0 0 20px;font-size:15px">Hi ${firstName}${intro ? `, ${intro}` : ','}</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          ${tableRows}
        </table>
        <a href="${ctaUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${ctaLabel}</a>
        <p style="margin-top:24px;font-size:12px;color:#9ca3af">${footerNote}</p>
      </div>
    </div>
  `
}

// Relative, not the `@/` alias: vitest has no path-alias config, so a runtime `@/` import
// here would make this module untestable. Next resolves both forms identically.
import { escapeHtml } from '../utils/escape-html'

// Body of the "new session posted" broadcast. Pure and dependency-free so the generated
// HTML can be asserted in a unit test without a Resend client or a database.
//
// Every value the caller passes is escaped on the way in. The route sources them from the
// events/locations rows rather than the request body, but a stored title is still something
// a user typed, so the escape is the second half of the fix, not a substitute for the first.
// The invariant to keep: nothing is interpolated into this template raw.

export type NewSessionEmailInput = {
  title: string
  locationName: string
  /** ISO timestamp, straight from `events.starts_at`. */
  startsAt: string
  durationMinutes: number
  maxPlayers: number
  eventUrl: string
  unsubscribeUrl: string
}

export function formatDuration(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60)
  const mins = durationMinutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export function buildNewSessionEmailHtml(input: NewSessionEmailInput): string {
  const startsAtDate = new Date(input.startsAt)
  const date = startsAtDate.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const time = startsAtDate.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit',
  })

  const title = escapeHtml(input.title)
  const locationName = escapeHtml(input.locationName)
  const duration = escapeHtml(formatDuration(input.durationMinutes))
  const maxPlayers = escapeHtml(String(input.maxPlayers))
  const eventUrl = escapeHtml(input.eventUrl)
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl)

  return `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">New session posted!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <h2 style="margin:0 0 16px;font-size:18px">${title}</h2>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📍 Location</td><td style="padding:6px 0;font-size:14px">${locationName}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📅 Date</td><td style="padding:6px 0;font-size:14px">${escapeHtml(date)}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🕐 Time</td><td style="padding:6px 0;font-size:14px">${escapeHtml(time)}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">⏱ Duration</td><td style="padding:6px 0;font-size:14px">${duration}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">👥 Capacity</td><td style="padding:6px 0;font-size:14px">${maxPlayers} players</td></tr>
              </table>
              <div style="margin-top:24px">
                <a href="${eventUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Session</a>
              </div>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">
                You're receiving this because you opted in to new session notifications on Joinzer.
                <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe</a>
              </p>
            </div>
          </div>
        `
}

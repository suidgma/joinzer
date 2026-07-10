// Platform-admin check. There's no admin role in the schema yet — the admin is
// Marty, hardcoded as the notification recipient across the app. Default to that
// address, but allow overriding via the ADMIN_EMAILS env (comma-separated).
// Server-only: never import into client code (it reads a non-public env var).
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'martyfit50@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export function isPlatformAdmin(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase())
}

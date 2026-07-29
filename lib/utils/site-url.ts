// www, not the apex. The apex 307-redirects to www at the Vercel edge, so a canonical URL
// built on the apex declares every page's canonical to be a URL that redirects — a
// self-inflicted SEO problem, not a cosmetic one. Verified 2026-07-29:
//   https://joinzer.com/courts      -> 307 -> https://www.joinzer.com/courts
//   https://www.joinzer.com/courts  -> 200
// robots.txt and sitemap.xml have always advertised www; metadataBase was the outlier.
// Don't "simplify" this back to the apex without changing the Vercel domain config first.
const DEFAULT_SITE_URL = 'https://www.joinzer.com'

// Canonical public URL for the app. Single source of truth for emails, Stripe redirects,
// magic links, ICS/QR links, and SEO metadata — including metadataBase, app/sitemap.ts,
// app/robots.ts and the directory JSON-LD, each of which used to carry its own hardcoded
// copy of the host.
//
// This also builds Supabase magic-link `redirectTo` URLs, which Supabase honors only when
// they match the project's Redirect URLs allowlist. Changing the host here REQUIRES the
// matching allowlist entry to exist first — see docs/partner-invite-flow.md.
//
// Set NEXT_PUBLIC_SITE_URL in the environment; falls back to production.
export function getSiteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL
  return url.replace(/\/+$/, '')
}

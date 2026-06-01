const DEFAULT_SITE_URL = 'https://joinzer.com'

// Canonical public URL for the app. Single source of truth for emails,
// Stripe redirects, magic links, ICS/QR links, and SEO metadata.
// Set NEXT_PUBLIC_SITE_URL in the environment; falls back to production.
export function getSiteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL
  return url.replace(/\/+$/, '')
}

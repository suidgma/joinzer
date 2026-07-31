// Metro slug derivation for /courts/in/[metro].
//
// Route shape is /courts/in/[metro], NOT /courts/[metro], deliberately: facility_listings.slug is
// `unique not null` with no reserved-word mechanism (the import scripts' makeUniqueSlug has no
// reserved list), so metro slugs sharing the /courts/* namespace with facility slugs would let a
// future venue named e.g. "Phoenix" be silently shadowed by the metro page. Reserving slugs
// per-metro would need a migration for every new metro, which defeats the requirement that a new
// metro go live with no code change. The `in` segment reserves exactly one implausible word.
//
// Slugs are DERIVED from the metro_area value, never hardcoded — a new metro_area appearing in
// published data produces a live page and a sitemap entry with no deploy.
//
// "No deploy" does NOT mean "no action". loadPublishedMetros() is unstable_cache'd for 6h under the
// 'directory' tag, so a publish is invisible to findMetro() — and the new metro page hard-404s —
// until that tag is busted. The publish scripts do it via POST /api/revalidate-directory; see
// scripts/lib/revalidate-directory.mjs. Skipping that step is the 2026-07-30 Greensboro-High Point
// + Little Rock outage.

/** 'Reno-Sparks' -> 'reno-sparks', 'Las Vegas' -> 'las-vegas'. */
export function metroSlug(metroArea: string): string {
  return metroArea
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type MetroSummary = {
  metro_area: string
  state: string | null
  slug: string
  count: number
}

/** Case-insensitive slug lookup. Returns null rather than throwing so the page can notFound(). */
export function findMetro(metros: MetroSummary[], slug: string): MetroSummary | null {
  const target = slug.toLowerCase()
  return metros.find((m) => m.slug === target) ?? null
}

/** "Phoenix, AZ" — state omitted when unknown. Used in headings and metadata. */
export function metroLabel(metro: Pick<MetroSummary, 'metro_area' | 'state'>): string {
  return metro.state ? `${metro.metro_area}, ${metro.state}` : metro.metro_area
}

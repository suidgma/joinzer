/**
 * Court directory slug corrections (July 30, 2026).
 *
 * A `court-verifier` name audit found venue names that were wrong in the research input — dedication
 * names compressed to a colloquial short form ("Kovalenko Gym" for the Jessie Stevenson Kovalenko
 * Memorial Gymnasium) and "Courts" suffixes invented where the venue's own controlling-entity source
 * says "Park". Renaming a venue changes its slug, and a slug is a live indexed URL, so every rename
 * of a PUBLISHED row needs a permanent redirect or the old URL 404s for crawlers and anyone holding a link.
 *
 * 308 (permanent: true), not 307: these are settled corrections, not experiments. Search engines
 * should transfer signal to the new URL and stop requesting the old one.
 *
 * Only published rows appear here. `bethune-beach-park-new-smyrna-beach-fl` was renamed in the same
 * pass but is status='draft', so it has never been reachable or indexed — a redirect for it would
 * assert a history that does not exist. NOTE THE REASON IT IS STILL DRAFT CHANGED (2026-08-05): it
 * was held by the publish gate on a low-precision coordinate, which ADR-16 no longer treats as a
 * hold. It is now held by the RELEASE FENCE (`verified_by IS NULL`, ADR-17) — i.e. by nobody having
 * released Daytona Beach since, not by any property of the row. The conclusion is unchanged, but if
 * that metro is ever re-published this row goes live and WILL need its redirect added here.
 *
 * ORDERING RULE, learned here: this config must be DEPLOYED BEFORE the database slug UPDATEs run.
 * Between the UPDATE and the deploy, the old URL is live, indexed, and 404s. Deploy first and the
 * redirect simply points at a row that has not moved yet, which resolves correctly the moment it does.
 * This inverts the usual data-before-code order and is deliberate.
 */
const COURT_SLUG_REDIRECTS = [
  ['babe-james-center-new-smyrna-beach-fl', 'alonzo-babe-james-community-center-new-smyrna-beach-fl'],
  ['disney-tennis-center-earl-brown-park-deland-fl', 'david-e-disney-tennis-center-deland-fl'],
  ['harris-saxon-park-deltona-fl', 'harris-m-saxon-community-center-park-deltona-fl'],
  ['kovalenko-gym-new-smyrna-beach-fl', 'jessie-stevenson-kovalenko-memorial-gymnasium-new-smyrna-beach-fl'],
  ['phil-hall-courts-new-smyrna-beach-fl', 'phil-hall-park-new-smyrna-beach-fl'],
  ['white-place-courts-port-orange-fl', 'white-place-park-port-orange-fl'],
  ['bryan-family-ymca-greensboro-nc', 'kathleen-price-bryan-family-ymca-greensboro-nc'],
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async redirects() {
    return COURT_SLUG_REDIRECTS.map(([from, to]) => ({
      source: `/courts/${from}`,
      destination: `/courts/${to}`,
      permanent: true,
    }))
  },
}

export { COURT_SLUG_REDIRECTS }
export default nextConfig

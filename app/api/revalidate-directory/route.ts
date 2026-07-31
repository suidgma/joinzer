export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag, revalidatePath } from 'next/cache'

// Court-directory cache invalidation — CRON_SECRET-guarded, called by the import scripts at the end
// of --stage=publish (scripts/lib/revalidate-directory.mjs).
//
// WHY THIS EXISTS: every read in lib/directory/loadFacilities.ts is unstable_cache'd for
// DIRECTORY_CACHE_SECONDS (6h) under the 'directory' tag, but the publish path is a standalone Node
// script writing straight to Postgres with the service role. Nothing in the Next.js request path
// observes that write. Between a publish and the TTL lapsing, /courts/in/[metro] renders from a
// pre-publish metro list, findMetro() returns null and the brand-new metro page hard-404s — while
// the /courts hub happily links to it. That is exactly what happened to Greensboro-High Point and
// Little Rock on 2026-07-30.
//
// WHY revalidateTag AND NOT A SHORTER TTL: the 6h TTL is load-bearing. Crawler traffic re-querying
// Postgres per request is what blew the Vercel Hobby limits and paused production on 2026-07-29.
// Tag invalidation clears the cache on the publish event instead of guessing at a window. It is also
// the only lever that works here: these entries are per-route, not global — on 2026-07-31 the same
// loadPublishedMetros() was observably serving /sitemap.xml a 5-metro snapshot and
// /courts/in/[metro] a 3-metro snapshot at the same instant. A tag clears every entry carrying it
// regardless of its key.
export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Clears every cached directory read (metros, facilities, slugs) feeding the force-dynamic metro
  // routes, the facility pages and the sitemap.
  //
  // { expire: 0 } is deliberate and load-bearing — do NOT "modernize" this to 'max'.
  //
  // Next 16 (this repo is on 16.2.6) requires a second argument; single-arg revalidateTag is
  // deprecated and fails typecheck. But the profile is NOT just a formality: the cache handler
  // (see node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js, revalidateTag)
  // maps it to `stale = now; expired = now + expire * 1000`. The suggested 'max' profile carries
  // expire: 31536000, so it marks entries STALE-but-servable for a year — the very next request
  // still gets served the pre-publish snapshot and still 404s, with a refresh only in the
  // background. expire: 0 sets `expired = now`, the hard immediate eviction this needs: the first
  // request after a publish blocks on a fresh read. Verified locally against Next 16.2.6.
  //
  // Don't swap this for updateTag() either — that throws in a Route Handler, it is
  // Server-Action-only.
  revalidateTag('directory', { expire: 0 })

  // /courts is ISR (app/courts/page.tsx, revalidate = 21600). Its HTML is derived from those reads
  // but carries its own independent clock, so the tag alone would leave the hub advertising stale
  // counts — or omitting a metro that is already live — for up to 6h after a publish.
  revalidatePath('/courts')

  return NextResponse.json({
    ok: true,
    revalidated: ['directory', '/courts'],
    at: new Date().toISOString(),
  })
}

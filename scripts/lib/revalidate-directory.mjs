/**
 * Directory cache invalidation for the import/publish scripts.
 *
 * The publish stages write straight to Postgres with the service role. Nothing in the Next.js
 * request path observes that write, and every directory read in lib/directory/loadFacilities.ts is
 * unstable_cache'd for 6h under the 'directory' tag — so without this call a freshly published
 * metro hard-404s at /courts/in/<slug> until the TTL lapses, while /courts already links to it.
 * That is the Greensboro-High Point + Little Rock defect of 2026-07-30.
 *
 * Call it at the very end of --stage=publish. It busts the tag and then PROVES the metro page is
 * live: a revalidation that silently no-ops is indistinguishable from the bug it exists to fix.
 *
 * Standalone (also the manual recovery command):
 *   node scripts/lib/revalidate-directory.mjs --metro="Little Rock"
 *   node scripts/lib/revalidate-directory.mjs
 *
 * Needs CRON_SECRET in .env.local — copy it from the Vercel project's Production environment. It is
 * the same shared secret the /api/cron/* routes already use; no new Vercel env var is required.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Mirrors DEFAULT_SITE_URL in lib/utils/site-url.ts — www, not the apex (the apex 307s).
const DEFAULT_SITE_URL = 'https://www.joinzer.com'

// Same .env.local parser the import scripts use, duplicated so this file is runnable on its own.
function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
        })
    )
  } catch {
    return {}
  }
}

/** Mirror of metroSlug() in lib/directory/metros.ts — keep the two in lockstep. */
export function metroSlug(metroArea) {
  return metroArea
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Bust the 'directory' cache tag, then confirm the metro page resolves.
 * Returns { ok, reason } — never throws, so it cannot mask a successful publish.
 */
export async function revalidateDirectory({ metroArea = null } = {}) {
  const env = readEnvLocal()
  const site = (env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '')
  const secret = env.CRON_SECRET
  const target = metroArea ? `/courts/in/${metroSlug(metroArea)}` : 'the new metro pages'

  if (!secret) {
    console.error(
      `\n!!! ACTION REQUIRED — the directory cache was NOT busted.` +
      `\n!!! CRON_SECRET is missing from .env.local, so the revalidation route could not be called.` +
      `\n!!! The rows ARE published, but ${target} will 404 for up to 6 hours.` +
      `\n!!! Copy CRON_SECRET from the Vercel Production environment into .env.local, then run:` +
      `\n!!!   node scripts/lib/revalidate-directory.mjs${metroArea ? ` --metro="${metroArea}"` : ''}\n`
    )
    return { ok: false, reason: 'missing CRON_SECRET in .env.local' }
  }

  let res
  try {
    res = await fetch(`${site}/api/revalidate-directory`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
  } catch (e) {
    console.error(`\nrevalidation request to ${site} failed: ${e.message} — the directory cache is still stale.`)
    return { ok: false, reason: `request failed: ${e.message}` }
  }

  if (!res.ok) {
    console.error(
      `\nrevalidation failed: ${res.status} ${res.statusText} — the directory cache is still stale.` +
      (res.status === 401 ? `\n  401 means the local CRON_SECRET does not match the deployed one.` : '')
    )
    return { ok: false, reason: `revalidation HTTP ${res.status}` }
  }
  console.log(`\ndirectory cache busted at ${site} ✓`)

  if (!metroArea) return { ok: true }

  // Prove it end to end. This is the assertion whose absence let the 2026-07-30 publishes report
  // a clean 33/33 verify while both metro pages were hard-404ing in production.
  const url = `${site}${target}`
  let check
  try {
    check = await fetch(url, { redirect: 'follow' })
  } catch (e) {
    console.error(`\ncould not reach ${url}: ${e.message} — publish visibility UNVERIFIED.`)
    return { ok: false, reason: `metro page unreachable: ${e.message}` }
  }

  if (check.ok) {
    console.log(`${url} -> ${check.status} ✓ live`)
    return { ok: true }
  }
  console.error(
    `\n${url} -> ${check.status} — the metro page is STILL not resolving.` +
    `\n  Do not treat this publish as visible. Check that the deployed build contains` +
    `\n  app/api/revalidate-directory/route.ts.\n`
  )
  return { ok: false, reason: `metro page HTTP ${check.status}` }
}

// Runnable standalone. argv[1] is undefined under `node -e`/`node --eval`, hence the guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find((a) => a.startsWith('--metro='))
  const metroArea = arg ? arg.split('=').slice(1).join('=') : null
  const result = await revalidateDirectory({ metroArea })
  process.exit(result.ok ? 0 : 1)
}

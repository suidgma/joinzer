import { NextRequest, NextResponse } from 'next/server'

/**
 * Shared guard for every `/api/cron/*` route. Returns a 401 response to hand straight back
 * to the caller, or `null` when the request is authorized.
 *
 * Why this logs rather than just returning: `CRON_SECRET` was never set in Vercel, so from
 * the day the first cron shipped every scheduled run returned a clean 401 JSON body and
 * nothing, anywhere, recorded that the jobs had never once succeeded — three months of
 * total failure that looked exactly like success. A 401 on these routes is never routine;
 * the only caller that should ever reach them is Vercel's scheduler. The two cases are
 * logged separately because "the secret is missing here" and "the caller sent the wrong
 * token" have completely different fixes.
 *
 * This does NOT make silence loud on its own — only an external check or a scheduled digest
 * can do that. See the cron-health entry in docs/strategy/decision-log.md for the posture.
 */
export function assertCronSecret(req: NextRequest, routeName: string): NextResponse | null {
  const expected = process.env.CRON_SECRET

  if (!expected) {
    console.error(
      `[cron] MISCONFIGURED ${routeName}: CRON_SECRET is not set in this environment — ` +
        `every scheduled run of this route will fail until it is`
    )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (req.headers.get('authorization') !== `Bearer ${expected}`) {
    console.error(`[cron] UNAUTHORIZED ${routeName}: missing or incorrect bearer token`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

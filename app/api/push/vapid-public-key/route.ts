import { NextResponse } from 'next/server'

// The VAPID *public* key is safe to expose — it's the applicationServerKey the
// browser needs to subscribe to push. Served at runtime (not read via an inlined
// NEXT_PUBLIC_ value) so push doesn't depend on the var being present for the
// Production *build*: that build-time coupling silently baked `undefined` into
// the client bundle when the var wasn't scoped to Production, which broke the
// Enable toggle with a cryptic TypeError. Reading it here at request time means
// push works the moment the key exists in the Production runtime env.
export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null
  return NextResponse.json({ key })
}

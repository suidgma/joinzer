'use strict'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The fixed e2e test-user identity every spec authenticates as (see helpers/auth.ts,
// TEST_USER_EMAIL/PASSWORD in .env.test). Teardown re-derives it independently so that
// if those credentials are ever pointed at a different account, cleanup no-ops instead
// of deleting under an identity nobody has actually verified.
const EXPECTED_TEST_USER_ID = 'aab7568a-c55b-4dd1-b60a-6a12c16d9fab'

type TournamentTarget = {
  table: 'tournaments'
  id: string
  ownerColumn: 'organizer_id'
  titleColumn: 'name'
  expectedTitle: string
}

type EventTarget = {
  table: 'events'
  id: string
  ownerColumn: 'captain_user_id'
  titleColumn: 'title'
  expectedTitle: string
}

type TestRowTarget = TournamentTarget | EventTarget

async function getAuthedTestClient(): Promise<{ client: SupabaseClient; userId: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD

  if (!url || !anonKey || !email || !password) {
    console.warn('[e2e cleanup] missing Supabase/test-user env vars — skipping cleanup (no-op)')
    return null
  }

  const client = createClient(url, anonKey)
  const { data, error } = await client.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    console.warn(`[e2e cleanup] sign-in failed — skipping cleanup (no-op): ${error?.message ?? 'no user returned'}`)
    return null
  }

  // Safety net, not the security boundary — RLS (owner-scoped DELETE policies on
  // tournaments/events) is what actually caps the blast radius of every call below.
  if (data.user.id !== EXPECTED_TEST_USER_ID) {
    console.warn(`[e2e cleanup] signed-in user ${data.user.id} does not match the known e2e test user — skipping cleanup (no-op)`)
    return null
  }

  return { client, userId: data.user.id }
}

/**
 * Marks a tournament this run created as test data. `events` has no equivalent
 * column, so this only ever applies to `tournaments`. Best-effort and never throws —
 * a cleanup hiccup must never fail the test that created the row.
 */
export async function markDummy(id: string): Promise<void> {
  const auth = await getAuthedTestClient()
  if (!auth) return

  const { error } = await auth.client
    .from('tournaments')
    .update({ dummy: true })
    .eq('id', id)
    .eq('organizer_id', auth.userId)

  if (error) {
    console.warn(`[e2e cleanup] failed to mark tournaments/${id} dummy: ${error.message}`)
  }
}

/**
 * Deletes exactly the row this run created — never a title/owner pattern (the
 * pre-existing production rows share that exact pattern, so a pattern-based filter
 * would take them out too). Re-verifies owner + exact title immediately before
 * deleting, then relies on the table's owner-scoped RLS DELETE policy (never the
 * service-role key) so even a filter bug can only ever touch rows owned by this one
 * test account. Best-effort and never throws.
 */
export async function deleteTestRow(target: TestRowTarget): Promise<void> {
  const auth = await getAuthedTestClient()
  if (!auth) return
  const { client, userId } = auth

  const { data: row, error: selectError } = await client
    .from(target.table)
    .select(`id, ${target.ownerColumn}, ${target.titleColumn}`)
    .eq('id', target.id)
    .maybeSingle()

  if (selectError) {
    console.warn(`[e2e cleanup] could not verify ${target.table}/${target.id} before delete: ${selectError.message}`)
    return
  }
  if (!row) {
    // Already gone — e.g. the test's own UI delete step already removed it (the
    // common case: this backstop is a safety net, not the primary cleanup path).
    // Logged, not silent, so a real run's cleanup trail is legible; still a clean
    // no-op, same as every other guarded-return path in this function.
    console.log(`[e2e cleanup] ${target.table}/${target.id} already gone — no-op`)
    return
  }

  const owner = (row as Record<string, unknown>)[target.ownerColumn]
  const title = (row as Record<string, unknown>)[target.titleColumn]
  if (owner !== userId || title !== target.expectedTitle) {
    console.warn(`[e2e cleanup] ${target.table}/${target.id} does not match the expected test-row identity (owner=${String(owner)}, title=${String(title)}) — refusing to delete`)
    return
  }

  const { error: deleteError } = await client
    .from(target.table)
    .delete()
    .eq('id', target.id)
    .eq(target.ownerColumn, userId)
    .eq(target.titleColumn, target.expectedTitle)

  if (deleteError) {
    console.warn(`[e2e cleanup] failed to delete ${target.table}/${target.id}: ${deleteError.message}`)
  } else {
    console.log(`[e2e cleanup] deleted ${target.table}/${target.id}`)
  }
}

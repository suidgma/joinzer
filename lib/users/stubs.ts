import { type User } from '@supabase/supabase-js'

// Fetch every auth user, paging so we never miss users beyond the first page.
// Shared by the tournament + league CSV importers for email → account matching.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listAllAuthUsers(service: any): Promise<User[]> {
  const all: User[] = []
  let page = 1
  const perPage = 1000
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    all.push(...data.users)
    if (data.users.length < perPage) break
    page++
  }
  return all
}

export function normalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase()
  const at = lower.indexOf('@')
  if (at === -1) return lower
  return lower.slice(0, at).replace(/\+.*$/, '') + lower.slice(at)
}

/**
 * Optional player attributes an organizer may provide when bulk-importing.
 * These are only written when CREATING a stub — existing profiles are never
 * overridden (the player's own data wins).
 */
export type StubExtras = {
  name?: string | null
  phone?: string | null
  gender?: string | null
  dupr_rating?: number | null
}

/**
 * Map common CSV gender spellings to the values the profiles.gender CHECK
 * constraint accepts. Anything we can't confidently classify returns null —
 * better to leave gender unset than to break the insert with a CHECK violation
 * (which is the exact bug this normaliser was added to fix on 2026-05-28).
 *
 * Constraint at time of writing: `gender IN ('male', 'female')`.
 */
function normalizeGender(raw: string | null | undefined): 'male' | 'female' | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === 'm' || v === 'male' || v === 'man') return 'male'
  if (v === 'f' || v === 'female' || v === 'woman' || v === 'w') return 'female'
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createStub(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  email: string,
  userByNormEmail: Map<string, User>,
  extras: StubExtras = {}
): Promise<{ userId: string; isNew: boolean }> {
  const norm = normalizeEmail(email)

  const existing = userByNormEmail.get(norm)
  if (existing) return { userId: existing.id, isNew: false }

  const { data: newUser, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
  })

  if (error) {
    // Race: user created between map snapshot and now
    if ((error as any).status === 422 || error.message?.toLowerCase().includes('already registered')) {
      const { data: profile } = await service
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single()
      if (profile) return { userId: profile.id, isNew: false }
    }
    throw error
  }

  const userId = newUser.user.id

  // Build the profile row. Required defaults: name, email, is_stub, joinzer_rating, notify_new_sessions.
  // Optional extras only added if provided — keeps the row narrow for the singles import path
  // that doesn't pass extras at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileRow: Record<string, any> = {
    id: userId,
    name: extras.name?.trim() || email,
    email,
    is_stub: true,
    joinzer_rating: 1000,
    notify_new_sessions: false,
  }
  if (extras.phone?.trim()) profileRow.phone = extras.phone.trim()

  const normalizedGender = normalizeGender(extras.gender)
  if (normalizedGender) profileRow.gender = normalizedGender

  if (extras.dupr_rating != null && !Number.isNaN(extras.dupr_rating)) {
    profileRow.dupr_rating = extras.dupr_rating
    // rating_source CHECK constraint accepts: 'dupr_known' | 'estimated' | 'skipped'.
    // Organizer-supplied ratings are not verified DUPR scores — use 'estimated'.
    profileRow.rating_source = 'estimated'
  }

  // CRITICAL: surface errors. Previously this upsert silently swallowed failures —
  // a CHECK-constraint violation (e.g. gender = 'M' before normalisation) would
  // leave the auth.users row in place with NO matching profile row, breaking
  // every downstream join on tournament_registrations -> profiles.
  // See: 2026-05-28 demo-import incident, 34 orphaned auth users.
  const { error: profileErr } = await service.from('profiles').upsert(
    profileRow,
    { onConflict: 'id', ignoreDuplicates: true }
  )
  if (profileErr) {
    throw new Error(
      `Profile creation failed for ${email}: ${profileErr.message}` +
      ` (auth user ${userId} was created and now orphaned — manual cleanup needed)`
    )
  }

  return { userId, isNew: true }
}

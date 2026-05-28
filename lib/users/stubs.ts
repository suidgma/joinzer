import { type User } from '@supabase/supabase-js'

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
  if (extras.gender?.trim()) profileRow.gender = extras.gender.trim()
  if (extras.dupr_rating != null && !Number.isNaN(extras.dupr_rating)) {
    profileRow.dupr_rating = extras.dupr_rating
    profileRow.rating_source = 'organizer_import'
  }

  // No auto-creation trigger — explicit insert. ignoreDuplicates makes retries safe.
  await service.from('profiles').upsert(
    profileRow,
    { onConflict: 'id', ignoreDuplicates: true }
  )

  return { userId, isNew: true }
}

import { type User } from '@supabase/supabase-js'

export function normalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase()
  const at = lower.indexOf('@')
  if (at === -1) return lower
  return lower.slice(0, at).replace(/\+.*$/, '') + lower.slice(at)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createStub(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  email: string,
  userByNormEmail: Map<string, User>
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

  // No auto-creation trigger — explicit insert. ignoreDuplicates makes retries safe.
  await service.from('profiles').upsert(
    { id: userId, name: email, email, is_stub: true, joinzer_rating: 1000, notify_new_sessions: false },
    { onConflict: 'id', ignoreDuplicates: true }
  )

  return { userId, isNew: true }
}

import type { SupabaseClient } from '@supabase/supabase-js'

// Server-side backstop for the "paid events need approval" gate. Free events never call this;
// paid-checkout routes call it before creating a Stripe Checkout session, so an unapproved
// organizer can't collect money even if the create-form gate is bypassed. Returns true when the
// organizer is approved (profiles.can_create_paid_events).
export async function organizerCanCharge(
  db: SupabaseClient,
  organizerId: string | null | undefined,
): Promise<boolean> {
  if (!organizerId) return false
  const { data } = await db
    .from('profiles')
    .select('can_create_paid_events')
    .eq('id', organizerId)
    .single()
  return !!(data as { can_create_paid_events?: boolean } | null)?.can_create_paid_events
}

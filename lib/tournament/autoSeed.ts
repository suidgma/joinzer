import type { SupabaseClient } from '@supabase/supabase-js'

// Assigns display seeds (1..N) to a division's teams in bracket-build order.
// Used at generation time when the organizer has "Show seed numbers" on but never
// assigned seeds manually — without this, `seed` stays null and there is nothing
// for brackets/schedules/export to display. The seed follows the exact order the
// bracket was drawn in, so the numbers match what's on the board. Only the
// canonical team registration carries the seed (the id the match rows reference);
// doubles partners keep null, exactly like the manual "Save Seeds" flow.
export async function persistAutoSeeds(
  db: SupabaseClient,
  teamRegIdsInOrder: string[],
): Promise<void> {
  await Promise.all(
    teamRegIdsInOrder.map((id, i) =>
      db.from('tournament_registrations').update({ seed: i + 1 }).eq('id', id),
    ),
  )
}

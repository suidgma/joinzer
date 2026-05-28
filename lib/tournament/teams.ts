/**
 * Dedupe tournament_registrations into one canonical entry per TEAM.
 *
 * The doubles registration model on main puts **two rows per team** in
 * tournament_registrations — one per player, cross-linked via
 * `partner_registration_id`. (See `register_doubles_pair` RPC.)
 *
 * Naive bracket generators that map every registration row to a "team"
 * therefore over-count by 2× for doubles divisions and emit nonsense
 * matches like "Rivera/Kim vs Kim/Rivera" (the same two people on both
 * sides) plus far too many matches per round.
 *
 * This helper picks the lexicographically-smaller registration ID of
 * each pair as the canonical team representative. Singles registrations
 * (where partner_registration_id is null) pass through unchanged.
 *
 * Pass the de-duped IDs straight into the bracket-builder algorithms —
 * each ID will resolve cleanly via `team_1_registration_id` /
 * `team_2_registration_id` on the resulting match rows, with the other
 * half of the pair found via `partner_registration_id` on the same row.
 */

export type RegistrationLike = {
  id: string
  partner_registration_id: string | null
}

export function dedupeRegistrationsToTeams<T extends RegistrationLike>(
  registrations: T[]
): string[] {
  const seenPairs = new Set<string>()
  const teamIds: string[] = []

  for (const reg of registrations) {
    const partnerId = reg.partner_registration_id
    if (!partnerId) {
      // Singles registration (or solo doubles awaiting a partner-match)
      teamIds.push(reg.id)
      continue
    }

    // Doubles pair — canonical = lexicographically smaller id.
    // Deterministic regardless of which row of the pair we see first.
    const canonical = reg.id < partnerId ? reg.id : partnerId
    if (seenPairs.has(canonical)) continue
    seenPairs.add(canonical)
    teamIds.push(canonical)
  }

  return teamIds
}

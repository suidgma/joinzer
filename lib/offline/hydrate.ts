import { writeTournament, type TournamentBundle } from './tournamentDB'

// Fetch the whole tournament in one authorized server round-trip and write it to the local
// IndexedDB store, so run mode can read it offline. Online only — returns null on failure
// (caller falls back to whatever is already stored). See docs/phases/offline-run-mode-phase-2.md.
export async function hydrateFromServer(tournamentId: string): Promise<TournamentBundle | null> {
  try {
    const res = await fetch(`/api/tournaments/${tournamentId}/offline-bundle`)
    if (!res.ok) return null
    const bundle = (await res.json()) as TournamentBundle
    await writeTournament(bundle)
    return bundle
  } catch {
    return null
  }
}

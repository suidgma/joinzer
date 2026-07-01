import RunMode from '@/components/features/tournaments/RunMode'

// Thin server shell — intentionally NO data fetch, so the route cold-loads from the SW cache
// with no network. <RunMode> reads the tournament from IndexedDB (offline) or hydrates it
// first (online). See docs/phases/offline-run-mode-phase-2.md.
export default async function RunPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  return <RunMode tournamentId={id} />
}

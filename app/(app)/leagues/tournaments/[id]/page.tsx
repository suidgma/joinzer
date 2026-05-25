import { redirect } from 'next/navigation'

export default async function OldTournamentDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/tournaments/${params.id}`)
}

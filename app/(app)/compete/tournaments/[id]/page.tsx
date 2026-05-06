import { redirect } from 'next/navigation'

export default function OldTournamentDetailPage({ params }: { params: { id: string } }) {
  redirect(`/tournaments/${params.id}`)
}

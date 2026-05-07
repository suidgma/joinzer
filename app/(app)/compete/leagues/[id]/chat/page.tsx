import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import GroupChat from '@/components/features/GroupChat'

export default async function LeagueChatPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: league }, { data: myReg }, { data: messages }] = await Promise.all([
    supabase.from('leagues').select('id, name, created_by').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('status, is_co_admin')
      .eq('league_id', params.id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('league_messages')
      .select('id, user_id, message_text, created_at, profile:profiles!user_id(name)')
      .eq('league_id', params.id)
      .order('created_at', { ascending: true })
      .limit(200),
  ])

  if (!league) notFound()

  const isAdmin = user.id === league.created_by || myReg?.is_co_admin === true
  const canChat = myReg?.status === 'registered' || isAdmin

  return (
    <main className="max-w-lg mx-auto flex flex-col" style={{ height: 'calc(100dvh - 64px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-brand-border bg-white shrink-0">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">
          ←
        </Link>
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-dark truncate">{league.name}</p>
          <p className="text-xs text-brand-muted">League Chat</p>
        </div>
      </div>

      {/* Chat fills remaining height */}
      <div className="flex-1 min-h-0">
        <FullscreenGroupChat
          entityId={league.id}
          initialMessages={(messages ?? []) as any[]}
          currentUserId={user.id}
          canChat={canChat}
        />
      </div>
    </main>
  )
}

// Thin wrapper that strips the border/rounded styling for full-page use
function FullscreenGroupChat({
  entityId,
  initialMessages,
  currentUserId,
  canChat,
}: {
  entityId: string
  initialMessages: any[]
  currentUserId: string
  canChat: boolean
}) {
  return (
    <GroupChat
      table="league_messages"
      entityId={entityId}
      entityField="league_id"
      initialMessages={initialMessages}
      currentUserId={currentUserId}
      canChat={canChat}
      fullscreen
    />
  )
}

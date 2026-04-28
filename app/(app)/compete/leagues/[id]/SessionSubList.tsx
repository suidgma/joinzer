'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Session = {
  id: string
  session_number: number
  session_date: string
  status: string
}

type Props = {
  sessions: Session[]
  mySubSessionIds: Set<string>
}

export default function SessionSubList({ sessions, mySubSessionIds }: Props) {
  const [subbed, setSubbed] = useState<Set<string>>(new Set(mySubSessionIds))
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function toggle(sessionId: string) {
    setLoadingId(sessionId)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingId(null); return }

    if (subbed.has(sessionId)) {
      await supabase.from('league_session_subs').delete().eq('session_id', sessionId).eq('user_id', user.id)
      setSubbed((prev) => { const n = new Set(prev); n.delete(sessionId); return n })
    } else {
      await supabase.from('league_session_subs').insert({ session_id: sessionId, user_id: user.id })
      setSubbed((prev) => new Set([...prev, sessionId]))
    }
    setLoadingId(null)
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const isSubbed = subbed.has(s.id)
        const loading = loadingId === s.id
        const dateStr = new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        })
        return (
          <div key={s.id} className="flex items-center justify-between bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-brand-dark">Session {s.session_number} · {dateStr}</p>
            </div>
            <button
              onClick={() => toggle(s.id)}
              disabled={loading}
              className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                isSubbed
                  ? 'bg-brand text-brand-dark border-brand'
                  : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
              }`}
            >
              {loading ? '…' : isSubbed ? 'Available ✓' : 'I can sub'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

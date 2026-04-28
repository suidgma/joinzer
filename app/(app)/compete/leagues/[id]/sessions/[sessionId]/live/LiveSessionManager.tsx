'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type PlayerEntry = { id: string; name: string; photoUrl: string | null; isSub: boolean }

type Props = {
  sessionId: string
  leagueId: string
  players: PlayerEntry[]
  subs: PlayerEntry[]
  initialAttendance: Map<string, boolean>
}

export default function LiveSessionManager({ sessionId, players, subs, initialAttendance }: Props) {
  const router = useRouter()
  const [attendance, setAttendance] = useState<Map<string, boolean>>(new Map(initialAttendance))
  const [saving, setSaving] = useState(false)
  const [courts, setCourts] = useState(2)
  const [assignments, setAssignments] = useState<string[][][]>([]) // [court][team][player]

  const allEntries = [...players, ...subs]
  const present = allEntries.filter((p) => attendance.has(p.id))
  const presentCount = present.length

  function toggleAttendance(playerId: string, isSub: boolean) {
    setAttendance((prev) => {
      const next = new Map(prev)
      if (next.has(playerId)) {
        next.delete(playerId)
      } else {
        next.set(playerId, isSub)
      }
      return next
    })
    setAssignments([]) // clear assignments when attendance changes
  }

  async function saveAttendance() {
    setSaving(true)
    const supabase = createClient()
    // Delete existing, then insert current
    await supabase.from('league_session_attendance').delete().eq('session_id', sessionId)
    if (attendance.size > 0) {
      await supabase.from('league_session_attendance').insert(
        Array.from(attendance.entries()).map(([user_id, is_sub]) => ({
          session_id: sessionId,
          user_id,
          is_sub,
        }))
      )
    }
    router.refresh()
    setSaving(false)
  }

  function generateAssignments() {
    const presentPlayers = Array.from(attendance.keys())
    const shuffled = [...presentPlayers].sort(() => Math.random() - 0.5)
    const numCourts = Math.min(courts, Math.floor(shuffled.length / 2))
    const result: string[][][] = []

    for (let c = 0; c < numCourts; c++) {
      const base = c * 4
      if (base + 3 < shuffled.length) {
        result.push([[shuffled[base], shuffled[base + 1]], [shuffled[base + 2], shuffled[base + 3]]])
      } else if (base + 1 < shuffled.length) {
        result.push([[shuffled[base]], [shuffled[base + 1]]])
      }
    }
    setAssignments(result)
  }

  function getName(id: string) {
    return allEntries.find((p) => p.id === id)?.name ?? id
  }

  return (
    <div className="space-y-4">
      {/* Attendance */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
            Attendance ({presentCount} present)
          </h2>
          <button
            onClick={saveAttendance}
            disabled={saving}
            className="text-xs bg-brand text-brand-dark px-3 py-1 rounded-full font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* Registered players */}
        <div className="space-y-1">
          <p className="text-xs text-brand-muted font-medium">Registered Players</p>
          {players.map((p) => {
            const here = attendance.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => toggleAttendance(p.id, false)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 border transition-colors ${
                  here ? 'bg-brand/20 border-brand' : 'bg-brand-surface border-brand-border'
                }`}
              >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                  {p.photoUrl
                    ? <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                    : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                  }
                </div>
                <span className={`flex-1 text-sm text-left font-medium ${here ? 'text-brand-dark' : 'text-brand-muted'}`}>{p.name}</span>
                <span className={`text-xs font-bold ${here ? 'text-brand-dark' : 'text-brand-muted'}`}>{here ? '✓' : '—'}</span>
              </button>
            )
          })}
        </div>

        {/* Available subs */}
        {subs.length > 0 && (
          <div className="space-y-1 pt-1">
            <p className="text-xs text-brand-muted font-medium">Available Subs</p>
            {subs.map((p) => {
              const here = attendance.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => toggleAttendance(p.id, true)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 border transition-colors ${
                    here ? 'bg-yellow-50 border-yellow-300' : 'bg-brand-surface border-brand-border'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                    {p.photoUrl
                      ? <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                      : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                    }
                  </div>
                  <span className={`flex-1 text-sm text-left font-medium ${here ? 'text-brand-dark' : 'text-brand-muted'}`}>{p.name}</span>
                  <span className="text-xs text-yellow-700 font-medium">Sub</span>
                  <span className={`text-xs font-bold ${here ? 'text-yellow-700' : 'text-brand-muted'}`}>{here ? '✓' : '—'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Court assignment */}
      {presentCount >= 2 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide flex-1">Court Assignment</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-brand-muted">Courts:</label>
              <input
                type="number" min="1" max="8" value={courts}
                onChange={(e) => { setCourts(parseInt(e.target.value) || 1); setAssignments([]) }}
                className="input text-sm w-16"
              />
            </div>
          </div>

          <button
            onClick={generateAssignments}
            className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
          >
            Generate Assignments (random)
          </button>

          {assignments.length > 0 && (
            <div className="space-y-2">
              {assignments.map((court, ci) => (
                <div key={ci} className="bg-brand-surface border border-brand-border rounded-xl p-3">
                  <p className="text-xs font-semibold text-brand-muted uppercase mb-2">Court {ci + 1}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex-1">
                      {court[0]?.map((pid) => <p key={pid} className="font-medium text-brand-dark">{getName(pid)}</p>)}
                    </div>
                    <span className="text-brand-muted font-bold">vs</span>
                    <div className="flex-1 text-right">
                      {court[1]?.map((pid) => <p key={pid} className="font-medium text-brand-dark">{getName(pid)}</p>)}
                    </div>
                  </div>
                </div>
              ))}
              {presentCount > assignments.length * 4 && (
                <p className="text-xs text-brand-muted text-center">
                  {presentCount - assignments.length * 4} player(s) sitting out this round
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

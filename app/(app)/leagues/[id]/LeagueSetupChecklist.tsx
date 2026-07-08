'use client'
import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Circle, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'

type Step = { label: string; done: boolean; hint: string; href: string }

type Props = {
  leagueId: string
  regOpen: boolean
  hasPlayers: boolean
  hasPlay: boolean
  runHref: string
  runLabel: string
}

// New-organizer setup checklist for a league (parallels the tournament one). Each
// incomplete step links straight to where it's done. Auto-hides once all three are done.
export default function LeagueSetupChecklist({ leagueId, regOpen, hasPlayers, hasPlay, runHref, runLabel }: Props) {
  const steps: Step[] = [
    { label: 'Open registration', done: regOpen, hint: 'Set registration to Open so players can join', href: `/leagues/${leagueId}/edit` },
    { label: 'Add players', done: hasPlayers, hint: 'Register or invite at least 2 players', href: `/leagues/${leagueId}/roster` },
    { label: 'Start play', done: hasPlay, hint: `${runLabel} — generate your first matches`, href: runHref },
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length
  const [open, setOpen] = useState(!allDone)

  if (allDone) return null

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-800">Setup checklist</span>
          <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">{doneCount}/{steps.length}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-blue-600" /> : <ChevronDown size={16} className="text-blue-600" />}
      </button>

      {open && (
        <ul className="border-t border-blue-200 divide-y divide-blue-100">
          {steps.map((step, i) =>
            step.done ? (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" />
                <p className="text-sm font-medium text-blue-400 line-through">{step.label}</p>
              </li>
            ) : (
              <li key={i}>
                <Link href={step.href} className="flex items-start gap-3 px-4 py-3 hover:bg-blue-100/60 transition-colors">
                  <Circle size={16} className="text-blue-300 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-blue-900">{step.label}</p>
                    <p className="text-xs text-blue-600 mt-0.5">{step.hint}</p>
                  </div>
                  <ChevronRight size={16} className="text-blue-400 mt-0.5 shrink-0" />
                </Link>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}

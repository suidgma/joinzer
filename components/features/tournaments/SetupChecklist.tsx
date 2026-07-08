'use client'
import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Circle, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'

type Step = {
  label: string
  done: boolean
  hint: string
  href: string
}

type Props = {
  tournamentId: string
  hasDivisions: boolean
  regOpen: boolean
  published: boolean
  hasMatches: boolean
}

export default function SetupChecklist({ tournamentId, hasDivisions, regOpen, published, hasMatches }: Props) {
  const steps: Step[] = [
    { label: 'Add divisions', done: hasDivisions, hint: 'Create at least one division', href: `/tournaments/${tournamentId}#tournament-divisions` },
    { label: 'Open registration', done: regOpen, hint: 'Set Registration to Open so players can sign up', href: `/tournaments/${tournamentId}/edit` },
    { label: 'Publish the tournament', done: published, hint: 'Set Status to Published so it appears publicly', href: `/tournaments/${tournamentId}/edit` },
    { label: 'Generate the bracket / schedule', done: hasMatches, hint: 'Build the schedule once players have registered', href: `/tournaments/${tournamentId}/schedule/builder` },
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length

  const [open, setOpen] = useState(!allDone)

  if (allDone) return null

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-800">Setup checklist</span>
          <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
            {doneCount}/{steps.length}
          </span>
        </div>
        {open ? <ChevronUp size={16} className="text-blue-600" /> : <ChevronDown size={16} className="text-blue-600" />}
      </button>

      {open && (
        <ul className="border-t border-blue-200 divide-y divide-blue-100">
          {steps.map((step, i) => {
            if (step.done) {
              return (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium text-blue-400 line-through">{step.label}</p>
                </li>
              )
            }
            // Incomplete steps are actionable — tap to go straight to where the step is done.
            return (
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
          })}
        </ul>
      )}
    </div>
  )
}

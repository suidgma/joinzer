'use client'
import { useState } from 'react'
import { CheckCircle, Circle, ChevronDown, ChevronUp } from 'lucide-react'

type Step = {
  label: string
  done: boolean
  hint: string
}

type Props = {
  hasDivisions: boolean
  regOpen: boolean
  published: boolean
  hasMatches: boolean
}

export default function SetupChecklist({ hasDivisions, regOpen, published, hasMatches }: Props) {
  const steps: Step[] = [
    { label: 'Add divisions', done: hasDivisions, hint: 'Tap "+ Add Division" below' },
    { label: 'Open registration', done: regOpen, hint: 'Edit the tournament to set Registration to Open' },
    { label: 'Publish the tournament', done: published, hint: 'Edit the tournament and set Status to Published' },
    { label: 'Generate the bracket / schedule', done: hasMatches, hint: 'Use "Generate Matches" once players register' },
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
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              {step.done
                ? <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" />
                : <Circle size={16} className="text-blue-300 mt-0.5 shrink-0" />
              }
              <div>
                <p className={`text-sm font-medium ${step.done ? 'text-blue-400 line-through' : 'text-blue-900'}`}>
                  {step.label}
                </p>
                {!step.done && (
                  <p className="text-xs text-blue-600 mt-0.5">{step.hint}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

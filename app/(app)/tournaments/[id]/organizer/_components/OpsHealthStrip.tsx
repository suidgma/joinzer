import type { OrgMatch } from './types'
import { CheckCircle, AlertTriangle } from 'lucide-react'

type Props = {
  matches: OrgMatch[]
}

export default function OpsHealthStrip({ matches }: Props) {
  const now = Date.now()
  const inProgress = matches.filter(m => m.status === 'in_progress')

  // Schedule health: how far behind is the latest overdue in-progress match
  let behindMins = 0
  for (const m of inProgress) {
    if (m.scheduled_time) {
      const delta = Math.round((now - new Date(m.scheduled_time).getTime()) / 60000)
      if (delta > behindMins) behindMins = delta
    }
  }
  const onSchedule = behindMins < 10

  // TODO: derive totalCourts from competition_courts table once migrated
  const courtNumbers = Array.from(new Set(matches.filter(m => m.court_number != null).map(m => m.court_number!)))
  const totalCourts = courtNumbers.length
  const activeCourts = new Set(inProgress.filter(m => m.court_number != null).map(m => m.court_number!)).size

  const openIssues = matches.filter(m => m.status === 'disputed' || m.status === 'forfeited').length

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar py-0.5">
      <Pill
        label={onSchedule ? 'On schedule' : `${behindMins}m behind`}
        icon={
          onSchedule
            ? <CheckCircle size={12} className="text-brand-active shrink-0" />
            : <AlertTriangle size={12} className="text-yellow-600 shrink-0" />
        }
        color={onSchedule ? 'text-brand-active' : 'text-yellow-700'}
        bg={onSchedule ? 'bg-brand-soft' : 'bg-yellow-50'}
        border={onSchedule ? 'border-brand-border' : 'border-yellow-200'}
      />
      <Pill
        label={totalCourts > 0 ? `${activeCourts} of ${totalCourts} courts active` : 'No courts assigned'}
        color="text-brand-dark"
        bg="bg-white"
        border="border-brand-border"
      />
      <Pill
        label={`${openIssues} open issue${openIssues !== 1 ? 's' : ''}`}
        color={openIssues > 0 ? 'text-red-700' : 'text-brand-muted'}
        bg={openIssues > 0 ? 'bg-red-50' : 'bg-white'}
        border={openIssues > 0 ? 'border-red-200' : 'border-brand-border'}
      />
    </div>
  )
}

function Pill({
  label, icon, color, bg, border,
}: {
  label: string; icon?: React.ReactNode; color: string; bg: string; border: string
}) {
  return (
    <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${color} ${bg} ${border}`}>
      {icon}
      {label}
    </div>
  )
}

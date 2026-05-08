'use client'
import { Megaphone, Clock, Download } from 'lucide-react'

type Props = {
  onAnnounce: () => void
  onReschedule: () => void
  onExport: () => void
}

export default function QuickActionsBar({ onAnnounce, onReschedule, onExport }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
      <Chip icon={<Megaphone size={14} />} label="Announce" onClick={onAnnounce} primary />
      <Chip icon={<Clock size={14} />} label="Reschedule" onClick={onReschedule} />
      <Chip icon={<Download size={14} />} label="Export" onClick={onExport} />
    </div>
  )
}

function Chip({
  icon, label, onClick, primary,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-colors active:scale-95 ${
        primary
          ? 'bg-brand border-brand text-brand-dark hover:bg-brand-hover'
          : 'bg-white border-brand-border text-brand-dark hover:bg-brand-soft'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

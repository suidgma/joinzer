'use client'
import { X, ExternalLink } from 'lucide-react'

type Props = {
  tournamentId: string
  divisionId: string
  divisionName: string
  onClose: () => void
}

export default function QrCheckinModal({ tournamentId, divisionId, divisionName, onClose }: Props) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
  const checkinUrl = `${siteUrl}/tournaments/${tournamentId}/checkin?div=${divisionId}`

  // QR code image via api.qrserver.com — encodes only public UUIDs, no PII
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=2&data=${encodeURIComponent(checkinUrl)}`

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-xs space-y-4 text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-bold text-brand-dark">QR Check-in</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-brand-muted">
          <span className="font-medium text-brand-dark">{divisionName}</span>
          {' '}— players scan this to check themselves in
        </p>

        {/* QR code */}
        <div className="flex justify-center">
          <img
            src={qrSrc}
            alt="Check-in QR code"
            width={220}
            height={220}
            className="rounded-xl border border-brand-border"
          />
        </div>

        <a
          href={checkinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-brand-active hover:underline"
        >
          Open check-in link <ExternalLink size={11} />
        </a>

        <p className="text-[10px] text-brand-muted">
          Show this QR code on your device. Each player scans once to mark themselves in.
        </p>
      </div>
    </div>
  )
}

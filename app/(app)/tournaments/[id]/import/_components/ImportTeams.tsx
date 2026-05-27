'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type DivisionOption = {
  id: string
  name: string
  team_type: 'singles' | 'doubles'
  status: string
}

type RowOutcome = {
  rowIndex: number
  player1Email: string
  player2Email: string | null
  teamName: string | null
  status: 'ok' | 'missing_account' | 'duplicate' | 'invalid'
  message?: string
  createdRegistrationId?: string
}

type Summary = {
  total: number
  ok: number
  created: number
  missing_account: number
  duplicate: number
  invalid: number
}

const SAMPLE_CSV = `player1_email,player1_name,player2_email,player2_name,team_name
alex@example.com,Alex Wong,jordan@example.com,Jordan Lee,The Smashers
sam@example.com,Sam Patel,riley@example.com,Riley Garcia,
`

const STATUS_LABEL: Record<RowOutcome['status'], string> = {
  ok: 'Ready',
  missing_account: 'No account',
  duplicate: 'Already in',
  invalid: 'Invalid',
}
const STATUS_COLOR: Record<RowOutcome['status'], string> = {
  ok: 'bg-brand-soft text-brand-active',
  missing_account: 'bg-yellow-50 text-yellow-700',
  duplicate: 'bg-gray-100 text-gray-600',
  invalid: 'bg-red-50 text-red-700',
}

type Props = {
  tournamentId: string
  divisions: DivisionOption[]
}

export default function ImportTeams({ tournamentId, divisions }: Props) {
  const router = useRouter()
  const [divisionId, setDivisionId] = useState<string>(divisions[0]?.id ?? '')
  const [csv, setCsv] = useState<string>('')
  const [outcomes, setOutcomes] = useState<RowOutcome[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    const text = await file.text()
    setCsv(text)
    setOutcomes(null); setSummary(null); setApplied(false); setError(null)
  }

  async function run(mode: 'preview' | 'apply') {
    if (!divisionId || !csv.trim()) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/divisions/${divisionId}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv, mode }),
        }
      )
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Import failed'); return }
      setOutcomes(json.outcomes)
      setSummary(json.summary)
      if (mode === 'apply') {
        setApplied(true)
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const hasPreview = outcomes !== null && summary !== null
  const canApply = hasPreview && !applied && (summary?.ok ?? 0) > 0

  if (divisions.length === 0) {
    return (
      <p className="text-sm text-brand-muted bg-yellow-50 border border-yellow-200 rounded-xl p-4">
        No active divisions yet. Create a division before importing teams.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-brand-border p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">
            Division
          </label>
          <select
            value={divisionId}
            onChange={e => { setDivisionId(e.target.value); setOutcomes(null); setApplied(false) }}
            className="input w-full"
          >
            {divisions.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.team_type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">
            CSV
          </label>
          <textarea
            value={csv}
            onChange={e => { setCsv(e.target.value); setOutcomes(null); setApplied(false) }}
            placeholder={SAMPLE_CSV}
            rows={8}
            className="input w-full font-mono text-xs resize-y"
          />
          <div className="flex items-center justify-between mt-2">
            <label className="text-xs text-brand-active hover:underline cursor-pointer">
              Upload .csv file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </label>
            <button
              type="button"
              onClick={() => setCsv(SAMPLE_CSV)}
              className="text-xs text-brand-muted hover:text-brand-dark hover:underline"
            >
              Insert sample
            </button>
          </div>
          <p className="text-[11px] text-brand-muted mt-2">
            Required column: <code>player1_email</code>. Optional:{' '}
            <code>player1_name</code>, <code>player2_email</code>, <code>player2_name</code>, <code>team_name</code>.
          </p>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={() => run('preview')}
          disabled={submitting || !csv.trim() || !divisionId}
          className="w-full py-2.5 rounded-xl bg-white border border-brand-border text-brand-dark font-semibold text-sm hover:bg-brand-soft disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting && !applied ? 'Checking…' : 'Preview'}
        </button>
      </div>

      {hasPreview && summary && (
        <div className="bg-white rounded-xl border border-brand-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-brand-dark">
              {applied ? 'Import complete' : 'Preview'}
            </h2>
            <span className="text-xs text-brand-muted">
              {summary.total} rows
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label={applied ? 'Created' : 'Will create'} value={applied ? summary.created : summary.ok} primary />
            <Stat label="No account" value={summary.missing_account} />
            <Stat label="Duplicates" value={summary.duplicate} />
            <Stat label="Invalid" value={summary.invalid} />
          </div>

          <div className="border border-brand-border rounded-lg divide-y divide-brand-border max-h-72 overflow-y-auto">
            {outcomes!.map(o => (
              <div key={o.rowIndex} className="px-3 py-2 flex items-center gap-2">
                <span className="w-6 shrink-0 text-[10px] font-bold text-brand-muted text-center">#{o.rowIndex}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-brand-dark truncate">
                    {o.teamName ? `${o.teamName} — ` : ''}{o.player1Email}
                    {o.player2Email ? ` + ${o.player2Email}` : ''}
                  </p>
                  {o.message && (
                    <p className="text-[10px] text-brand-muted truncate">{o.message}</p>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${STATUS_COLOR[o.status]}`}>
                  {STATUS_LABEL[o.status]}
                </span>
              </div>
            ))}
          </div>

          {!applied && (
            <button
              onClick={() => run('apply')}
              disabled={submitting || !canApply}
              className="w-full py-2.5 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Importing…' : `Import ${summary.ok} team${summary.ok !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${primary ? 'bg-brand-soft' : 'bg-gray-50'}`}>
      <p className={`text-lg font-bold ${primary ? 'text-brand-active' : 'text-brand-dark'} tabular-nums`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-brand-muted font-semibold">{label}</p>
    </div>
  )
}

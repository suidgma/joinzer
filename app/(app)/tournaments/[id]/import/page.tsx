'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, AlertCircle, Upload, FileUp } from 'lucide-react'
import { isDoublesFormat } from '@/lib/taxonomy/formats'

type CsvRow = {
  row: number
  email: string
  email2?: string
  team_name: string | null
  status: 'ok' | 'no_account' | 'duplicate' | 'invalid'
  player_name?: string
  player_name2?: string
  reason?: string
}

type Division = { id: string; name: string; format: string }

const SINGLES_SAMPLE = `email,team_name
player@example.com,Team Awesome
partner@example.com,Team Awesome`

const DOUBLES_SAMPLE = `team_name,player1_email,player2_email
Team Awesome,player1@example.com,player2@example.com
Dream Team,p3@example.com,p4@example.com`

const STATUS_ICON: Record<CsvRow['status'], React.ReactNode> = {
  ok: <CheckCircle size={14} className="text-green-500 shrink-0" />,
  no_account: <AlertCircle size={14} className="text-amber-500 shrink-0" />,
  duplicate: <AlertCircle size={14} className="text-yellow-500 shrink-0" />,
  invalid: <XCircle size={14} className="text-red-500 shrink-0" />,
}

const STATUS_LABEL: Record<CsvRow['status'], string> = {
  ok: 'Will import',
  no_account: 'No account',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
}

const STATUS_BADGE: Record<CsvRow['status'], string> = {
  ok: 'bg-green-50 text-green-700',
  no_account: 'bg-amber-50 text-amber-700',
  duplicate: 'bg-yellow-50 text-yellow-700',
  invalid: 'bg-red-50 text-red-700',
}

function SinglesPreviewRow({ row }: { row: CsvRow }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {STATUS_ICON[row.status]}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-brand-dark truncate">
          {row.player_name ? `${row.player_name} <${row.email}>` : row.email}
        </p>
        {row.team_name && <p className="text-[10px] text-brand-muted">{row.team_name}</p>}
        {row.reason && <p className="text-[10px] text-brand-muted">{row.reason}</p>}
      </div>
      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[row.status]}`}>
        {STATUS_LABEL[row.status]}
      </span>
    </div>
  )
}

function DoublesPreviewRow({ row }: { row: CsvRow }) {
  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          {row.team_name && (
            <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wide">{row.team_name}</p>
          )}
          <div className="flex items-center gap-1.5">
            {row.status === 'ok'
              ? <CheckCircle size={12} className="text-green-500 shrink-0" />
              : <span className="w-3 h-3 shrink-0" />}
            <p className="text-xs text-brand-dark truncate">
              {row.player_name ? `${row.player_name} <${row.email}>` : row.email}
            </p>
          </div>
          {row.email2 && (
            <div className="flex items-center gap-1.5">
              {row.status === 'ok'
                ? <CheckCircle size={12} className="text-green-500 shrink-0" />
                : <span className="w-3 h-3 shrink-0" />}
              <p className="text-xs text-brand-dark truncate">
                {row.player_name2 ? `${row.player_name2} <${row.email2}>` : row.email2}
              </p>
            </div>
          )}
          {row.reason && <p className="text-[10px] text-brand-muted mt-0.5">{row.reason}</p>}
        </div>
        <span className={`shrink-0 self-start text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      </div>
    </div>
  )
}

export default function ImportPage() {
  const params = useParams<{ id: string }>()
  const tournamentId = params.id

  const [divisions, setDivisions] = useState<Division[]>([])
  const [divisionId, setDivisionId] = useState('')
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<CsvRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ registered: number; stubs: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedDivision = divisions.find(d => d.id === divisionId) ?? null
  const isDoubles = isDoublesFormat(selectedDivision?.format ?? '')

  const okCount = rows?.filter(r => r.status === 'ok').length ?? 0
  const noAccountCount = rows?.filter(r => r.status === 'no_account').length ?? 0
  const committableCount = okCount + noAccountCount
  const needsTypedConfirm = noAccountCount > 25

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRows(null)
    const reader = new FileReader()
    reader.onload = (ev) => setCsv((ev.target?.result as string) ?? '')
    reader.readAsText(file)
  }

  useEffect(() => {
    fetch(`/api/tournaments/${tournamentId}/divisions`)
      .then(r => r.json())
      .then(json => {
        const divs: Division[] = (json.divisions ?? []).map((d: any) => ({
          id: d.id,
          name: d.name,
          format: d.format ?? '',
        }))
        setDivisions(divs)
        if (divs.length === 1) setDivisionId(divs[0].id)
      })
      .catch(() => {})
  }, [tournamentId])

  function handleDivisionChange(id: string) {
    setDivisionId(id)
    setRows(null)
    setResult(null)
    setError(null)
    setShowConfirm(false)
  }

  async function handlePreview() {
    if (!divisionId) { setError('Select a division first'); return }
    if (!csv.trim()) { setError('Paste CSV data first'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    setShowConfirm(false)
    const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${divisionId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setError(json.error ?? 'Preview failed'); return }
    setRows(json.rows)
  }

  async function handleCommit() {
    if (!rows || !divisionId) return
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${divisionId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    const json = await res.json()
    setLoading(false)
    setShowConfirm(false)
    setConfirmText('')
    if (!res.ok) { setError(json.error ?? 'Import failed'); return }
    setResult(json)
    setRows(null)
    setCsv('')
  }

  const sampleCsv = isDoubles ? DOUBLES_SAMPLE : SINGLES_SAMPLE

  return (
    <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/tournaments/${tournamentId}`} className="text-sm text-brand-muted hover:text-brand-dark">← Back</Link>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Import Players via CSV</h1>
      </div>

      <div className="bg-white border border-brand-border rounded-2xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Division</label>
          {divisions.length === 0 ? (
            <p className="text-xs text-brand-muted italic">No divisions found — add a division first.</p>
          ) : (
            <select
              value={divisionId}
              onChange={e => handleDivisionChange(e.target.value)}
              className="w-full input"
            >
              {divisions.length > 1 && <option value="">Select a division…</option>}
              {divisions.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-brand-muted">CSV Data</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-[10px] text-brand-active hover:underline"
              >
                <FileUp size={11} />
                Upload file
              </button>
              <button
                type="button"
                onClick={() => { setCsv(sampleCsv); setFileName(null) }}
                className="text-[10px] text-brand-active hover:underline"
              >
                Insert sample
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          {fileName && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-brand-soft rounded-xl">
              <FileUp size={13} className="text-brand-active shrink-0" />
              <span className="text-xs text-brand-dark truncate flex-1">{fileName}</span>
              <button
                type="button"
                onClick={() => { setCsv(''); setFileName(null); setRows(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-[10px] text-brand-muted hover:text-brand-dark shrink-0"
              >
                ✕
              </button>
            </div>
          )}
          <textarea
            value={csv}
            onChange={e => { setCsv(e.target.value); setRows(null); setFileName(null); setShowConfirm(false) }}
            placeholder={isDoubles
              ? 'team_name,player1_email,player2_email\nTeam A,p1@example.com,p2@example.com'
              : 'email,team_name\nplayer@example.com,Team A'}
            rows={6}
            className="w-full input resize-none font-mono text-xs"
          />
          <p className="text-[10px] text-brand-muted mt-1">
            {isDoubles
              ? <>Required columns: <code>player1_email</code>, <code>player2_email</code>. Optional: <code>team_name</code>. Header row required.</>
              : <>Required column: <code>email</code>. Optional: <code>team_name</code>. Header row optional.</>}
          </p>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {result != null && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-green-700">
              ✓ {result.registered} player{result.registered !== 1 ? 's' : ''} registered
              {result.stubs > 0 && `, ${result.stubs} invite${result.stubs !== 1 ? 's' : ''} sent`}.
            </p>
          </div>
        )}

        {/* Confirm modal */}
        {showConfirm && rows && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-brand-dark">
              {okCount > 0 && `${okCount} existing player${okCount !== 1 ? 's' : ''} will be registered`}
              {okCount > 0 && noAccountCount > 0 && ', '}
              {noAccountCount > 0 && `${noAccountCount} new account${noAccountCount !== 1 ? 's' : ''} will be created and invited`}
              .
            </p>
            {needsTypedConfirm && (
              <div className="space-y-1">
                <p className="text-xs text-amber-700">
                  Over 25 new accounts — type <strong>IMPORT</strong> to confirm.
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="IMPORT"
                  className="w-full input text-sm"
                  autoFocus
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowConfirm(false); setConfirmText('') }}
                className="flex-1 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:text-brand-dark transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={loading || (needsTypedConfirm && confirmText !== 'IMPORT')}
                className="flex-1 py-2 rounded-xl bg-brand-dark text-white text-sm font-semibold disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {loading ? 'Importing…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}

        {!showConfirm && (
          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={loading || !divisionId}
              className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {loading ? 'Checking…' : 'Preview'}
            </button>
            {rows && committableCount > 0 && (
              <button
                onClick={() => setShowConfirm(true)}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <Upload size={14} />
                Import {committableCount}
              </button>
            )}
          </div>
        )}
      </div>

      {rows && (
        <div className="space-y-2">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
            Preview — {rows.length} {isDoubles ? `team${rows.length !== 1 ? 's' : ''}` : `row${rows.length !== 1 ? 's' : ''}`}
          </h2>
          <div className="bg-white border border-brand-border rounded-xl divide-y divide-brand-border overflow-hidden">
            {rows.map(row =>
              isDoubles
                ? <DoublesPreviewRow key={row.row} row={row} />
                : <SinglesPreviewRow key={row.row} row={row} />
            )}
          </div>
        </div>
      )}
    </main>
  )
}

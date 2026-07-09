'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { CheckCircle, XCircle, AlertCircle, Upload, FileUp, Info, Download, HelpCircle, ChevronDown } from 'lucide-react'

type PlayerRow = {
  row: number
  email: string
  name: string | null
  skill: number | null
  gender: string | null
  phone: string | null
  status: 'ok' | 'no_account' | 'duplicate' | 'invalid'
  player_name?: string | null
  reason?: string
}
type ParseResult = { rows: PlayerRow[]; unknownColumns: string[]; headerError?: string }
type CommitResult = { registered: number; stubs: number }

const SAMPLE_CSV = `email,name,skill,gender,phone
alex@example.com,Alex Wong,3.5,male,702-555-0100
jordan@example.com,Jordan Lee,3.5,female,
sam@example.com,Sam Patel,4.0,male,`

const STATUS_ICON: Record<PlayerRow['status'], React.ReactNode> = {
  ok: <CheckCircle size={14} className="text-green-500 shrink-0" />,
  no_account: <AlertCircle size={14} className="text-amber-500 shrink-0" />,
  duplicate: <AlertCircle size={14} className="text-yellow-500 shrink-0" />,
  invalid: <XCircle size={14} className="text-red-500 shrink-0" />,
}
const STATUS_LABEL: Record<PlayerRow['status'], string> = {
  ok: 'Will register', no_account: 'New account', duplicate: 'Duplicate', invalid: 'Invalid',
}
const STATUS_BADGE: Record<PlayerRow['status'], string> = {
  ok: 'bg-green-50 text-green-700', no_account: 'bg-amber-50 text-amber-700',
  duplicate: 'bg-yellow-50 text-yellow-700', invalid: 'bg-red-50 text-red-700',
}

function playerLabel(r: PlayerRow): string {
  const name = r.player_name || r.name
  if (!r.email) return '—'
  return name ? `${name} <${r.email}>` : r.email
}

export default function LeagueImportForm({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const [showGuide, setShowGuide] = useState(false)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CommitResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rows = parseResult?.rows ?? null
  const okCount = rows?.filter((r) => r.status === 'ok').length ?? 0
  const newCount = rows?.filter((r) => r.status === 'no_account').length ?? 0
  const duplicateCount = rows?.filter((r) => r.status === 'duplicate').length ?? 0
  const invalidCount = rows?.filter((r) => r.status === 'invalid').length ?? 0
  const committableCount = okCount + newCount
  const needsTypedConfirm = newCount > 25

  function downloadTemplate() {
    const BOM = '﻿'
    const blob = new Blob([BOM + SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const slug = leagueName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug || 'league'}-import-template.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => setCsv((ev.target?.result as string) ?? '')
    reader.readAsText(file)
  }

  async function handlePreview() {
    if (!csv.trim()) { setError('Paste CSV data first'); return }
    setLoading(true); setError(null); setResult(null); setShowConfirm(false)
    const res = await fetch(`/api/leagues/${leagueId}/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
    })
    const json = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(json.error ?? `Preview failed (HTTP ${res.status})`); return }
    setParseResult(json as ParseResult)
  }

  async function handleCommit() {
    if (!rows) return
    setLoading(true); setError(null)
    const res = await fetch(`/api/leagues/${leagueId}/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
    })
    const json = await res.json().catch(() => ({}))
    setLoading(false); setShowConfirm(false); setConfirmText('')
    if (!res.ok) { setError(json.error ?? `Import failed (HTTP ${res.status})`); return }
    setResult(json as CommitResult)
    setParseResult(null); setCsv(''); setFileName(null)
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/leagues/${leagueId}`} className="text-sm text-brand-muted hover:text-brand-dark">← Back</Link>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Import Players via CSV</h1>
        <span className="text-sm text-brand-muted">— {leagueName}</span>
      </div>

      {/* How-to guide */}
      <div className="bg-brand-soft border border-brand-border rounded-2xl overflow-hidden">
        <button type="button" onClick={() => setShowGuide((v) => !v)} className="w-full flex items-center justify-between gap-2 px-5 py-3.5 text-left">
          <span className="flex items-center gap-2 text-sm font-semibold text-brand-dark">
            <HelpCircle size={16} className="text-brand-active" />
            How does importing work?
          </span>
          <ChevronDown size={16} className={`text-brand-muted transition-transform ${showGuide ? 'rotate-180' : ''}`} />
        </button>
        {showGuide && (
          <div className="px-5 pb-5 pt-1 space-y-3 text-xs text-brand-dark">
            <p className="text-brand-muted">Add many players to this league at once from a spreadsheet. Nothing is saved until you preview and confirm.</p>
            <ol className="space-y-2">
              <li><strong>1. Download the template</strong>{' '}and open it in Excel or Google Sheets.</li>
              <li><strong>2. Fill in your players</strong>{' '}— one per row. Only <code>email</code> is required; <code>name</code>, <code>skill</code> (DUPR), <code>gender</code>, and <code>phone</code> are optional.</li>
              <li><strong>3. Upload or paste</strong>{' '}the file and press <strong>Preview</strong>.</li>
              <li><strong>4. Review &amp; import</strong>{' '}— each row is color-coded before anything is written.</li>
            </ol>
            <p className="text-[11px] text-brand-muted border-t border-brand-border pt-3">
              Players without a Joinzer account are created automatically and emailed a magic-link invite. For doubles leagues, import the individual players here — assign partners afterward on the Roster page.
            </p>
          </div>
        )}
      </div>

      <div className="bg-white border border-brand-border rounded-2xl p-5 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-brand-muted">CSV Data</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={downloadTemplate} className="flex items-center gap-1 text-[10px] text-brand-active hover:underline"><Download size={11} /> Download template</button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-[10px] text-brand-active hover:underline"><FileUp size={11} /> Upload file</button>
              <button type="button" onClick={() => { setCsv(SAMPLE_CSV); setFileName(null); setParseResult(null) }} className="text-[10px] text-brand-active hover:underline">Insert sample</button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          {fileName && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-brand-soft rounded-xl">
              <FileUp size={13} className="text-brand-active shrink-0" />
              <span className="text-xs text-brand-dark truncate flex-1">{fileName}</span>
              <button type="button" onClick={() => { setCsv(''); setFileName(null); setParseResult(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-[10px] text-brand-muted hover:text-brand-dark shrink-0">✕</button>
            </div>
          )}
          <textarea
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setParseResult(null); setFileName(null); setShowConfirm(false) }}
            placeholder={'email,name,skill,gender,phone\nalex@x.com,Alex Wong,3.5,male,702-555-0100'}
            rows={8} spellCheck={false}
            className="w-full input resize-y font-mono text-xs"
          />
          <p className="text-[10px] text-brand-muted mt-1">
            Required: <code>email</code>. Optional: <code>name</code>, <code>skill</code>, <code>gender</code>, <code>phone</code>. One player per row.
          </p>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {parseResult?.headerError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-red-700">CSV header error</p>
            <p className="text-xs text-red-700 mt-1">{parseResult.headerError}</p>
          </div>
        )}

        {parseResult?.unknownColumns && parseResult.unknownColumns.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-2">
            <Info size={14} className="text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800">Ignored unknown columns: {parseResult.unknownColumns.map((c) => <code key={c} className="mx-1">{c}</code>)}</p>
          </div>
        )}

        {/* Confirm */}
        {showConfirm && rows && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-brand-dark">
              {okCount > 0 && `${okCount} existing player${okCount !== 1 ? 's' : ''} will be registered`}
              {okCount > 0 && newCount > 0 && ', '}
              {newCount > 0 && `${newCount} new account${newCount !== 1 ? 's' : ''} will be created (invites sent on live leagues only)`}.
            </p>
            {needsTypedConfirm && (
              <div className="space-y-1">
                <p className="text-xs text-amber-700">Over 25 new accounts — type <strong>IMPORT</strong> to confirm.</p>
                <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="IMPORT" className="w-full input text-sm" autoFocus />
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowConfirm(false); setConfirmText('') }} className="flex-1 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:text-brand-dark transition-colors">Cancel</button>
              <button type="button" onClick={handleCommit} disabled={loading || (needsTypedConfirm && confirmText !== 'IMPORT')} className="flex-1 py-2 rounded-xl bg-brand-dark text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                {loading ? 'Importing…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}

        {!showConfirm && (
          <div className="flex gap-2">
            <button onClick={handlePreview} disabled={loading || !csv.trim()} className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors">
              {loading ? 'Checking…' : 'Preview'}
            </button>
            {rows && committableCount > 0 && (
              <button onClick={() => setShowConfirm(true)} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                <Upload size={14} /> Import {committableCount}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Result modal */}
      {result != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" onClick={() => setResult(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-brand-border flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
              <h2 className="text-base font-bold text-brand-dark">Import complete</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm font-semibold text-brand-dark">
                {result.registered} player{result.registered !== 1 ? 's' : ''} registered
                {result.stubs > 0 && ` · ${result.stubs} new account${result.stubs !== 1 ? 's' : ''} created`}
              </p>
              {result.stubs > 0 && <p className="text-xs text-brand-muted">Each new account gets a magic-link invite (skipped on dummy leagues).</p>}
            </div>
            <div className="px-5 py-3 border-t border-brand-border bg-brand-surface flex justify-end gap-2">
              <button onClick={() => { setResult(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="px-3 py-1.5 rounded-lg border border-brand-border text-brand-muted text-sm font-semibold hover:bg-brand-soft transition-colors">Import more</button>
              <Link href={`/leagues/${leagueId}`} className="px-3 py-1.5 rounded-lg bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors">View league →</Link>
            </div>
          </div>
        </div>
      )}

      {/* Preview list */}
      {rows && rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Preview — {rows.length} row{rows.length !== 1 ? 's' : ''}</h2>
            <div className="flex items-center gap-3 text-[10px] font-semibold">
              {okCount > 0 && <span className="text-green-700">{okCount} ready</span>}
              {newCount > 0 && <span className="text-amber-700">{newCount} new</span>}
              {duplicateCount > 0 && <span className="text-yellow-700">{duplicateCount} dup</span>}
              {invalidCount > 0 && <span className="text-red-700">{invalidCount} invalid</span>}
            </div>
          </div>
          <div className="bg-white border border-brand-border rounded-xl divide-y divide-brand-border overflow-hidden">
            {rows.map((row) => (
              <div key={row.row} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    {STATUS_ICON[row.status]}
                    <p className="text-xs text-brand-dark truncate">{playerLabel(row)}</p>
                  </div>
                  {row.reason && <p className="text-[10px] text-brand-muted ml-5">{row.reason}</p>}
                </div>
                <span className={`shrink-0 self-start text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

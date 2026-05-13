'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, AlertCircle, Upload, FileUp } from 'lucide-react'

type CsvRow = {
  row: number
  email: string
  team_name: string | null
  status: 'ok' | 'unknown_email' | 'duplicate' | 'invalid'
  player_name?: string
  reason?: string
}

type Division = { id: string; name: string }

const SAMPLE_CSV = `email,team_name
player@example.com,Team Awesome
partner@example.com,Team Awesome`

const STATUS_ICON = {
  ok: <CheckCircle size={14} className="text-green-500 shrink-0" />,
  unknown_email: <XCircle size={14} className="text-red-500 shrink-0" />,
  duplicate: <AlertCircle size={14} className="text-yellow-500 shrink-0" />,
  invalid: <XCircle size={14} className="text-red-500 shrink-0" />,
}

const STATUS_LABEL = {
  ok: 'Will import',
  unknown_email: 'No account',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
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
  const [applied, setApplied] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        const divs: Division[] = (json.divisions ?? []).map((d: any) => ({ id: d.id, name: d.name }))
        setDivisions(divs)
        if (divs.length === 1) setDivisionId(divs[0].id)
      })
      .catch(() => {})
  }, [tournamentId])

  async function handlePreview() {
    if (!divisionId) { setError('Select a division first'); return }
    if (!csv.trim()) { setError('Paste CSV data first'); return }
    setLoading(true)
    setError(null)
    setApplied(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${divisionId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv, mode: 'preview' }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setError(json.error ?? 'Preview failed'); return }
    setRows(json.rows)
  }

  async function handleApply() {
    if (!rows || !divisionId) return
    if (!confirm(`Import ${rows.filter(r => r.status === 'ok').length} players?`)) return
    setLoading(true)
    const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${divisionId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv, mode: 'apply' }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setError(json.error ?? 'Import failed'); return }
    setApplied(json.created)
    setRows(null)
    setCsv('')
  }

  const okCount = rows?.filter(r => r.status === 'ok').length ?? 0

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
              onChange={e => setDivisionId(e.target.value)}
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
                onClick={() => { setCsv(SAMPLE_CSV); setFileName(null) }}
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
            onChange={e => { setCsv(e.target.value); setRows(null); setFileName(null) }}
            placeholder={'email,team_name\nplayer@example.com,Team A'}
            rows={6}
            className="w-full input resize-none font-mono text-xs"
          />
          <p className="text-[10px] text-brand-muted mt-1">
            Required column: <code>email</code>. Optional: <code>team_name</code>. Header row optional.
          </p>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {applied != null && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-green-700">✓ {applied} player{applied !== 1 ? 's' : ''} imported successfully.</p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handlePreview}
            disabled={loading || !divisionId}
            className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {loading ? 'Checking…' : 'Preview'}
          </button>
          {rows && okCount > 0 && (
            <button
              onClick={handleApply}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <Upload size={14} />
              Import {okCount}
            </button>
          )}
        </div>
      </div>

      {rows && (
        <div className="space-y-2">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
            Preview — {rows.length} row{rows.length !== 1 ? 's' : ''}
          </h2>
          <div className="bg-white border border-brand-border rounded-xl divide-y divide-brand-border overflow-hidden">
            {rows.map(row => (
              <div key={row.row} className="flex items-center gap-3 px-4 py-3">
                {STATUS_ICON[row.status]}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-brand-dark truncate">
                    {row.player_name ? `${row.player_name} <${row.email}>` : row.email}
                  </p>
                  {row.team_name && <p className="text-[10px] text-brand-muted">{row.team_name}</p>}
                  {row.reason && <p className="text-[10px] text-brand-muted">{row.reason}</p>}
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  row.status === 'ok' ? 'bg-green-50 text-green-700' :
                  row.status === 'duplicate' ? 'bg-yellow-50 text-yellow-700' :
                  'bg-red-50 text-red-700'
                }`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

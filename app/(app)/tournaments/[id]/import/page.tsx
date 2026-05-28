'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, AlertCircle, Upload, FileUp, Info } from 'lucide-react'

type PlayerData = {
  email: string
  name?: string | null
  phone?: string | null
  gender?: string | null
  dupr_rating?: number | null
}

type MultiDivRow = {
  row: number
  divisionInput: string
  divisionId?: string
  divisionName?: string
  divisionFormat?: string
  isDoubles?: boolean
  player1: PlayerData
  player2?: PlayerData
  team_name: string | null
  status: 'ok' | 'no_account' | 'duplicate' | 'invalid'
  reason?: string
  user_id?: string
  user_id2?: string
}

type ParseResult = {
  rows: MultiDivRow[]
  unknownColumns: string[]
  headerError?: string
}

type CommitResult = {
  registered: number
  stubs: number
  byDivision: Record<string, { name: string; registered: number; stubs: number }>
}

const SAMPLE_CSV = `division,player1_email,player1_name,player1_skill,player2_email,player2_name,player2_skill,team_name
Pro Max,alex@example.com,Alex Wong,3.5,jordan@example.com,Jordan Lee,3.5,The Smashers
Pro Max,sam@example.com,Sam Patel,4.0,riley@example.com,Riley Garcia,3.5,
Open Singles,casey@example.com,Casey Park,4.0,,,,`

const STATUS_ICON: Record<MultiDivRow['status'], React.ReactNode> = {
  ok: <CheckCircle size={14} className="text-green-500 shrink-0" />,
  no_account: <AlertCircle size={14} className="text-amber-500 shrink-0" />,
  duplicate: <AlertCircle size={14} className="text-yellow-500 shrink-0" />,
  invalid: <XCircle size={14} className="text-red-500 shrink-0" />,
}

const STATUS_LABEL: Record<MultiDivRow['status'], string> = {
  ok: 'Will register',
  no_account: 'New account',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
}

const STATUS_BADGE: Record<MultiDivRow['status'], string> = {
  ok: 'bg-green-50 text-green-700',
  no_account: 'bg-amber-50 text-amber-700',
  duplicate: 'bg-yellow-50 text-yellow-700',
  invalid: 'bg-red-50 text-red-700',
}

// ─── Preview row ──────────────────────────────────────────────────────────────

function playerLabel(p: PlayerData): string {
  if (!p.email) return '—'
  if (p.name) return `${p.name} <${p.email}>`
  return p.email
}

function PreviewRow({ row }: { row: MultiDivRow }) {
  const isDoubles = !!row.isDoubles
  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          {row.team_name && (
            <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wide">{row.team_name}</p>
          )}
          <div className="flex items-center gap-1.5">
            {STATUS_ICON[row.status]}
            <p className="text-xs text-brand-dark truncate">{playerLabel(row.player1)}</p>
          </div>
          {isDoubles && row.player2 && (
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 shrink-0" />
              <p className="text-xs text-brand-dark truncate">{playerLabel(row.player2)}</p>
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

// ─── Per-division group ───────────────────────────────────────────────────────

type DivisionGroup = {
  key: string                 // divisionId or "__unresolved__"
  name: string                // display name (CSV input if unresolved)
  rows: MultiDivRow[]
  okCount: number
  newCount: number
  duplicateCount: number
  invalidCount: number
}

function groupRowsByDivision(rows: MultiDivRow[]): DivisionGroup[] {
  const map = new Map<string, DivisionGroup>()
  for (const r of rows) {
    const key = r.divisionId ?? `__unresolved__:${r.divisionInput.toLowerCase()}`
    const name = r.divisionName ?? (r.divisionInput || '(no division)')
    let g = map.get(key)
    if (!g) {
      g = { key, name, rows: [], okCount: 0, newCount: 0, duplicateCount: 0, invalidCount: 0 }
      map.set(key, g)
    }
    g.rows.push(r)
    if (r.status === 'ok') g.okCount++
    else if (r.status === 'no_account') g.newCount++
    else if (r.status === 'duplicate') g.duplicateCount++
    else g.invalidCount++
  }
  // Stable sort: resolved divisions alphabetically, then unresolved at the bottom
  return Array.from(map.values()).sort((a, b) => {
    const aUnresolved = a.key.startsWith('__unresolved__')
    const bUnresolved = b.key.startsWith('__unresolved__')
    if (aUnresolved !== bUnresolved) return aUnresolved ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const params = useParams<{ id: string }>()
  const tournamentId = params.id

  const [tournamentName, setTournamentName] = useState<string | null>(null)
  const [knownDivisions, setKnownDivisions] = useState<string[]>([])

  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CommitResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch tournament name + division names for the header + hint
  useEffect(() => {
    Promise.all([
      fetch(`/api/tournaments/${tournamentId}`).then(r => r.json()).catch(() => null),
      fetch(`/api/tournaments/${tournamentId}/divisions`).then(r => r.json()).catch(() => null),
    ]).then(([t, d]) => {
      const name = t?.tournament?.name ?? t?.name ?? null
      if (name) setTournamentName(name)
      const divs = (d?.divisions ?? []).map((x: { name: string }) => x.name).filter(Boolean)
      setKnownDivisions(divs)
    })
  }, [tournamentId])

  const rows = parseResult?.rows ?? null
  const groups = useMemo(() => rows ? groupRowsByDivision(rows) : [], [rows])

  const okCount = rows?.filter(r => r.status === 'ok').length ?? 0
  const newCount = rows?.filter(r => r.status === 'no_account').length ?? 0
  const duplicateCount = rows?.filter(r => r.status === 'duplicate').length ?? 0
  const invalidCount = rows?.filter(r => r.status === 'invalid').length ?? 0
  const committableCount = okCount + newCount
  const needsTypedConfirm = newCount > 25

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
    setLoading(true)
    setError(null)
    setResult(null)
    setShowConfirm(false)
    const res = await fetch(`/api/tournaments/${tournamentId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    })
    const json = await res.json().catch(() => ({} as { error?: string }))
    setLoading(false)
    if (!res.ok) { setError(json.error ?? `Preview failed (HTTP ${res.status})`); return }
    setParseResult(json as ParseResult)
  }

  async function handleCommit() {
    if (!rows) return
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    const json = await res.json().catch(() => ({} as { error?: string }))
    setLoading(false)
    setShowConfirm(false)
    setConfirmText('')
    if (!res.ok) { setError(json.error ?? `Import failed (HTTP ${res.status})`); return }
    setResult(json as CommitResult)
    setParseResult(null)
    setCsv('')
    setFileName(null)
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/tournaments/${tournamentId}`} className="text-sm text-brand-muted hover:text-brand-dark">← Back</Link>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Import Players via CSV</h1>
        {tournamentName && (
          <span className="text-sm text-brand-muted">— {tournamentName}</span>
        )}
      </div>

      <div className="bg-white border border-brand-border rounded-2xl p-5 space-y-4">
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
                onClick={() => { setCsv(SAMPLE_CSV); setFileName(null); setParseResult(null) }}
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
                onClick={() => { setCsv(''); setFileName(null); setParseResult(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-[10px] text-brand-muted hover:text-brand-dark shrink-0"
              >
                ✕
              </button>
            </div>
          )}
          <textarea
            value={csv}
            onChange={e => { setCsv(e.target.value); setParseResult(null); setFileName(null); setShowConfirm(false) }}
            placeholder={'division,player1_email,player1_name,player1_skill,player2_email,player2_name,player2_skill,team_name\nPro Max,alex@x.com,Alex,3.5,jordan@x.com,Jordan,3.5,The Smashers'}
            rows={8}
            spellCheck={false}
            className="w-full input resize-y font-mono text-xs"
          />
          <p className="text-[10px] text-brand-muted mt-1">
            Required: <code>division</code>, <code>player1_email</code>.
            Optional: <code>player1_name</code>, <code>player1_skill</code>, <code>player1_phone</code>, <code>player1_gender</code>,
            <code> player2_email</code> (etc), <code>team_name</code>.
            Doubles divisions need both player columns.
          </p>
          {knownDivisions.length > 0 && (
            <p className="text-[10px] text-brand-muted mt-1">
              Use these division names: {knownDivisions.map((n, i) => (
                <span key={n}>
                  <code>{n}</code>{i < knownDivisions.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
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
            <p className="text-xs text-blue-800">
              Ignored unknown columns: {parseResult.unknownColumns.map(c => <code key={c} className="mx-1">{c}</code>)}
              <br />
              <span className="text-blue-600">
                If one of these should be imported, rename it to a recognized header.
              </span>
            </p>
          </div>
        )}

        {result != null && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 space-y-1">
            <p className="text-sm font-semibold text-green-700">
              ✓ {result.registered} registration{result.registered !== 1 ? 's' : ''} added
              {result.stubs > 0 && ` · ${result.stubs} invite${result.stubs !== 1 ? 's' : ''} sent`}
            </p>
            {Object.entries(result.byDivision).length > 0 && (
              <ul className="text-[11px] text-green-700 mt-1 space-y-0.5">
                {Object.entries(result.byDivision).map(([id, d]) => (
                  <li key={id}>
                    {d.name}: {d.registered} added{d.stubs > 0 && `, ${d.stubs} invited`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Confirm modal */}
        {showConfirm && rows && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-brand-dark">
              {okCount > 0 && `${okCount} existing player${okCount !== 1 ? 's' : ''} will be registered`}
              {okCount > 0 && newCount > 0 && ', '}
              {newCount > 0 && `${newCount} new account${newCount !== 1 ? 's' : ''} will be created and invited`}
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
              disabled={loading || !csv.trim()}
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

      {rows && rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
              Preview — {rows.length} row{rows.length !== 1 ? 's' : ''} across {groups.length} division{groups.length !== 1 ? 's' : ''}
            </h2>
            <div className="flex items-center gap-3 text-[10px] font-semibold">
              {okCount > 0 && <span className="text-green-700">{okCount} ready</span>}
              {newCount > 0 && <span className="text-amber-700">{newCount} new</span>}
              {duplicateCount > 0 && <span className="text-yellow-700">{duplicateCount} dup</span>}
              {invalidCount > 0 && <span className="text-red-700">{invalidCount} invalid</span>}
            </div>
          </div>

          {groups.map(group => {
            const unresolved = group.key.startsWith('__unresolved__')
            return (
              <div key={group.key} className="bg-white border border-brand-border rounded-xl overflow-hidden">
                <div className={`px-4 py-2.5 border-b border-brand-border flex items-center justify-between ${unresolved ? 'bg-red-50' : 'bg-brand-soft'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${unresolved ? 'text-red-700' : 'text-brand-dark'}`}>
                      {unresolved ? `⚠ Unknown division: "${group.name}"` : group.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold">
                    {group.okCount > 0 && <span className="text-green-700">{group.okCount} ready</span>}
                    {group.newCount > 0 && <span className="text-amber-700">{group.newCount} new</span>}
                    {group.duplicateCount > 0 && <span className="text-yellow-700">{group.duplicateCount} dup</span>}
                    {group.invalidCount > 0 && <span className="text-red-700">{group.invalidCount} invalid</span>}
                  </div>
                </div>
                <div className="divide-y divide-brand-border">
                  {group.rows.map(row => <PreviewRow key={row.row} row={row} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

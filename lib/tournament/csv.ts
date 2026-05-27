// Minimal RFC 4180-ish CSV parser. Handles:
//   • comma-separated fields
//   • "quoted fields" with embedded commas, newlines, and escaped "" quotes
//   • \r\n or \n line endings
//   • trailing whitespace per row
//
// Returns rows as arrays of strings. Empty rows are dropped.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }

    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue } // ignore CR; \n will close the row
    if (ch === '\n') {
      row.push(field); field = ''
      if (row.some(c => c.trim().length > 0)) rows.push(row)
      row = []
      i++; continue
    }
    field += ch; i++
  }

  // flush final field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some(c => c.trim().length > 0)) rows.push(row)
  }

  return rows
}

export type ParsedTeamRow = {
  rowIndex: number       // 1-based, excluding header
  player1Email: string
  player1Name: string | null
  player2Email: string | null
  player2Name: string | null
  teamName: string | null
}

/**
 * Parse CSV expecting headers (case-insensitive, normalized to snake_case):
 *   player1_email, player1_name, player2_email, player2_name, team_name
 *
 * player1_email is required. Other columns are optional. Unknown columns are ignored.
 */
export function parseTeamCsv(text: string): { rows: ParsedTeamRow[]; error: string | null } {
  const parsed = parseCsv(text)
  if (parsed.length === 0) return { rows: [], error: 'CSV is empty' }

  const headerRow = parsed[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const idx = {
    p1e: headerRow.indexOf('player1_email'),
    p1n: headerRow.indexOf('player1_name'),
    p2e: headerRow.indexOf('player2_email'),
    p2n: headerRow.indexOf('player2_name'),
    team: headerRow.indexOf('team_name'),
  }
  if (idx.p1e === -1) {
    return { rows: [], error: 'CSV must include a "player1_email" column' }
  }

  const rows: ParsedTeamRow[] = []
  for (let i = 1; i < parsed.length; i++) {
    const r = parsed[i]
    const p1e = (r[idx.p1e] ?? '').trim().toLowerCase()
    if (!p1e) continue
    rows.push({
      rowIndex: i,
      player1Email: p1e,
      player1Name: idx.p1n >= 0 ? (r[idx.p1n] ?? '').trim() || null : null,
      player2Email: idx.p2e >= 0 ? ((r[idx.p2e] ?? '').trim().toLowerCase() || null) : null,
      player2Name: idx.p2n >= 0 ? (r[idx.p2n] ?? '').trim() || null : null,
      teamName: idx.team >= 0 ? (r[idx.team] ?? '').trim() || null : null,
    })
  }
  return { rows, error: null }
}

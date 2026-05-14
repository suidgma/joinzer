import { createClient as createAdmin } from '@supabase/supabase-js'

const db = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type CsvRow = {
  row: number
  email: string
  team_name: string | null
  status: 'ok' | 'unknown_email' | 'duplicate' | 'invalid'
  user_id?: string
  player_name?: string
  reason?: string
}

// Strip +suffix aliases (e.g. foo+test@gmail.com → foo@gmail.com) and normalize case.
// Gmail and many providers ignore +suffixes; normalizing prevents false "No account" hits.
function normalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase()
  const at = lower.indexOf('@')
  if (at === -1) return lower
  return lower.slice(0, at).replace(/\+.*$/, '') + lower.slice(at)
}

/**
 * Parse CSV text and classify each row.
 * Expected columns (header optional): email, team_name
 * Returns classified rows ready for preview or apply.
 */
export async function parseCsvRows(
  csvText: string,
  tournamentId: string,
  divisionId: string
): Promise<CsvRow[]> {
  const service = db()
  const lines = csvText.trim().split(/\r?\n/)
  if (lines.length === 0) return []

  // Detect header
  const firstLine = lines[0].toLowerCase()
  const hasHeader = firstLine.includes('email')
  const dataLines = hasHeader ? lines.slice(1) : lines

  // Fetch auth users and existing registrations once — not inside the row loop
  const [{ data: userList }, { data: existingRegs }] = await Promise.all([
    service.auth.admin.listUsers({ perPage: 1000 }),
    service
      .from('tournament_registrations')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .eq('division_id', divisionId)
      .neq('status', 'cancelled'),
  ])

  // Build a normalized-email → auth user map for O(1) lookups per row
  const userByNormalizedEmail = new Map(
    (userList?.users ?? []).map(u => [normalizeEmail(u.email ?? ''), u])
  )
  const existingUserIds = new Set((existingRegs ?? []).map(r => r.user_id))
  const seenNormalized = new Set<string>()

  const results: CsvRow[] = []

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim()
    if (!line) continue

    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''))
    const rawEmail = parts[0] ?? ''
    const team_name = parts[1] ?? null

    if (!rawEmail || !rawEmail.includes('@')) {
      results.push({ row: i + 1, email: rawEmail, team_name, status: 'invalid', reason: 'Invalid email' })
      continue
    }

    const normalized = normalizeEmail(rawEmail)

    if (seenNormalized.has(normalized)) {
      results.push({ row: i + 1, email: rawEmail, team_name, status: 'duplicate', reason: 'Same email appears twice in CSV' })
      continue
    }
    seenNormalized.add(normalized)

    const authUser = userByNormalizedEmail.get(normalized)

    if (!authUser) {
      results.push({ row: i + 1, email: rawEmail, team_name, status: 'unknown_email', reason: 'No Joinzer account with this email' })
      continue
    }

    if (existingUserIds.has(authUser.id)) {
      results.push({ row: i + 1, email: rawEmail, team_name, status: 'duplicate', reason: 'Already registered in this division', user_id: authUser.id })
      continue
    }

    const { data: profile } = await service.from('profiles').select('name').eq('id', authUser.id).single()

    results.push({
      row: i + 1,
      email: rawEmail,
      team_name: team_name || null,
      status: 'ok',
      user_id: authUser.id,
      player_name: profile?.name ?? null,
    })
  }

  return results
}

/** Insert only the 'ok' rows as registrations */
export async function applyCsvRows(
  rows: CsvRow[],
  tournamentId: string,
  divisionId: string
): Promise<number> {
  const service = db()
  const okRows = rows.filter(r => r.status === 'ok' && r.user_id)

  if (okRows.length === 0) return 0

  const inserts = okRows.map(r => ({
    tournament_id: tournamentId,
    division_id: divisionId,
    user_id: r.user_id!,
    team_name: r.team_name ?? null,
    status: 'registered',
    registration_type: 'solo',
    payment_status: 'waived',
  }))

  const { error } = await service.from('tournament_registrations').insert(inserts)
  if (error) throw new Error(error.message)
  return okRows.length
}

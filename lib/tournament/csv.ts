import { createClient as createAdmin, type User } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { normalizeEmail, createStub } from '@/lib/users/stubs'
import { getSiteUrl } from '@/lib/utils/site-url'

const db = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type CsvRow = {
  row: number
  email: string           // singles: the player; doubles: player 1
  email2?: string         // doubles only: player 2
  team_name: string | null
  // Status precedence (most blocking wins): invalid → duplicate → no_account → ok
  status: 'ok' | 'no_account' | 'duplicate' | 'invalid'
  user_id?: string
  user_id2?: string
  player_name?: string
  player_name2?: string
  reason?: string
}

// Fetch every auth user — loops pages so we never silently miss users beyond the first page.
async function listAllAuthUsers(service: ReturnType<typeof db>): Promise<User[]> {
  const all: User[] = []
  let page = 1
  const perPage = 1000
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    all.push(...data.users)
    if (data.users.length < perPage) break
    page++
  }
  return all
}


async function parseDoublesRows(
  lines: string[],
  tournamentId: string,
  divisionId: string,
  service: ReturnType<typeof db>
): Promise<CsvRow[]> {
  const firstLine = lines[0]?.toLowerCase() ?? ''
  const hasHeader = firstLine.includes('player1') || firstLine.includes('player2')

  if (!hasHeader) {
    return [{
      row: 0,
      email: '',
      team_name: null,
      status: 'invalid',
      reason: 'Doubles CSV requires a header row. Expected columns: team_name, player1_email, player2_email',
    }]
  }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const teamIdx = headers.findIndex(h => h === 'team_name' || h === 'team')
  const p1Idx = headers.findIndex(h => h === 'player1_email' || h === 'player1')
  const p2Idx = headers.findIndex(h => h === 'player2_email' || h === 'player2')

  if (p1Idx === -1 || p2Idx === -1) {
    return [{
      row: 0,
      email: '',
      team_name: null,
      status: 'invalid',
      reason: `Missing required columns. Need: player1_email, player2_email. Found: ${headers.join(', ')}`,
    }]
  }

  const dataLines = lines.slice(1).filter(l => l.trim())
  if (dataLines.length === 0) return []

  const [allUsers, { data: existingRegs }] = await Promise.all([
    listAllAuthUsers(service),
    service
      .from('tournament_registrations')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .eq('division_id', divisionId)
      .neq('status', 'cancelled'),
  ])

  const userByNormEmail = new Map(
    allUsers.map(u => [normalizeEmail(u.email ?? ''), u])
  )
  const existingUserIds = new Set((existingRegs ?? []).map(r => r.user_id))
  // Track all seen emails across rows so the same player can't appear in two teams
  const seenNormalized = new Set<string>()

  const results: CsvRow[] = []

  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(',').map(p => p.trim().replace(/^"|"$/g, ''))
    const rawEmail1 = parts[p1Idx] ?? ''
    const rawEmail2 = parts[p2Idx] ?? ''
    const team_name = teamIdx >= 0 ? (parts[teamIdx] || null) : null
    const rowNum = i + 1

    // Status precedence (most blocking wins): invalid → duplicate → no_account → ok

    // 1. Invalid: missing or malformed emails
    if (!rawEmail1 || !rawEmail1.includes('@')) {
      results.push({ row: rowNum, email: rawEmail1, team_name, status: 'invalid', reason: 'Player 1 email is missing or invalid' })
      continue
    }
    if (!rawEmail2 || !rawEmail2.includes('@')) {
      results.push({ row: rowNum, email: rawEmail1, email2: rawEmail2, team_name, status: 'invalid', reason: 'Player 2 email is missing or invalid' })
      continue
    }

    const norm1 = normalizeEmail(rawEmail1)
    const norm2 = normalizeEmail(rawEmail2)

    // Same-email check: both columns point to the same person
    if (norm1 === norm2) {
      results.push({ row: rowNum, email: rawEmail1, email2: rawEmail2, team_name, status: 'invalid', reason: 'Player 1 and Player 2 cannot be the same email.' })
      continue
    }

    // 2. Duplicate: player already seen in an earlier row of this CSV
    const p1SeenInCsv = seenNormalized.has(norm1)
    const p2SeenInCsv = seenNormalized.has(norm2)
    if (p1SeenInCsv || p2SeenInCsv) {
      const who = p1SeenInCsv ? rawEmail1 : rawEmail2
      results.push({ row: rowNum, email: rawEmail1, email2: rawEmail2, team_name, status: 'duplicate', reason: `${who} already appears in an earlier row` })
      seenNormalized.add(norm1)
      seenNormalized.add(norm2)
      continue
    }
    seenNormalized.add(norm1)
    seenNormalized.add(norm2)

    const user1 = userByNormEmail.get(norm1)
    const user2 = userByNormEmail.get(norm2)

    // Duplicate: already registered in this division
    const p1Registered = user1 ? existingUserIds.has(user1.id) : false
    const p2Registered = user2 ? existingUserIds.has(user2.id) : false
    if (p1Registered || p2Registered) {
      const who = p1Registered ? rawEmail1 : rawEmail2
      results.push({ row: rowNum, email: rawEmail1, email2: rawEmail2, team_name, status: 'duplicate', reason: `${who} is already registered in this division`, user_id: user1?.id, user_id2: user2?.id })
      continue
    }

    // 3. No account: one or both emails have no Joinzer account (will be invited on commit)
    if (!user1 || !user2) {
      const missing = [!user1 ? rawEmail1 : null, !user2 ? rawEmail2 : null].filter(Boolean).join(' and ')
      results.push({ row: rowNum, email: rawEmail1, email2: rawEmail2, team_name, status: 'no_account', reason: `No Joinzer account: ${missing}` })
      continue
    }

    // 4. Ok: fetch both profiles in one query
    const { data: profiles } = await service
      .from('profiles')
      .select('id, name')
      .in('id', [user1.id, user2.id])

    const p1Profile = profiles?.find(p => p.id === user1.id)
    const p2Profile = profiles?.find(p => p.id === user2.id)

    results.push({
      row: rowNum,
      email: rawEmail1,
      email2: rawEmail2,
      team_name: team_name || null,
      status: 'ok',
      user_id: user1.id,
      user_id2: user2.id,
      player_name: p1Profile?.name ?? null,
      player_name2: p2Profile?.name ?? null,
    })
  }

  return results
}

/**
 * Parse CSV text and classify each row.
 * Singles: optional header, columns email + team_name
 * Doubles: required header, columns team_name + player1_email + player2_email
 */
export async function parseCsvRows(
  csvText: string,
  tournamentId: string,
  divisionId: string,
  format: string = ''
): Promise<CsvRow[]> {
  const service = db()
  const lines = csvText.trim().split(/\r?\n/)
  if (lines.length === 0) return []

  if (isDoublesFormat(format)) {
    return parseDoublesRows(lines, tournamentId, divisionId, service)
  }

  // ── Singles path ────────────────────────────────────────────────────────────

  const firstLine = lines[0].toLowerCase()
  const hasHeader = firstLine.includes('email')
  const dataLines = hasHeader ? lines.slice(1) : lines

  const [allUsers, { data: existingRegs }] = await Promise.all([
    listAllAuthUsers(service),
    service
      .from('tournament_registrations')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .eq('division_id', divisionId)
      .neq('status', 'cancelled'),
  ])

  const userByNormalizedEmail = new Map(
    allUsers.map(u => [normalizeEmail(u.email ?? ''), u])
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
      results.push({ row: i + 1, email: rawEmail, team_name, status: 'no_account', reason: 'No Joinzer account with this email' })
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


// ── Invite email ─────────────────────────────────────────────────────────────

async function sendStubInvites(
  service: ReturnType<typeof db>,
  emails: Set<string>,
  tournamentId: string,
  divisionId: string,
  isDummy: boolean,
  siteUrl: string
): Promise<void> {
  const shouldSend = process.env.NODE_ENV === 'production' && !isDummy

  const [{ data: tournament }, { data: division }] = await Promise.all([
    service.from('tournaments').select('name, start_date, location_id, organizer_id').eq('id', tournamentId).single(),
    service.from('tournament_divisions').select('name').eq('id', divisionId).single(),
  ])

  if (!tournament) return

  const [{ data: organizer }, locationResult] = await Promise.all([
    service.from('profiles').select('name').eq('id', tournament.organizer_id).single(),
    tournament.location_id
      ? service.from('locations').select('name').eq('id', tournament.location_id).single()
      : Promise.resolve({ data: null }),
  ])

  const organizerName = organizer?.name ?? 'A tournament organizer'
  const locationName = locationResult.data?.name ?? null

  // Pre-format the date upstream so the email receives "Saturday, June 7, 2026"
  const formattedDate = tournament.start_date
    ? new Date(tournament.start_date + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        timeZone: 'America/Los_Angeles',
      })
    : null

  for (const email of emails) {
    if (!shouldSend) {
      console.log(`[invite] skipped (NODE_ENV=${process.env.NODE_ENV}, dummy=${isDummy}) — would have sent to ${email}`)
      continue
    }

    // Fire-and-forget per invite — one failure doesn't block others
    ;(async () => {
      try {
        // Magic link authenticates the recipient in one click and lands them in /profile/setup
        const { data: linkData } = await service.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: `${siteUrl}/auth/callback` },
        })
        const claimUrl = linkData?.properties?.action_link ?? `${siteUrl}/login`

        const localPart = email.split('@')[0].replace(/[^a-zA-Z]/g, '')
        const firstName = localPart
          ? localPart.charAt(0).toUpperCase() + localPart.slice(1)
          : 'there'

        const rows: EmailRow[] = [
          ['Tournament', tournament.name],
          ...(formattedDate ? [['Date', formattedDate] as EmailRow] : []),
          ...(locationName ? [['Location', locationName] as EmailRow] : []),
          ...(division?.name ? [['Division', division.name] as EmailRow] : []),
          ['Added by', organizerName],
        ]

        await sendEmail({
          to: email,
          subject: `${organizerName} added you to ${tournament.name} on Joinzer`,
          html: registrationEmail({
            heading: "You've been added to a tournament",
            firstName,
            intro: `${organizerName} added you to ${tournament.name}. Joinzer is a free platform for pickleball players to find games, join leagues, and compete in tournaments.`,
            rows,
            ctaLabel: 'Claim your spot',
            ctaUrl: claimUrl,
            footerNote: "Not interested? You can ignore this email — you won't be charged or matched until you claim your account. You're receiving this because a tournament organizer added you on Joinzer.",
          }),
        })
      } catch (err) {
        console.error('[invite] send failed for', email, err)
      }
    })()
  }
}

// ── Commit ───────────────────────────────────────────────────────────────────

/**
 * Commit pre-validated rows from parseCsvRows.
 * Phase 1: resolve all user IDs, creating stub accounts for no_account rows.
 * Phase 2: insert all registrations (singles bulk insert; doubles via RPC).
 * Phase 3: send invite emails — only after Phase 2 fully succeeds.
 */
export async function commitCsvRows(
  rows: CsvRow[],
  tournamentId: string,
  divisionId: string,
  format: string,
  isDummy: boolean
): Promise<{ registered: number; stubs: number }> {
  const service = db()
  const siteUrl = getSiteUrl()

  const committable = rows.filter(r => r.status === 'ok' || r.status === 'no_account')
  if (committable.length === 0) return { registered: 0, stubs: 0 }

  // Fresh user map for idempotency checks inside createStub
  const allAuthUsers = await listAllAuthUsers(service)
  const userByNormEmail = new Map(allAuthUsers.map(u => [normalizeEmail(u.email ?? ''), u]))

  // ─── Phase 1: Resolve all user IDs ─────────────────────────────────────────
  type ResolvedRow = CsvRow & { resolvedId: string; resolvedId2?: string }
  const resolved: ResolvedRow[] = []
  const newStubEmails = new Set<string>()

  for (const row of committable) {
    let resolvedId: string
    let resolvedId2: string | undefined

    if (row.user_id) {
      resolvedId = row.user_id
    } else {
      const r = await createStub(service, row.email, userByNormEmail)
      resolvedId = r.userId
      if (r.isNew) newStubEmails.add(row.email)
    }

    if (row.email2) {
      if (row.user_id2) {
        resolvedId2 = row.user_id2
      } else {
        const r = await createStub(service, row.email2, userByNormEmail)
        resolvedId2 = r.userId
        if (r.isNew) newStubEmails.add(row.email2)
      }
    }

    resolved.push({ ...row, resolvedId, resolvedId2 })
  }

  // ─── Phase 2: Insert all registrations ─────────────────────────────────────
  if (isDoublesFormat(format)) {
    for (const row of resolved) {
      if (!row.resolvedId2) continue
      const { error } = await service.rpc('register_doubles_pair', {
        p_tournament_id: tournamentId,
        p_division_id: divisionId,
        p_player1_id: row.resolvedId,
        p_player2_id: row.resolvedId2,
        p_team_name: row.team_name ?? null,
      })
      if (error) throw new Error(error.message)
    }
  } else {
    const inserts = resolved.map(r => ({
      tournament_id: tournamentId,
      division_id: divisionId,
      user_id: r.resolvedId,
      team_name: r.team_name ?? null,
      status: 'registered',
      registration_type: 'team',
      payment_status: 'waived',
    }))
    const { error } = await service.from('tournament_registrations').insert(inserts)
    if (error) throw new Error(error.message)
  }

  // ─── Phase 3: Send invites (only reached if Phase 2 fully succeeded) ────────
  if (newStubEmails.size > 0) {
    await sendStubInvites(service, newStubEmails, tournamentId, divisionId, isDummy, siteUrl)
  }

  return { registered: resolved.length, stubs: newStubEmails.size }
}

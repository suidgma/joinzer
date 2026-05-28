/**
 * Multi-division CSV import.
 *
 * Parses a single CSV that spans every division in a tournament. Each row's
 * `division` column routes it to the correct division by name. Wide field set
 * supports the typical organizer roster export (name, phone, skill, gender).
 *
 * Unknown emails get stub profiles + magic-link invites on commit
 * (same flow as the singles import — we just pass through the extras).
 *
 * Lives alongside `lib/tournament/csv.ts` so the per-division flow keeps
 * working unchanged. New /api/tournaments/[id]/import route uses this module;
 * old /api/tournaments/[id]/divisions/[divisionId]/import keeps using csv.ts.
 */

import { createClient as createAdmin, type User } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { normalizeEmail, createStub, type StubExtras } from '@/lib/users/stubs'

const db = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlayerData = {
  email: string
  name?: string | null
  phone?: string | null
  gender?: string | null
  dupr_rating?: number | null
}

export type MultiDivRow = {
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

type DivisionLite = { id: string; name: string; format: string }

// ─── Column aliasing ──────────────────────────────────────────────────────────

// Maps any accepted header spelling → canonical key.
// Keep generic singulars (`email`, `name`) mapping to player1 — for singles
// divisions, the row IS player1.
const COL_ALIASES: Record<string, string> = {
  // division
  'division': 'division', 'div': 'division', 'category': 'division',

  // player 1 email
  'email': 'p1_email', 'player_email': 'p1_email',
  'player1': 'p1_email', 'player1_email': 'p1_email',

  // player 2 email
  'partner_email': 'p2_email', 'partner': 'p2_email',
  'player2': 'p2_email', 'player2_email': 'p2_email',

  // names
  'name': 'p1_name', 'player_name': 'p1_name', 'player1_name': 'p1_name',
  'partner_name': 'p2_name', 'player2_name': 'p2_name',

  // phones
  'phone': 'p1_phone', 'player_phone': 'p1_phone', 'player1_phone': 'p1_phone',
  'partner_phone': 'p2_phone', 'player2_phone': 'p2_phone',

  // ratings (DUPR or generic skill — same field, since profiles.dupr_rating is numeric)
  'skill': 'p1_rating', 'dupr': 'p1_rating', 'rating': 'p1_rating',
  'skill_level': 'p1_rating', 'dupr_rating': 'p1_rating',
  'player1_skill': 'p1_rating', 'player1_dupr': 'p1_rating', 'player1_rating': 'p1_rating',
  'partner_skill': 'p2_rating', 'partner_dupr': 'p2_rating', 'partner_rating': 'p2_rating',
  'player2_skill': 'p2_rating', 'player2_dupr': 'p2_rating', 'player2_rating': 'p2_rating',

  // gender
  'gender': 'p1_gender', 'm/f': 'p1_gender', 'sex': 'p1_gender',
  'player1_gender': 'p1_gender',
  'partner_gender': 'p2_gender', 'player2_gender': 'p2_gender',

  // team
  'team': 'team_name', 'team_name': 'team_name',
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^"|"$/g, '').replace(/[\s-]+/g, '_')
}

// Splits one CSV line respecting double-quoted fields with embedded commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

// Parse a rating cell. Accepts "3.5", "DUPR 3.5", "3.5+" — extracts the first
// number. Returns null if no number found or out of plausible range.
function parseRating(raw: string | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const n = Number(match[1])
  if (Number.isNaN(n) || n < 1 || n > 8) return null
  return n
}

// Fetch every auth user across pagination so the email-lookup map is complete.
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

// ─── Preview / parse ──────────────────────────────────────────────────────────

export type ParseResult = {
  rows: MultiDivRow[]
  unknownColumns: string[]   // columns in the CSV header we didn't recognize — surfaced to user as info
  headerError?: string       // if header is unparseable, all rows are invalid
}

export async function parseMultiDivisionCsv(
  csvText: string,
  tournamentId: string
): Promise<ParseResult> {
  const service = db()
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], unknownColumns: [] }

  // ── Header parsing ──────────────────────────────────────────────────────────
  const rawHeader = splitCsvLine(lines[0])
  const normHeaders = rawHeader.map(normHeader)
  const columnIndex: Record<string, number> = {}
  const unknownColumns: string[] = []
  normHeaders.forEach((h, i) => {
    const canonical = COL_ALIASES[h]
    if (canonical && !(canonical in columnIndex)) columnIndex[canonical] = i
    else if (!canonical) unknownColumns.push(rawHeader[i])
  })

  if (!('division' in columnIndex)) {
    return {
      rows: [],
      unknownColumns,
      headerError: 'CSV must include a `division` column. Recognized aliases: division, div, category.',
    }
  }
  if (!('p1_email' in columnIndex)) {
    return {
      rows: [],
      unknownColumns,
      headerError: 'CSV must include a player1 email column. Recognized aliases: email, player_email, player1_email, player1.',
    }
  }

  // ── Tournament context ──────────────────────────────────────────────────────
  const [{ data: divisionsData }, allUsers, { data: existingRegs }] = await Promise.all([
    service
      .from('tournament_divisions')
      .select('id, name, format')
      .eq('tournament_id', tournamentId),
    listAllAuthUsers(service),
    service
      .from('tournament_registrations')
      .select('user_id, division_id')
      .eq('tournament_id', tournamentId)
      .neq('status', 'cancelled'),
  ])

  const divisions: DivisionLite[] = (divisionsData ?? []) as DivisionLite[]
  const divisionByNormName = new Map<string, DivisionLite>()
  for (const d of divisions) {
    divisionByNormName.set(d.name.trim().toLowerCase(), d)
  }

  const userByNormEmail = new Map(
    allUsers.map(u => [normalizeEmail(u.email ?? ''), u])
  )

  // existing registrations keyed as "userId|divisionId" for fast lookup
  const existingKey = new Set<string>()
  for (const r of existingRegs ?? []) {
    existingKey.add(`${r.user_id}|${r.division_id}`)
  }

  // Track in-CSV claims to catch a player listed in two rows
  // Key: "normalizedEmail|divisionId"  →  reject the second row
  const seenInCsv = new Set<string>()

  // ── Per-row evaluation ──────────────────────────────────────────────────────
  const rows: MultiDivRow[] = []
  const dataLines = lines.slice(1)

  for (let i = 0; i < dataLines.length; i++) {
    const parts = splitCsvLine(dataLines[i])
    const get = (key: string) => {
      const idx = columnIndex[key]
      return idx != null ? (parts[idx] ?? '').trim() : ''
    }

    const divisionInput = get('division')
    const p1Email = get('p1_email')
    const p2Email = get('p2_email')

    const player1: PlayerData = {
      email: p1Email,
      name: get('p1_name') || null,
      phone: get('p1_phone') || null,
      gender: get('p1_gender') || null,
      dupr_rating: parseRating(get('p1_rating')),
    }
    const player2HasAny = p2Email || get('p2_name') || get('p2_phone') || get('p2_gender') || get('p2_rating')
    const player2: PlayerData | undefined = player2HasAny ? {
      email: p2Email,
      name: get('p2_name') || null,
      phone: get('p2_phone') || null,
      gender: get('p2_gender') || null,
      dupr_rating: parseRating(get('p2_rating')),
    } : undefined

    const team_name = get('team_name') || null
    const rowNum = i + 1

    const base: MultiDivRow = {
      row: rowNum,
      divisionInput,
      player1,
      player2,
      team_name,
      status: 'invalid',
    }

    // 1. Division resolution
    if (!divisionInput) {
      rows.push({ ...base, reason: 'Missing division' })
      continue
    }
    const division = divisionByNormName.get(divisionInput.trim().toLowerCase())
    if (!division) {
      rows.push({
        ...base,
        reason: `Division "${divisionInput}" doesn't exist on this tournament`,
      })
      continue
    }
    const divFormat = division.format ?? ''
    const isDoubles = isDoublesFormat(divFormat)
    base.divisionId = division.id
    base.divisionName = division.name
    base.divisionFormat = divFormat
    base.isDoubles = isDoubles

    // 2. Player 1 email validation
    if (!p1Email || !p1Email.includes('@')) {
      rows.push({ ...base, reason: 'Player 1 email is missing or invalid' })
      continue
    }
    const norm1 = normalizeEmail(p1Email)

    // 3. Doubles requires player 2
    if (isDoubles) {
      if (!p2Email || !p2Email.includes('@')) {
        rows.push({ ...base, reason: `Division "${division.name}" is doubles — player 2 email is required` })
        continue
      }
      const norm2 = normalizeEmail(p2Email)
      if (norm1 === norm2) {
        rows.push({ ...base, reason: 'Player 1 and Player 2 cannot be the same email' })
        continue
      }

      // 4. Doubles duplicate checks
      if (seenInCsv.has(`${norm1}|${division.id}`)) {
        rows.push({ ...base, status: 'duplicate', reason: `${p1Email} already appears in an earlier row for this division` })
        continue
      }
      if (seenInCsv.has(`${norm2}|${division.id}`)) {
        rows.push({ ...base, status: 'duplicate', reason: `${p2Email} already appears in an earlier row for this division` })
        continue
      }
      const u1 = userByNormEmail.get(norm1)
      const u2 = userByNormEmail.get(norm2)
      if (u1 && existingKey.has(`${u1.id}|${division.id}`)) {
        rows.push({ ...base, status: 'duplicate', user_id: u1.id, reason: `${p1Email} is already registered in this division` })
        continue
      }
      if (u2 && existingKey.has(`${u2.id}|${division.id}`)) {
        rows.push({ ...base, status: 'duplicate', user_id: u1?.id, user_id2: u2.id, reason: `${p2Email} is already registered in this division` })
        continue
      }
      seenInCsv.add(`${norm1}|${division.id}`)
      seenInCsv.add(`${norm2}|${division.id}`)

      // 5. Account status
      if (!u1 || !u2) {
        const missing = [!u1 ? p1Email : null, !u2 ? p2Email : null].filter(Boolean).join(' and ')
        rows.push({ ...base, status: 'no_account', user_id: u1?.id, user_id2: u2?.id, reason: `No Joinzer account: ${missing}` })
        continue
      }
      rows.push({ ...base, status: 'ok', user_id: u1.id, user_id2: u2.id })
      continue
    }

    // ── Singles path ──────────────────────────────────────────────────────────
    if (seenInCsv.has(`${norm1}|${division.id}`)) {
      rows.push({ ...base, status: 'duplicate', reason: `${p1Email} already appears in an earlier row for this division` })
      continue
    }
    const u1 = userByNormEmail.get(norm1)
    if (u1 && existingKey.has(`${u1.id}|${division.id}`)) {
      rows.push({ ...base, status: 'duplicate', user_id: u1.id, reason: `${p1Email} is already registered in this division` })
      continue
    }
    seenInCsv.add(`${norm1}|${division.id}`)
    if (!u1) {
      rows.push({ ...base, status: 'no_account', reason: 'No Joinzer account with this email' })
      continue
    }
    rows.push({ ...base, status: 'ok', user_id: u1.id })
  }

  return { rows, unknownColumns }
}

// ─── Commit ───────────────────────────────────────────────────────────────────

export type CommitResult = {
  registered: number
  stubs: number
  byDivision: Record<string, { name: string; registered: number; stubs: number }>
}

export async function commitMultiDivisionRows(
  rows: MultiDivRow[],
  tournamentId: string,
  isDummy: boolean
): Promise<CommitResult> {
  const service = db()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'

  const committable = rows.filter(r => (r.status === 'ok' || r.status === 'no_account') && r.divisionId)
  if (committable.length === 0) {
    return { registered: 0, stubs: 0, byDivision: {} }
  }

  // Fresh user map for stub idempotency
  const allUsers = await listAllAuthUsers(service)
  const userByNormEmail = new Map(allUsers.map(u => [normalizeEmail(u.email ?? ''), u]))

  // ── Phase 1: resolve all user IDs (creating stubs as needed) ────────────────
  type ResolvedRow = MultiDivRow & { resolvedId: string; resolvedId2?: string }
  const resolved: ResolvedRow[] = []
  // Track stubs grouped by division so the invite email can include the right division name
  const stubsByDivision: Map<string, Set<string>> = new Map()
  const ensureStubSet = (divId: string) => {
    let s = stubsByDivision.get(divId)
    if (!s) { s = new Set(); stubsByDivision.set(divId, s) }
    return s
  }

  for (const row of committable) {
    const divisionId = row.divisionId!

    // Player 1
    let resolvedId: string
    if (row.user_id) {
      resolvedId = row.user_id
    } else {
      const extras1: StubExtras = {
        name: row.player1.name,
        phone: row.player1.phone,
        gender: row.player1.gender,
        dupr_rating: row.player1.dupr_rating,
      }
      const r = await createStub(service, row.player1.email, userByNormEmail, extras1)
      resolvedId = r.userId
      if (r.isNew) ensureStubSet(divisionId).add(row.player1.email)
    }

    // Player 2 (doubles only)
    let resolvedId2: string | undefined
    if (row.isDoubles && row.player2) {
      if (row.user_id2) {
        resolvedId2 = row.user_id2
      } else {
        const extras2: StubExtras = {
          name: row.player2.name,
          phone: row.player2.phone,
          gender: row.player2.gender,
          dupr_rating: row.player2.dupr_rating,
        }
        const r = await createStub(service, row.player2.email, userByNormEmail, extras2)
        resolvedId2 = r.userId
        if (r.isNew) ensureStubSet(divisionId).add(row.player2.email)
      }
    }

    resolved.push({ ...row, resolvedId, resolvedId2 })
  }

  // ── Phase 2: insert registrations, grouped by division and format ───────────
  const byDivisionOutput: Record<string, { name: string; registered: number; stubs: number }> = {}
  const byDivisionGroups = new Map<string, ResolvedRow[]>()
  for (const r of resolved) {
    const arr = byDivisionGroups.get(r.divisionId!) ?? []
    arr.push(r)
    byDivisionGroups.set(r.divisionId!, arr)
  }

  for (const [divId, group] of byDivisionGroups) {
    const isDoubles = !!group[0]?.isDoubles
    const divName = group[0]?.divisionName ?? divId

    if (isDoubles) {
      // Atomic doubles via existing RPC — one row at a time
      for (const row of group) {
        if (!row.resolvedId2) continue
        const { error } = await service.rpc('register_doubles_pair', {
          p_tournament_id: tournamentId,
          p_division_id: divId,
          p_player1_id: row.resolvedId,
          p_player2_id: row.resolvedId2,
          p_team_name: row.team_name ?? null,
        })
        if (error) throw new Error(`Division "${divName}": ${error.message}`)
      }
    } else {
      const inserts = group.map(r => ({
        tournament_id: tournamentId,
        division_id: divId,
        user_id: r.resolvedId,
        team_name: r.team_name ?? null,
        status: 'registered',
        registration_type: 'team',
        payment_status: 'waived',
      }))
      const { error } = await service.from('tournament_registrations').insert(inserts)
      if (error) throw new Error(`Division "${divName}": ${error.message}`)
    }

    byDivisionOutput[divId] = {
      name: divName,
      registered: group.length,
      stubs: stubsByDivision.get(divId)?.size ?? 0,
    }
  }

  // ── Phase 3: send invite emails (only reached if Phase 2 fully succeeded) ───
  let totalStubs = 0
  for (const [divId, emails] of stubsByDivision) {
    if (emails.size === 0) continue
    totalStubs += emails.size
    await sendStubInvites(service, emails, tournamentId, divId, isDummy, siteUrl)
  }

  return {
    registered: resolved.length,
    stubs: totalStubs,
    byDivision: byDivisionOutput,
  }
}

// ─── Invite email (multi-division aware via per-division batches) ─────────────

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

    ;(async () => {
      try {
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

        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: 'Joinzer <support@joinzer.com>',
          to: email,
          replyTo: 'martyfit50@gmail.com',
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

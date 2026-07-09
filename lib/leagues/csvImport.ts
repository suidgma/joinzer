// Bulk player import for leagues (organizer tool). Mirrors the tournament CSV
// importer but for a single roster — one player per row (partners are assigned
// separately). Parse → classify → preview → commit: existing accounts register,
// unknown emails become stub accounts + a magic-link invite. See lib/tournament/csv.ts.

import { createClient as createAdmin } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { normalizeEmail, createStub, listAllAuthUsers } from '@/lib/users/stubs'
import { getSiteUrl } from '@/lib/utils/site-url'

const db = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export type LeagueCsvRow = {
  row: number
  email: string
  name: string | null
  skill: number | null
  gender: string | null
  phone: string | null
  // Status precedence (most blocking wins): invalid → duplicate → no_account → ok
  status: 'ok' | 'no_account' | 'duplicate' | 'invalid'
  user_id?: string
  player_name?: string | null
  reason?: string
}

export type LeagueParseResult = { rows: LeagueCsvRow[]; unknownColumns: string[]; headerError?: string }

type ColKey = 'email' | 'name' | 'skill' | 'gender' | 'phone'
const COLUMN_ALIASES: Record<string, ColKey> = {
  email: 'email', 'e-mail': 'email', player_email: 'email', player1_email: 'email',
  name: 'name', player_name: 'name', full_name: 'name',
  skill: 'skill', dupr: 'skill', dupr_rating: 'skill', rating: 'skill', skill_level: 'skill',
  gender: 'gender', sex: 'gender',
  phone: 'phone', mobile: 'phone', phone_number: 'phone',
}

function splitCells(line: string): string[] {
  return line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
}

// Parse league-import CSV and classify each row. A header row (no "@" in it) maps
// columns by name; a header-less file is read positionally: email, name, skill, gender, phone.
export async function parseLeagueCsv(csvText: string, leagueId: string): Promise<LeagueParseResult> {
  const service = db()
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return { rows: [], unknownColumns: [] }

  const hasHeader = !lines[0].includes('@')
  const idx: Partial<Record<ColKey, number>> = {}
  const unknownColumns: string[] = []

  if (hasHeader) {
    splitCells(lines[0]).forEach((raw, i) => {
      const key = COLUMN_ALIASES[raw.toLowerCase()]
      if (key) { if (idx[key] == null) idx[key] = i }
      else if (raw) unknownColumns.push(raw)
    })
    if (idx.email == null) {
      return { rows: [], unknownColumns, headerError: 'Missing required column: email' }
    }
  } else {
    idx.email = 0; idx.name = 1; idx.skill = 2; idx.gender = 3; idx.phone = 4
  }

  const dataLines = hasHeader ? lines.slice(1) : lines

  const [allUsers, { data: existingRegs }] = await Promise.all([
    listAllAuthUsers(service),
    service.from('league_registrations').select('user_id').eq('league_id', leagueId).neq('status', 'cancelled'),
  ])
  const userByNormEmail = new Map(allUsers.map((u) => [normalizeEmail(u.email ?? ''), u]))
  const existingUserIds = new Set((existingRegs ?? []).map((r: { user_id: string }) => r.user_id))
  const seen = new Set<string>()

  const rows: LeagueCsvRow[] = []
  for (let i = 0; i < dataLines.length; i++) {
    const cells = splitCells(dataLines[i])
    const email = idx.email != null ? (cells[idx.email] ?? '') : ''
    const name = idx.name != null ? (cells[idx.name] || null) : null
    const skillRaw = idx.skill != null ? (cells[idx.skill] || '') : ''
    const skillNum = skillRaw ? parseFloat(skillRaw) : NaN
    const skill = Number.isNaN(skillNum) ? null : skillNum
    const gender = idx.gender != null ? (cells[idx.gender] || null) : null
    const phone = idx.phone != null ? (cells[idx.phone] || null) : null
    const base = { row: i + 1, email, name, skill, gender, phone }

    if (!email || !email.includes('@')) { rows.push({ ...base, status: 'invalid', reason: 'Missing or invalid email' }); continue }
    const norm = normalizeEmail(email)
    if (seen.has(norm)) { rows.push({ ...base, status: 'duplicate', reason: 'Email appears earlier in the file' }); continue }
    seen.add(norm)

    const authUser = userByNormEmail.get(norm)
    if (!authUser) { rows.push({ ...base, status: 'no_account', reason: 'No Joinzer account — will be invited' }); continue }
    if (existingUserIds.has(authUser.id)) { rows.push({ ...base, status: 'duplicate', reason: 'Already in this league', user_id: authUser.id }); continue }

    const { data: profile } = await service.from('profiles').select('name').eq('id', authUser.id).single()
    rows.push({ ...base, status: 'ok', user_id: authUser.id, player_name: profile?.name ?? null })
  }

  return { rows, unknownColumns }
}

// Commit pre-validated rows: create stubs for no-account rows, register everyone,
// sync them into non-completed sessions, then invite the new stubs.
export async function commitLeagueCsv(
  rows: LeagueCsvRow[],
  leagueId: string,
  isDummy: boolean,
): Promise<{ registered: number; stubs: number }> {
  const service = db()
  const siteUrl = getSiteUrl()

  const committable = rows.filter((r) => r.status === 'ok' || r.status === 'no_account')
  if (committable.length === 0) return { registered: 0, stubs: 0 }

  const allUsers = await listAllAuthUsers(service)
  const userByNormEmail = new Map(allUsers.map((u) => [normalizeEmail(u.email ?? ''), u]))

  const ids: string[] = []
  const newStubEmails = new Set<string>()
  for (const row of committable) {
    let userId: string
    if (row.user_id) {
      userId = row.user_id
    } else {
      const r = await createStub(service, row.email, userByNormEmail, {
        name: row.name, phone: row.phone, gender: row.gender, dupr_rating: row.skill,
      })
      userId = r.userId
      if (r.isNew) newStubEmails.add(row.email)
    }
    ids.push(userId)
  }
  const uniqueIds = [...new Set(ids)]

  const inserts = uniqueIds.map((uid) => ({
    league_id: leagueId,
    user_id: uid,
    status: 'registered',
    registered_at: new Date().toISOString(),
  }))
  const { error } = await service.from('league_registrations').upsert(inserts, { onConflict: 'league_id,user_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)

  // Sync into non-completed sessions so imported players show up on upcoming nights
  // (mirrors the single-player add route).
  const { data: sessions } = await service.from('league_sessions').select('id').eq('league_id', leagueId).neq('status', 'completed')
  if (sessions && sessions.length > 0) {
    const { data: profiles } = await service.from('profiles').select('id, name, joinzer_rating').in('id', uniqueIds)
    const profById = new Map((profiles ?? []).map((p: { id: string; name: string; joinzer_rating: number | null }) => [p.id, p]))
    const spRows = sessions.flatMap((s: { id: string }) =>
      uniqueIds.map((uid) => {
        const p = profById.get(uid)
        return {
          session_id: s.id,
          user_id: uid,
          display_name: p?.name ?? '',
          player_type: 'roster_player',
          expected_status: 'expected',
          actual_status: 'not_present',
          joinzer_rating: p?.joinzer_rating ?? 1000,
        }
      }),
    )
    if (spRows.length > 0) {
      await service.from('league_session_players').upsert(spRows, { onConflict: 'session_id,user_id', ignoreDuplicates: true })
    }
  }

  if (newStubEmails.size > 0) await sendLeagueStubInvites(service, newStubEmails, leagueId, isDummy, siteUrl)

  return { registered: uniqueIds.length, stubs: newStubEmails.size }
}

async function sendLeagueStubInvites(
  service: ReturnType<typeof db>,
  emails: Set<string>,
  leagueId: string,
  isDummy: boolean,
  siteUrl: string,
): Promise<void> {
  const shouldSend = process.env.NODE_ENV === 'production' && !isDummy

  const { data: league } = await service.from('leagues').select('name, start_date, location_name, created_by').eq('id', leagueId).single()
  if (!league) return
  const { data: organizer } = await service.from('profiles').select('name').eq('id', league.created_by).single()
  const organizerName = organizer?.name ?? 'A league organizer'

  const formattedDate = league.start_date
    ? new Date(league.start_date + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
      })
    : null

  for (const email of emails) {
    if (!shouldSend) {
      console.log(`[league-invite] skipped (NODE_ENV=${process.env.NODE_ENV}, dummy=${isDummy}) — would have sent to ${email}`)
      continue
    }
    ;(async () => {
      try {
        const { data: linkData } = await service.auth.admin.generateLink({
          type: 'magiclink', email, options: { redirectTo: `${siteUrl}/auth/callback` },
        })
        const claimUrl = linkData?.properties?.action_link ?? `${siteUrl}/login`
        const localPart = email.split('@')[0].replace(/[^a-zA-Z]/g, '')
        const firstName = localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : 'there'
        const rows: EmailRow[] = [
          ['League', league.name],
          ...(formattedDate ? [['Starts', formattedDate] as EmailRow] : []),
          ...(league.location_name ? [['Location', league.location_name] as EmailRow] : []),
          ['Added by', organizerName],
        ]
        await sendEmail({
          to: email,
          subject: `${organizerName} added you to ${league.name} on Joinzer`,
          html: registrationEmail({
            heading: "You've been added to a league",
            firstName,
            intro: `${organizerName} added you to ${league.name}. Joinzer is a free platform for pickleball players to find games, join leagues, and compete in tournaments.`,
            rows,
            ctaLabel: 'Claim your spot',
            ctaUrl: claimUrl,
            footerNote: "Not interested? You can ignore this email — you won't be charged or scheduled until you claim your account. You're receiving this because a league organizer added you on Joinzer.",
          }),
        })
      } catch (err) {
        console.error('[league-invite] send failed for', email, err)
      }
    })()
  }
}

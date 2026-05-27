import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { parseTeamCsv, type ParsedTeamRow } from '@/lib/tournament/csv'
import { canManageTournament } from '@/lib/tournament/access'

type Body = {
  csv?: string
  mode?: 'preview' | 'apply'
}

type RowOutcome = {
  rowIndex: number
  player1Email: string
  player2Email: string | null
  teamName: string | null
  status:
    | 'ok'                // Both players resolved (or solo); will create on apply
    | 'missing_account'   // One or both emails not registered as Joinzer users
    | 'duplicate'         // Player already has an active registration in this division
    | 'invalid'           // Row is malformed (e.g. doubles row missing partner)
  resolvedUserId?: string
  resolvedPartnerUserId?: string | null
  message?: string
  createdRegistrationId?: string
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.csv || !body.csv.trim()) {
    return NextResponse.json({ error: 'csv is required' }, { status: 400 })
  }
  const mode = body.mode === 'apply' ? 'apply' : 'preview'

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const allowed = await canManageTournament(service, params.id, user.id)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, tournament_id, team_type, max_entries, waitlist_enabled, status')
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
  if (division.status === 'closed') {
    return NextResponse.json({ error: 'Division is closed' }, { status: 400 })
  }

  const { rows, error: parseErr } = parseTeamCsv(body.csv)
  if (parseErr) return NextResponse.json({ error: parseErr }, { status: 400 })
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found' }, { status: 400 })
  }

  // Resolve all emails → profile ids in one query
  const allEmails = Array.from(new Set(
    rows.flatMap(r => [r.player1Email, r.player2Email]).filter((e): e is string => !!e)
  ))
  const { data: profiles } = await service
    .from('profiles')
    .select('id, email')
    .in('email', allEmails)
  const emailToId = new Map<string, string>(
    (profiles ?? []).map(p => [p.email!.toLowerCase(), p.id])
  )

  // Existing active registrations in this division (for duplicate detection)
  const { data: existingRegs } = await service
    .from('tournament_registrations')
    .select('user_id, partner_user_id')
    .eq('division_id', params.divisionId)
    .neq('status', 'cancelled')
  const taken = new Set<string>()
  for (const r of existingRegs ?? []) {
    if (r.user_id) taken.add(r.user_id)
    if (r.partner_user_id) taken.add(r.partner_user_id)
  }

  const outcomes: RowOutcome[] = rows.map((row): RowOutcome => evaluateRow(row, division, emailToId, taken))

  if (mode === 'preview') {
    return NextResponse.json({ outcomes, summary: summarize(outcomes) })
  }

  // Apply: create registrations for every 'ok' row.
  // We mutate `taken` as we go so two rows can't both claim the same user.
  for (const outcome of outcomes) {
    if (outcome.status !== 'ok' || !outcome.resolvedUserId) continue
    if (taken.has(outcome.resolvedUserId)) {
      outcome.status = 'duplicate'
      outcome.message = 'Already registered earlier in this import'
      continue
    }
    if (outcome.resolvedPartnerUserId && taken.has(outcome.resolvedPartnerUserId)) {
      outcome.status = 'duplicate'
      outcome.message = 'Partner already registered earlier in this import'
      continue
    }

    const { data: created, error } = await service
      .from('tournament_registrations')
      .insert({
        tournament_id: params.id,
        division_id: params.divisionId,
        user_id: outcome.resolvedUserId,
        partner_user_id: outcome.resolvedPartnerUserId ?? null,
        team_name: outcome.teamName,
        status: 'registered',
        registration_type: 'team',
        payment_status: 'waived', // organizer imports assume payment is handled out-of-band
      })
      .select('id')
      .single()

    if (error || !created) {
      outcome.status = 'invalid'
      outcome.message = error?.message ?? 'Insert failed'
      continue
    }
    outcome.createdRegistrationId = created.id
    taken.add(outcome.resolvedUserId)
    if (outcome.resolvedPartnerUserId) taken.add(outcome.resolvedPartnerUserId)
  }

  return NextResponse.json({ outcomes, summary: summarize(outcomes) })
}

function evaluateRow(
  row: ParsedTeamRow,
  division: { team_type: string },
  emailToId: Map<string, string>,
  taken: Set<string>
): RowOutcome {
  const out: RowOutcome = {
    rowIndex: row.rowIndex,
    player1Email: row.player1Email,
    player2Email: row.player2Email,
    teamName: row.teamName,
    status: 'ok',
  }

  const p1Id = emailToId.get(row.player1Email)
  if (!p1Id) {
    out.status = 'missing_account'
    out.message = `${row.player1Email} doesn't have a Joinzer account`
    return out
  }
  out.resolvedUserId = p1Id

  if (division.team_type === 'doubles') {
    if (!row.player2Email) {
      out.status = 'invalid'
      out.message = 'Doubles division requires player2_email'
      return out
    }
    const p2Id = emailToId.get(row.player2Email)
    if (!p2Id) {
      out.status = 'missing_account'
      out.message = `${row.player2Email} doesn't have a Joinzer account`
      return out
    }
    if (p1Id === p2Id) {
      out.status = 'invalid'
      out.message = 'Player 1 and player 2 cannot be the same person'
      return out
    }
    out.resolvedPartnerUserId = p2Id
  }

  if (taken.has(p1Id) || (out.resolvedPartnerUserId && taken.has(out.resolvedPartnerUserId))) {
    out.status = 'duplicate'
    out.message = 'Player already registered in this division'
    return out
  }

  return out
}

function summarize(outcomes: RowOutcome[]) {
  return {
    total: outcomes.length,
    ok: outcomes.filter(o => o.status === 'ok').length,
    created: outcomes.filter(o => !!o.createdRegistrationId).length,
    missing_account: outcomes.filter(o => o.status === 'missing_account').length,
    duplicate: outcomes.filter(o => o.status === 'duplicate').length,
    invalid: outcomes.filter(o => o.status === 'invalid').length,
  }
}

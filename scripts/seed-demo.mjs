// ============================================================================
// seed-demo.mjs — a clean, professional demo environment for organizer demos
// ============================================================================
//
// WHY: prod is full of test junk (leagues named "WWWW...", tournaments named
// "delete", dummy players with a leading-dot name quirk). This builds a small,
// pristine, realistic set that looks great in a live demo, clearly separated
// from everything else and trivially removable.
//
// WHAT IT CREATES (all owned by one demo organizer, all @joinzerdemo.com):
//   • 1 demo organizer account (log in as this to show the organizer side)
//   • 20 realistically-named demo players (visible in the Players directory)
//   • 1 mid-season round-robin league: 12 players, 2 sessions scored with live
//     standings, 1 upcoming session
//   • 1 in-progress single-elim tournament: 8-player Open Singles, round 1
//     complete, semifinals set, final awaiting
//
// IDEMPOTENT: always tears down any existing demo data first, then reseeds — so
// re-running gives a fresh, clean environment every time.
//
// USAGE (from repo root, needs .env.local with the service-role key):
//   node scripts/seed-demo.mjs            # reset + seed
//   node scripts/seed-demo.mjs --reset    # tear down demo data only
//
// TEARDOWN identity: everything is owned by accounts at @joinzerdemo.com, so
// cleanup is unambiguous and can never touch real or other test data.
// ============================================================================

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Insert that fails loudly — supabase-js does NOT throw on insert errors, it returns them.
async function ins(table, rows) {
  const { error } = await db.from(table).insert(rows)
  if (error) throw new Error(`insert ${table}: ${error.message}`)
}

// ---- config ----------------------------------------------------------------
const DOMAIN = 'joinzerdemo.com'
const PASSWORD = 'JoinzerDemo2026!'
const ORGANIZER_EMAIL = `demo.organizer@${DOMAIN}`
const RESET_ONLY = process.argv.includes('--reset')

// Real Las Vegas–area venues already in the locations table.
const VENUES = {
  sunset: 'b823f01d-4c86-4b26-a08d-4249fb528b8d',       // Sunset Park Pickleball Complex (Las Vegas)
  blackMountain: 'b5e95513-37e4-4be1-96b6-094d6d4e8ade', // Black Mountain Recreation Center (Henderson)
  universe: '2b1930e8-e1fb-48dd-823b-2f1ab6a22bcc',      // The Pickleball Universe (Las Vegas)
  cnp: '44c66454-84ca-4f77-9aac-3a63cbbc6427',           // Chicken N Pickle - Henderson
  dill: 'f2b4f41a-d34b-4132-857c-e52856538638',          // Dill Dinkers (Henderson)
}
const venueList = Object.values(VENUES)

// Curated, clean player names (no leading dot, distinct last names).
const PLAYERS = [
  ['Marcus', 'Bennett', 'male', 4.3], ['Ryan', 'Chen', 'male', 3.8], ['David', 'Okafor', 'male', 4.5],
  ['Chris', 'Dalton', 'male', 3.5], ['Tony', 'Alvarez', 'male', 4.0], ['Kevin', 'Park', 'male', 3.2],
  ['Sam', 'Whitfield', 'male', 4.1], ['Luis', 'Romero', 'male', 3.6], ['Brett', 'Sullivan', 'male', 3.9],
  ['Derek', 'Nguyen', 'male', 4.4], ['Sarah', 'Whitman', 'female', 3.7], ['Emily', 'Rossi', 'female', 4.2],
  ['Jenna', 'Castillo', 'female', 3.4], ['Rachel', 'Kim', 'female', 4.0], ['Amanda', 'Boyd', 'female', 3.6],
  ['Nicole', 'Freeman', 'female', 3.9], ['Megan', 'Doyle', 'female', 3.3], ['Priya', 'Anand', 'female', 4.1],
  ['Laura', 'Hoffman', 'female', 3.5], ['Dana', 'Fletcher', 'female', 3.8],
]

// ---- date helpers ----------------------------------------------------------
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d }
const NOW = new Date().toISOString()
const today = new Date()

// ---- teardown --------------------------------------------------------------
async function teardown() {
  // Collect every demo user id (from profiles + auth, in case a prior run half-failed).
  const ids = new Set()
  const { data: profs } = await db.from('profiles').select('id, email').ilike('email', `%@${DOMAIN}`)
  for (const p of profs ?? []) ids.add(p.id)
  let page = 1
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) break
    for (const u of data.users) if ((u.email || '').toLowerCase().endsWith(`@${DOMAIN}`)) ids.add(u.id)
    if (data.users.length < 1000) break
    page++
  }
  const userIds = [...ids]
  if (userIds.length === 0) { console.log('teardown: no existing demo data'); return }

  // Leagues owned by demo users → children first.
  const { data: leagues } = await db.from('leagues').select('id').in('created_by', userIds)
  const leagueIds = (leagues ?? []).map(l => l.id)
  if (leagueIds.length) {
    const { data: sessions } = await db.from('league_sessions').select('id').in('league_id', leagueIds)
    const sessionIds = (sessions ?? []).map(s => s.id)
    if (sessionIds.length) {
      await db.from('league_matches').delete().in('session_id', sessionIds)
      await db.from('league_session_players').delete().in('session_id', sessionIds)
      await db.from('league_sessions').delete().in('id', sessionIds)
    }
    await db.from('league_registrations').delete().in('league_id', leagueIds)
    await db.from('leagues').delete().in('id', leagueIds)
  }

  // Tournaments owned by demo users → children first.
  const { data: tourneys } = await db.from('tournaments').select('id').in('organizer_id', userIds)
  const tIds = (tourneys ?? []).map(t => t.id)
  if (tIds.length) {
    await db.from('tournament_matches').delete().in('tournament_id', tIds)
    await db.from('tournament_registrations').delete().in('tournament_id', tIds)
    await db.from('tournament_divisions').delete().in('tournament_id', tIds)
    await db.from('tournaments').delete().in('id', tIds)
  }

  // Best-effort: derived/cron-populated rows keyed on the demo users (so --reset
  // stays clean even after the nightly recompute runs). Ignore missing tables.
  for (const [table, col] of [
    ['player_ratings', 'user_id'], ['player_stats', 'user_id'], ['player_achievements', 'user_id'],
    ['notifications', 'user_id'], ['event_participants', 'user_id'],
  ]) {
    try { await db.from(table).delete().in(col, userIds) } catch { /* table may not exist */ }
  }

  // Finally the auth users (cascades profiles + identities).
  let removed = 0
  for (const id of userIds) { const { error } = await db.auth.admin.deleteUser(id); if (!error) removed++ }
  console.log(`teardown: removed ${leagueIds.length} league(s), ${tIds.length} tournament(s), ${removed} account(s)`)
}

// ---- account creation ------------------------------------------------------
async function createAccount({ email, name, gender, dupr, homeCourt, isOrganizer = false }) {
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  const id = data.user.id
  const { error: pe } = await db.from('profiles').insert({
    id, name, email, gender,
    dupr_rating: dupr, self_reported_rating: dupr, self_reported_scale: 'dupr',
    rating_source: 'estimated', joinzer_rating: 1000,
    dummy: false, is_stub: false, discoverable: true,
    home_court_id: homeCourt, email_visibility: 'self', phone_visibility: 'self',
    can_create_paid_events: isOrganizer, signup_intent: isOrganizer ? 'organize' : 'play',
    created_at: NOW,
  })
  if (pe) throw new Error(`profile ${email}: ${pe.message}`)
  return id
}

// ---- round-robin scheduling (circle method) --------------------------------
function circleRounds(ids, numRounds) {
  const n = ids.length
  let order = ids.slice()
  const rounds = []
  for (let r = 0; r < numRounds; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) pairs.push([order[i], order[n - 1 - i]])
    rounds.push(pairs)
    const rest = order.slice(1)
    rest.unshift(rest.pop())
    order = [order[0], ...rest]
  }
  return rounds
}
// Score a singles game to 11, winner biased by DUPR with realistic noise.
function playGame(aDupr, bDupr) {
  const pa = 1 / (1 + Math.pow(10, (bDupr - aDupr) / 1.2))
  const aWins = Math.random() < pa
  const loser = 2 + Math.floor(Math.random() * 7) // 2–8
  return aWins ? [11, loser] : [loser, 11]
}

// ---- seed ------------------------------------------------------------------
async function seed() {
  console.log('seeding demo environment…')

  // Organizer + players.
  const organizerId = await createAccount({
    email: ORGANIZER_EMAIL, name: 'Jordan Cole', gender: 'male', dupr: 4.0,
    homeCourt: VENUES.sunset, isOrganizer: true,
  })
  const players = []
  for (let i = 0; i < PLAYERS.length; i++) {
    const [first, last, gender, dupr] = PLAYERS[i]
    const id = await createAccount({
      email: `${first}.${last}@${DOMAIN}`.toLowerCase(), name: `${first} ${last}`,
      gender, dupr, homeCourt: venueList[i % venueList.length],
    })
    players.push({ id, name: `${first} ${last}`, dupr })
  }
  console.log(`  created organizer + ${players.length} players`)

  // ---- LEAGUE: mid-season round robin -------------------------------------
  const leaguePlayers = players.slice(0, 12)
  const leagueId = randomUUID()
  await ins('leagues', {
    id: leagueId, name: 'Summerlin Tuesday Night Singles',
    description: 'A friendly weekly singles round robin at Sunset Park. Open to 3.0–4.5 players. Show up, get matched, climb the standings.',
    format: 'open_singles', format_kind: 'session_rr', location_id: VENUES.sunset,
    location_name: 'Sunset Park Pickleball Complex',
    schedule_description: 'Tuesdays, 6:30 PM', start_date: iso(addDays(today, -30)), end_date: iso(addDays(today, 60)),
    registration_status: 'open', created_by: organizerId, status: 'active',
    points_to_win: 11, win_by: 2, sub_credit_cap: 2, cost_cents: 0, standings_method: 'total_points',
    dummy: false, partner_mode: 'fixed', format_settings_json: {}, no_play_dates: [],
    public_standings: true, allow_player_scores: true, self_run: false,
    skill_min: 3.0, skill_max: 4.5, games_per_session: 6, max_players: 16,
    start_time: '18:30', created_at: NOW,
  })
  await ins('league_registrations', leaguePlayers.map((p, i) => ({
    id: randomUUID(), league_id: leagueId, user_id: p.id, status: 'registered',
    registered_at: NOW, is_co_admin: false, payment_status: 'free', registration_type: 'team', sort_order: i,
  })))

  // Two completed sessions (scored) + one upcoming.
  const sessionDates = [iso(addDays(today, -14)), iso(addDays(today, -7))]
  for (let s = 0; s < sessionDates.length; s++) {
    const sessionId = randomUUID()
    await ins('league_sessions', {
      id: sessionId, league_id: leagueId, session_date: sessionDates[s], session_number: s + 1,
      status: 'completed', number_of_courts: 6, rounds_planned: 6, session_time: '18:30', created_at: NOW,
    })
    await ins('league_session_players', leaguePlayers.map(p => ({
      id: randomUUID(), session_id: sessionId, user_id: p.id, display_name: p.name,
      player_type: 'roster_player', expected_status: 'expected', actual_status: 'present',
      joinzer_rating: 1000, dupr_rating: p.dupr, created_at: NOW, updated_at: NOW,
    })))
    const rounds = circleRounds(leaguePlayers.map(p => p.id), 6)
    const duprOf = Object.fromEntries(leaguePlayers.map(p => [p.id, p.dupr]))
    const matchRows = []
    rounds.forEach((pairs, r) => pairs.forEach(([a, b], court) => {
      const [sa, sb] = playGame(duprOf[a], duprOf[b])
      matchRows.push({
        id: randomUUID(), session_id: sessionId, round_number: r + 1, court_number: court + 1,
        team1_player1_id: a, team2_player1_id: b, team1_score: sa, team2_score: sb, created_at: NOW,
      })
    }))
    await ins('league_matches', matchRows)
  }
  // Upcoming session (not yet run).
  await ins('league_sessions', {
    id: randomUUID(), league_id: leagueId, session_date: iso(addDays(today, 5)), session_number: 3,
    status: 'scheduled', number_of_courts: 6, rounds_planned: 6, session_time: '18:30', created_at: NOW,
  })
  console.log('  created league "Summerlin Tuesday Night Singles" (2 sessions scored + 1 upcoming)')

  // ---- TOURNAMENT: in-progress single elim --------------------------------
  const tourPlayers = players.slice(2, 10) // 8 players, overlaps the league
    .map(p => ({ ...p }))
    .sort((a, b) => b.dupr - a.dupr) // seed by rating
  const tId = randomUUID()
  await ins('tournaments', {
    id: tId, name: 'Henderson Summer Slam', organizer_id: organizerId,
    description: 'A one-day singles shootout at Chicken N Pickle. Single elimination, games to 11, win by 2.',
    location_id: VENUES.cnp, start_date: iso(today), start_time: '09:00',
    status: 'published', visibility: 'public', registration_status: 'closed', cost_cents: 0,
    allow_player_scores: false, dummy: false, default_win_by: 2, default_games_to: 11,
    default_bracket_type: 'single_elimination', additional_days: [], schedule_settings_json: {},
    scheduling_method: 'timed', show_seeds: true, contact_name: 'Jordan Cole', created_at: NOW, updated_at: NOW,
  })
  const divId = randomUUID()
  await ins('tournament_divisions', {
    id: divId, tournament_id: tId, name: 'Open Singles', category: 'open', team_type: 'singles',
    max_entries: 8, waitlist_enabled: false, status: 'active', bracket_type: 'single_elimination',
    format: 'open_singles', partner_mode: 'fixed', show_seeds: true, created_at: NOW, updated_at: NOW,
  })
  // Registrations seeded 1..8.
  const regs = tourPlayers.map((p, i) => ({ ...p, regId: randomUUID(), seed: i + 1 }))
  await ins('tournament_registrations', regs.map(r => ({
    id: r.regId, tournament_id: tId, division_id: divId, user_id: r.id, status: 'registered',
    payment_status: 'waived', registration_type: 'team', checked_in: true, seed: r.seed,
    created_at: NOW, updated_at: NOW,
  })))
  const bySeed = Object.fromEntries(regs.map(r => [r.seed, r]))
  // Round 1 (QF): standard 8-bracket seeding. Winners mostly by seed, with one upset (6 over 3).
  const qf = [
    { m: 1, a: 1, b: 8, w: 1 }, { m: 2, a: 4, b: 5, w: 4 },
    { m: 3, a: 3, b: 6, w: 6 }, { m: 4, a: 2, b: 7, w: 2 },
  ]
  const matches = []
  for (const g of qf) {
    const wSeed = g.w, lSeed = g.w === g.a ? g.b : g.a
    matches.push({
      id: randomUUID(), tournament_id: tId, division_id: divId, round_number: 1, match_number: g.m,
      match_stage: 'single_elimination',
      team_1_registration_id: bySeed[g.a].regId, team_2_registration_id: bySeed[g.b].regId,
      team_1_score: g.a === wSeed ? 11 : 2 + Math.floor(Math.random() * 7),
      team_2_score: g.b === wSeed ? 11 : 2 + Math.floor(Math.random() * 7),
      winner_registration_id: bySeed[wSeed].regId, status: 'completed', is_draft: false,
      created_at: NOW, updated_at: NOW,
    })
  }
  // Round 2 (SF): teams set from QF winners, not yet played.
  matches.push({
    id: randomUUID(), tournament_id: tId, division_id: divId, round_number: 2, match_number: 5,
    match_stage: 'single_elimination', team_1_registration_id: bySeed[1].regId, team_2_registration_id: bySeed[4].regId,
    status: 'scheduled', is_draft: false, created_at: NOW, updated_at: NOW,
  })
  matches.push({
    id: randomUUID(), tournament_id: tId, division_id: divId, round_number: 2, match_number: 6,
    match_stage: 'single_elimination', team_1_registration_id: bySeed[6].regId, team_2_registration_id: bySeed[2].regId,
    status: 'scheduled', is_draft: false, created_at: NOW, updated_at: NOW,
  })
  // Round 3 (Final): awaiting both semifinals.
  matches.push({
    id: randomUUID(), tournament_id: tId, division_id: divId, round_number: 3, match_number: 7,
    match_stage: 'single_elimination', status: 'scheduled', is_draft: false, created_at: NOW, updated_at: NOW,
  })
  await ins('tournament_matches', matches)
  console.log('  created tournament "Henderson Summer Slam" (round 1 complete, semifinals set)')

  console.log('\n✅ demo environment ready')
  console.log('   Organizer login:  ' + ORGANIZER_EMAIL + '  /  ' + PASSWORD)
  console.log('   Any player login: <first>.<last>@' + DOMAIN + '  /  ' + PASSWORD + '   (e.g. marcus.bennett@' + DOMAIN + ')')
  console.log('   League id:     ' + leagueId)
  console.log('   Tournament id: ' + tId)
}

// ---- main ------------------------------------------------------------------
await teardown()
if (!RESET_ONLY) await seed()
else console.log('reset complete (no seed).')

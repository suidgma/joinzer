// ── Realtime topic + event registry ──────────────────────────────────────────
// Central, typed home for channel topic names and broadcast event names so writers
// (server routes) and readers (client hooks) never drift. Adding a realtime feature
// = add a topic builder + event name here, then use it on both sides.
//
// Two delivery mechanisms coexist under one hook API:
//   • postgres_changes — for client-readable tables (chat message tables). RLS applies.
//   • server broadcast — for deny-all/sensitive tables (attendance, scores). The route
//     that authorizes the write emits a minimal event; RLS on the table stays intact.

// Chat: postgres_changes on the message table, scoped to the entity row.
export const chatTopic = (table: string, entityId: string) => `chat:${table}:${entityId}`

// Attendance: server broadcast, one topic per "occasion" (a league session, or a
// box/ladder cycle period). The occasion id is the league_sessions.id (round robin)
// or league_periods.id (box/ladder) — whichever the write route is mutating.
export const attendanceTopic = (occasionId: string) => `attendance:${occasionId}`

// League fixtures/results: server broadcast, one topic per league. league_fixtures is
// deny-all (box/ladder/flex/team), so a score/result change can't reach clients via
// postgres_changes — the write route emits a coarse "changed" signal here and the page
// reconciles by refetching its (authorized) server data. See RealtimeRefresh.
export const leagueFixturesTopic = (leagueId: string) => `league-fixtures:${leagueId}`

// Session host: server broadcast when a player-run session's host changes (claim / hand-off /
// release). league_sessions.host_user_id isn't driving client reads, so a broadcast lets everyone
// viewing the run screen re-derive who's hosting (via RealtimeRefresh) without a manual reload.
export const sessionHostTopic = (sessionId: string) => `session-host:${sessionId}`

// Per-user in-app notifications: server broadcast on create so the bell badge + a toast go
// live (replacing the poll). notifications is created server-side, so broadcast fits (no
// client SELECT needed on the table).
export const notificationsTopic = (userId: string) => `notifications:${userId}`

// Broadcast event names (app-level events, decoupled from table shape).
export const RealtimeEvents = {
  attendanceStatusChanged: 'player.status.changed',
  leagueFixturesChanged: 'league.fixtures.changed',
  notificationCreated: 'notification.created',
  sessionHostChanged: 'session.host.changed',
} as const

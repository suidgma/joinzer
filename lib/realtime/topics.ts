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

// Broadcast event names (app-level events, decoupled from table shape).
export const RealtimeEvents = {
  attendanceStatusChanged: 'player.status.changed',
} as const

// ── Server-side Realtime broadcast ───────────────────────────────────────────
// Lets an API route push an authorized app event to subscribed clients WITHOUT
// opening SELECT/RLS on the underlying (deny-all) table. The route already
// authorized the write, so it emits a minimal, non-PII event; the table's deny-all
// RLS is untouched. Uses the Realtime HTTP broadcast endpoint, so no WebSocket is
// needed inside a serverless handler.
//
// Best-effort: never throws and never blocks the user path — a realtime hiccup must
// not fail the write it accompanies. Always `await broadcast(...).catch(() => {})`
// or call without awaiting after the DB write has succeeded.

export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
  // Set `private: true` for topics whose subscribers join a private channel (RLS-gated on
  // realtime.messages) — the message must be flagged private to reach them.
  opts: { private?: boolean } = {},
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  const body = JSON.stringify({ messages: [{ topic, event, payload, ...(opts.private ? { private: true } : {}) }] })
  const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }

  // Best-effort, but retry once on a transient failure so a single network blip doesn't
  // silently drop a live update (receivers otherwise only catch up on their next load).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${url}/realtime/v1/api/broadcast`, { method: 'POST', headers, body })
      if (res.ok) return
      if (attempt === 1) console.error('[realtime] broadcast non-ok', { topic, event, status: res.status })
    } catch (err) {
      if (attempt === 1) console.error('[realtime] broadcast failed', { topic, event, err })
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 200))
  }
}

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
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    })
  } catch (err) {
    console.error('[realtime] broadcast failed', { topic, event, err })
  }
}

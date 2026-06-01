import { createClient } from '@supabase/supabase-js'
import { sendPush, sendPushBatch } from '@/lib/push/send'

type Surface = 'event' | 'league' | 'tournament' | 'system'

export interface NotificationInput {
  recipientId: string
  surface: Surface
  surfaceId?: string
  kind: string
  title: string
  body?: string
  url?: string
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function createNotification(input: NotificationInput): Promise<void> {
  try {
    await admin().from('notifications').insert({
      recipient_id: input.recipientId,
      surface: input.surface,
      surface_id: input.surfaceId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
    })
  } catch (err) {
    console.error('[notifications] create failed:', err)
  }

  // Push is fire-and-forget — never blocks the caller
  sendPush(input.recipientId, {
    title: input.title,
    body: input.body,
    url: input.url,
    tag: input.kind,
  }).catch(console.error)
}

export async function createNotifications(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return

  try {
    await admin().from('notifications').insert(
      inputs.map(input => ({
        recipient_id: input.recipientId,
        surface: input.surface,
        surface_id: input.surfaceId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
      }))
    )
  } catch (err) {
    console.error('[notifications] batch create failed:', err)
  }

  // Group by kind so all recipients of the same notification get the same payload
  // then batch-send push to all unique recipients
  const recipientIds = [...new Set(inputs.map(i => i.recipientId))]
  const first = inputs[0]
  sendPushBatch(recipientIds, {
    title: first.title,
    body: first.body,
    url: first.url,
    tag: first.kind,
  }).catch(console.error)
}

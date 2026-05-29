import { createClient } from '@supabase/supabase-js'

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
}

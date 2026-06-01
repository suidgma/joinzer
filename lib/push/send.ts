import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export interface PushPayload {
  title: string
  body?: string
  url?: string
  tag?: string
}

function getWebPush(): typeof webpush | null {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject) return null
  webpush.setVapidDetails(subject, pub, priv)
  return webpush
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function clearExpiredSubscription(userId: string) {
  await admin().from('profiles').update({ push_subscription: null }).eq('id', userId)
}

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  const wp = getWebPush()
  if (!wp) return

  try {
    const { data: profile } = await admin()
      .from('profiles')
      .select('push_subscription')
      .eq('id', userId)
      .single()

    if (!profile?.push_subscription) return

    await wp.sendNotification(
      profile.push_subscription as webpush.PushSubscription,
      JSON.stringify(payload)
    )
  } catch (err: any) {
    // 410 Gone / 404 = subscription revoked or expired — clean it up
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      await clearExpiredSubscription(userId)
    } else {
      console.error('[push] sendPush failed:', { userId, err: err?.message })
    }
  }
}

export async function sendPushBatch(userIds: string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return
  const wp = getWebPush()
  if (!wp) return

  try {
    const { data: profiles } = await admin()
      .from('profiles')
      .select('id, push_subscription')
      .in('id', userIds)
      .not('push_subscription', 'is', null)

    if (!profiles?.length) return

    await Promise.allSettled(
      profiles.map(async (p) => {
        try {
          await wp.sendNotification(
            p.push_subscription as webpush.PushSubscription,
            JSON.stringify(payload)
          )
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await clearExpiredSubscription(p.id)
          } else {
            console.error('[push] sendPushBatch item failed:', { userId: p.id, err: err?.message })
          }
        }
      })
    )
  } catch (err) {
    console.error('[push] sendPushBatch failed:', err)
  }
}

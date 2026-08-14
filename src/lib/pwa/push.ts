import webpush from 'web-push'
import { getServerEnv } from '@/lib/env'
import type { AdminClient } from '@/lib/supabase/admin'

export interface PushPayload { title: string; body: string; url: string; tag?: string }

function normalizeInternalUrl(value: string): string {
  try {
    const url = new URL(value, 'https://crm.invalid')
    if (url.origin !== 'https://crm.invalid' || !url.pathname.startsWith('/inbox')) return '/inbox'
    return `${url.pathname}${url.search}`
  } catch {
    return '/inbox'
  }
}

function getPushClient() {
  const env = getServerEnv()
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  return webpush
}

export async function sendPushToOrganization(admin: AdminClient, organizationId: string, payload: PushPayload): Promise<void> {
  const client = getPushClient()
  if (!client) return

  const safePayload = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 240),
    url: normalizeInternalUrl(payload.url),
    ...(payload.tag ? { tag: payload.tag.slice(0, 120) } : {}),
  })

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('organization_id', organizationId)
  if (error || !subscriptions) return

  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await client.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        safePayload
      )
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', subscription.id)
      }
    }
  }))
}

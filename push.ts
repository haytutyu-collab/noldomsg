import { setVapidDetails, sendNotification } from 'web-push'
import { db } from '@/lib/db'

let configured = false
function ensureConfigured() {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:noldo@example.com'
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys not set in env')
  }
  setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Send a push notification to every device subscribed for the given user.
 * Silently no-ops if the user has no subscriptions or VAPID isn't configured.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    ensureConfigured()
  } catch {
    // VAPID not configured (e.g. during local dev without env) — skip silently.
    return
  }

  const subs = await db.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag,
  })

  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
        )
      } catch (err: unknown) {
        // If the subscription is no longer valid (410 Gone / 404), delete it.
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
        } else {
          console.warn('[push] sendNotification failed', status, err)
        }
      }
    }),
  )
}

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// POST /api/push/subscribe
// Body: PushSubscriptionJSON-like { endpoint, keys: { p256dh, auth } }
// Saves the subscription for the current user so the server can send push notifications.
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const userId = cookieStore.get(SESSION_COOKIE)?.value
    if (!userId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }
    const body = await req.json()
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    const p256dh = body?.keys?.p256dh
    const auth = body?.keys?.auth

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'Некорректная подписка' }, { status: 400 })
    }

    // Upsert — if this endpoint already exists (same browser/device), just keep it.
    const existing = await db.pushSubscription.findUnique({ where: { endpoint } })
    if (existing) {
      // Re-attach to current user (in case the same browser logs in as someone else)
      await db.pushSubscription.update({
        where: { id: existing.id },
        data: { userId, p256dh, auth },
      })
    } else {
      await db.pushSubscription.create({
        data: { userId, endpoint, p256dh, auth },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[push/subscribe] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

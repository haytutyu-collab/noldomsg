import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/push/unsubscribe
// Body: { endpoint: string }
// Removes the subscription (called when the user changes notification settings or logs out).
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint обязателен' }, { status: 400 })
    }
    await db.pushSubscription.deleteMany({ where: { endpoint } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[push/unsubscribe] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

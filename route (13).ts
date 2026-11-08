import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// PUT /api/profile — update name, bio, avatarUrl
export async function PUT(req: Request) {
  try {
    const cookieStore = await cookies()
    const userId = cookieStore.get(SESSION_COOKIE)?.value
    if (!userId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await req.json()
    const data: { name?: string; bio?: string; avatarUrl?: string | null } = {}

    if (typeof body?.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Имя не может быть пустым' }, { status: 400 })
      if (name.length > 40) return NextResponse.json({ error: 'Имя слишком длинное' }, { status: 400 })
      // Make sure the name is not taken by someone else
      const clash = await db.user.findFirst({ where: { name, NOT: { id: userId } } })
      if (clash) return NextResponse.json({ error: 'Это имя уже занято' }, { status: 409 })
      data.name = name
    }
    if (typeof body?.bio === 'string') {
      data.bio = body.bio.slice(0, 200)
    }
    if ('avatarUrl' in body) {
      data.avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl : null
    }

    const user = await db.user.update({ where: { id: userId }, data })
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
      },
    })
  } catch (e) {
    console.error('[profile] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

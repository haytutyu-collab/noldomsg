import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// POST /api/auth/login
// Body: { name: string, password: string }
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!name || !password) {
      return NextResponse.json({ error: 'Введите имя и пароль' }, { status: 400 })
    }

    const user = await db.user.findFirst({ where: { name } })
    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 })
    }

    const res = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
      },
    })
    res.cookies.set(SESSION_COOKIE, user.id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    })
    return res
  } catch (e) {
    console.error('[auth/login] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

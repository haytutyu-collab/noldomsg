import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'
const PASSWORD_MIN = 4

// POST /api/auth/register
// Body: { name: string, password: string }
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!name) {
      return NextResponse.json({ error: 'Введите имя' }, { status: 400 })
    }
    if (name.length > 40) {
      return NextResponse.json({ error: 'Имя слишком длинное (макс. 40 символов)' }, { status: 400 })
    }
    if (password.length < PASSWORD_MIN) {
      return NextResponse.json({ error: `Пароль не короче ${PASSWORD_MIN} символов` }, { status: 400 })
    }

    const existing = await db.user.findFirst({ where: { name } })
    if (existing) {
      return NextResponse.json({ error: 'Это имя уже занято' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await db.user.create({ data: { name, passwordHash } })

    const res = NextResponse.json({ user: sanitize(user) })
    res.cookies.set(SESSION_COOKIE, user.id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    })
    return res
  } catch (e) {
    console.error('[auth/register] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

function sanitize(u: { id: string; name: string; avatarUrl: string | null; bio: string | null }) {
  return {
    id: u.id,
    name: u.name,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
  }
}

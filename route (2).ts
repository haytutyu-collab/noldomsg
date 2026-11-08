import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// GET /api/auth/me — returns the current user or null
export async function GET() {
  const cookieStore = await cookies()
  const userId = cookieStore.get(SESSION_COOKIE)?.value
  if (!userId) {
    return NextResponse.json({ user: null })
  }
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) {
    const res = NextResponse.json({ user: null })
    res.cookies.delete(SESSION_COOKIE)
    return res
  }
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
    },
  })
}

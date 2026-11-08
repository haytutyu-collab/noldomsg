import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// GET /api/groups/[id] — get group details (must be a member)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  const myId = cookieStore.get(SESSION_COOKIE)?.value
  if (!myId) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }

  const { id } = await params

  const member = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: myId } },
  })
  if (!member) {
    return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 })
  }

  const group = await db.group.findUnique({
    where: { id },
    include: { members: { include: { user: true } } },
  })
  if (!group) {
    return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 })
  }

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      avatarUrl: group.avatarUrl,
      createdAt: group.createdAt,
      members: group.members.map((gm) => ({
        id: gm.user.id,
        name: gm.user.name,
        avatarUrl: gm.user.avatarUrl,
      })),
    },
  })
}

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// GET /api/groups — list groups I'm a member of, with last message preview + unread count
export async function GET() {
  const cookieStore = await cookies()
  const myId = cookieStore.get(SESSION_COOKIE)?.value
  if (!myId) {
    return NextResponse.json({ groups: [] })
  }

  const memberships = await db.groupMember.findMany({
    where: { userId: myId },
    include: {
      group: {
        include: { members: { include: { user: true } } },
      },
    },
  })

  const enriched = await Promise.all(
    memberships.map(async (m) => {
      const last = await db.message.findFirst({
        where: { groupId: m.group.id },
        orderBy: { createdAt: 'desc' },
      })
      const unreadCount = await db.message.count({
        where: {
          groupId: m.group.id,
          fromId: { not: myId },
          read: false,
          // Note: we don't track per-user read state for groups in this simple version.
          // Unread count for groups is approximate; for a proper implementation we'd add
          // a GroupReadReceipt model. For now, treat all non-self group messages as "read".
        },
      })
      return {
        id: m.group.id,
        name: m.group.name,
        avatarUrl: m.group.avatarUrl,
        createdAt: m.group.createdAt,
        members: m.group.members.map((gm) => ({
          id: gm.user.id,
          name: gm.user.name,
          avatarUrl: gm.user.avatarUrl,
        })),
        lastMessage: last
          ? {
              content: last.content,
              imageUrl: last.imageUrl,
              audioUrl: last.audioUrl,
              createdAt: last.createdAt,
              fromId: last.fromId,
            }
          : null,
        unreadCount,
      }
    }),
  )

  enriched.sort((a, b) => {
    if (a.lastMessage && b.lastMessage) {
      return b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime()
    }
    if (a.lastMessage) return -1
    if (b.lastMessage) return 1
    return a.name.localeCompare(b.name)
  })

  return NextResponse.json({ groups: enriched })
}

// POST /api/groups — create a new group
// Body: { name: string, memberIds: string[] }
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const myId = cookieStore.get(SESSION_COOKIE)?.value
    if (!myId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const memberIds: string[] = Array.isArray(body?.memberIds)
      ? body.memberIds.filter((x: unknown): x is string => typeof x === 'string')
      : []

    if (!name) {
      return NextResponse.json({ error: 'Введите название группы' }, { status: 400 })
    }
    if (name.length > 60) {
      return NextResponse.json({ error: 'Название слишком длинное' }, { status: 400 })
    }
    if (memberIds.length === 0) {
      return NextResponse.json({ error: 'Выберите хотя бы одного участника' }, { status: 400 })
    }

    // Validate all members exist
    const users = await db.user.findMany({ where: { id: { in: memberIds } } })
    if (users.length !== memberIds.length) {
      return NextResponse.json({ error: 'Некоторые участники не найдены' }, { status: 400 })
    }

    const group = await db.group.create({
      data: {
        name,
        createdBy: myId,
        members: {
          create: [
            { userId: myId },
            ...memberIds.filter((id) => id !== myId).map((userId) => ({ userId })),
          ],
        },
      },
      include: { members: { include: { user: true } } },
    })

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
  } catch (e) {
    console.error('[groups POST] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'noldo_user_id'

// GET /api/users — list all users (other than me) for the contact list and group creation.
// Includes last direct message with me so the UI can show a chat preview.
export async function GET() {
  const cookieStore = await cookies()
  const myId = cookieStore.get(SESSION_COOKIE)?.value
  if (!myId) {
    return NextResponse.json({ users: [] })
  }

  const others = await db.user.findMany({
    where: { id: { not: myId } },
    orderBy: { name: 'asc' },
  })

  const enriched = await Promise.all(
    others.map(async (u) => {
      const last = await db.message.findFirst({
        where: {
          OR: [
            { fromId: myId, toId: u.id },
            { fromId: u.id, toId: myId },
          ],
        },
        orderBy: { createdAt: 'desc' },
      })
      const unreadCount = await db.message.count({
        where: { fromId: u.id, toId: myId, read: false },
      })
      return {
        id: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        createdAt: u.createdAt,
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

  return NextResponse.json({ users: enriched })
}

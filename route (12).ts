import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { sendPushToUser } from '@/lib/messenger/push'

const SESSION_COOKIE = 'noldo_user_id'

// GET /api/messages?with=<userId> | ?group=<groupId>
// Returns the conversation, oldest first. Marks received direct messages as read.
export async function GET(req: Request) {
  const cookieStore = await cookies()
  const myId = cookieStore.get(SESSION_COOKIE)?.value
  if (!myId) {
    return NextResponse.json({ messages: [] })
  }

  const { searchParams } = new URL(req.url)
  const otherId = searchParams.get('with')
  const groupId = searchParams.get('group')

  if (groupId) {
    const member = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: myId } },
    })
    if (!member) {
      return NextResponse.json({ error: 'Нет доступа к группе' }, { status: 403 })
    }
    const messages = await db.message.findMany({
      where: { groupId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    return NextResponse.json({ messages: messages.map(serialize) })
  }

  if (!otherId) {
    return NextResponse.json({ error: 'Параметр "with" или "group" обязателен' }, { status: 400 })
  }

  // Mark received messages as read
  await db.message.updateMany({
    where: { fromId: otherId, toId: myId, read: false },
    data: { read: true },
  })

  const messages = await db.message.findMany({
    where: {
      OR: [
        { fromId: myId, toId: otherId },
        { fromId: otherId, toId: myId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })

  return NextResponse.json({ messages: messages.map(serialize) })
}

// POST /api/messages
// Body: { toId?, groupId?, content?, imageUrl?, audioUrl?, audioDurationSec? }
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const myId = cookieStore.get(SESSION_COOKIE)?.value
    if (!myId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await req.json()
    const toId = typeof body?.toId === 'string' ? body.toId : undefined
    const groupId = typeof body?.groupId === 'string' ? body.groupId : undefined
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : undefined
    const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl : undefined
    const audioDurationSec =
      typeof body?.audioDurationSec === 'number' && body.audioDurationSec > 0
        ? Math.min(Math.round(body.audioDurationSec), 3600)
        : undefined

    if (!toId && !groupId) {
      return NextResponse.json({ error: 'Укажите получателя (toId) или группу (groupId)' }, { status: 400 })
    }
    if (!content && !imageUrl && !audioUrl) {
      return NextResponse.json({ error: 'Сообщение не может быть пустым' }, { status: 400 })
    }
    if (content.length > 4000) {
      return NextResponse.json({ error: 'Сообщение слишком длинное' }, { status: 400 })
    }
    if (toId && toId === myId) {
      return NextResponse.json({ error: 'Нельзя отправить сообщение самому себе' }, { status: 400 })
    }

    if (groupId) {
      const member = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: myId } },
      })
      if (!member) {
        return NextResponse.json({ error: 'Нет доступа к группе' }, { status: 403 })
      }
    } else if (toId) {
      const recipient = await db.user.findUnique({ where: { id: toId } })
      if (!recipient) {
        return NextResponse.json({ error: 'Получатель не найден' }, { status: 404 })
      }
    }

    const sender = await db.user.findUnique({ where: { id: myId } })

    const message = await db.message.create({
      data: {
        fromId: myId,
        toId: toId ?? null,
        groupId: groupId ?? null,
        content: content || null,
        imageUrl: imageUrl ?? null,
        audioUrl: audioUrl ?? null,
        audioDurationSec: audioDurationSec ?? null,
      },
    })

    // -------- Send a web push notification to the recipient(s) --------
    // Fire-and-forget — don't block the response on push delivery.
    const preview =
      content || (audioUrl ? '🎤 Голосовое сообщение' : imageUrl ? '📎 Фото' : 'Сообщение')
    const senderName = sender?.name ?? 'Noldo'

    if (toId) {
      sendPushToUser(toId, {
        title: `Noldo · ${senderName}`,
        body: preview,
        tag: `dm:${myId}`,
      }).catch(() => {})
    } else if (groupId) {
      // Notify every group member except the sender
      db.groupMember
        .findMany({ where: { groupId, userId: { not: myId } } })
        .then((members) =>
          Promise.all(
            members.map((m) =>
              sendPushToUser(m.userId, {
                title: `Noldo · ${senderName} в группе`,
                body: preview,
                tag: `group:${groupId}`,
              }),
            ),
          ),
        )
        .catch(() => {})
    }

    return NextResponse.json({ message: serialize(message) })
  } catch (e) {
    console.error('[messages POST] error', e)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}

function serialize(m: {
  id: string
  content: string | null
  imageUrl: string | null
  audioUrl: string | null
  audioDurationSec: number | null
  fromId: string
  toId: string | null
  groupId: string | null
  read: boolean
  createdAt: Date
}) {
  return {
    id: m.id,
    content: m.content,
    imageUrl: m.imageUrl,
    audioUrl: m.audioUrl,
    audioDurationSec: m.audioDurationSec,
    fromId: m.fromId,
    toId: m.toId,
    groupId: m.groupId,
    read: m.read,
    createdAt: m.createdAt,
  }
}

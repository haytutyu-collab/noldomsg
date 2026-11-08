import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, Caddy uses it for routing
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Map of socket.id -> userId (presence)
const onlineUsers = new Map<string, string>()
// Reverse map: userId -> socket.id (to deliver private messages)
const userSockets = new Map<string, string>()
// Map of groupId -> Set<userId> (members currently in that group's room)
const groupMembers = new Map<string, Set<string>>()

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`)

  // Client sends their userId when they connect to the messenger.
  socket.on('identify', (data: { userId: string }) => {
    if (!data || !data.userId) return
    const { userId } = data
    onlineUsers.set(socket.id, userId)
    userSockets.set(userId, socket.id)

    // Tell everyone this user is online now
    io.emit('presence', { userId, online: true })

    // Send the new client the list of everyone currently online (except itself)
    const others = Array.from(new Set(onlineUsers.values())).filter((id) => id !== userId)
    socket.emit('presence-batch', { onlineUserIds: others })

    console.log(`[socket] ${userId} identified (${socket.id})`)
  })

  // Join a group room so group messages can be broadcast efficiently.
  socket.on('join-group', (data: { groupId: string; userId: string }) => {
    if (!data || !data.groupId || !data.userId) return
    const { groupId, userId } = data
    socket.join(`group:${groupId}`)
    if (!groupMembers.has(groupId)) groupMembers.set(groupId, new Set())
    groupMembers.get(groupId)!.add(userId)
  })

  socket.on('leave-group', (data: { groupId: string; userId: string }) => {
    if (!data || !data.groupId) return
    const { groupId, userId } = data
    socket.leave(`group:${groupId}`)
    groupMembers.get(groupId)?.delete(userId)
  })

  // Private message: send only to the recipient + echo back to sender.
  // The payload may include imageUrl / audioUrl when sending media.
  socket.on('private-message', (data: {
    id: string
    fromId: string
    toId: string
    content?: string | null
    imageUrl?: string | null
    audioUrl?: string | null
    audioDurationSec?: number | null
    createdAt: string
  }) => {
    const { id, fromId, toId } = data
    const payload = { ...data, id }

    const recipientSocketId = userSockets.get(toId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('private-message', payload)
    }
    socket.emit('private-message', payload)
  })

  // Group message: broadcast to everyone in the group room (including sender).
  socket.on('group-message', (data: {
    id: string
    fromId: string
    groupId: string
    content?: string | null
    imageUrl?: string | null
    audioUrl?: string | null
    audioDurationSec?: number | null
    createdAt: string
  }) => {
    const payload = { ...data, id: data.id }
    io.to(`group:${data.groupId}`).emit('group-message', payload)
  })

  // -------- WebRTC call signaling --------
  // Caller -> Callee: start a call
  socket.on('call-offer', (data: {
    callId: string
    fromId: string
    toId: string
    isVideo: boolean
    offer: { type: string; sdp: string }
    callerName?: string
  }) => {
    const recipientSocketId = userSockets.get(data.toId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call-offer', data)
    } else {
      // Recipient is offline — tell the caller to give up
      socket.emit('call-unreachable', { callId: data.callId, toId: data.toId })
    }
  })

  // Callee -> Caller: accept the call with an answer
  socket.on('call-answer', (data: {
    callId: string
    fromId: string
    toId: string
    answer: { type: string; sdp: string }
  }) => {
    const recipientSocketId = userSockets.get(data.toId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call-answer', data)
    }
  })

  // Either side -> other: ICE candidate exchange
  socket.on('call-ice', (data: {
    callId: string
    fromId: string
    toId: string
    candidate: unknown
  }) => {
    const recipientSocketId = userSockets.get(data.toId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call-ice', data)
    }
  })

  // Either side -> other: end the call
  socket.on('call-end', (data: { callId: string; fromId: string; toId: string; reason?: string }) => {
    const recipientSocketId = userSockets.get(data.toId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call-end', data)
    }
  })

  // Typing indicator (works for both direct and group chats)
  socket.on('typing', (data: {
    fromId: string
    toId?: string
    groupId?: string
    isTyping: boolean
  }) => {
    const { toId, groupId, isTyping, fromId } = data
    if (groupId) {
      socket.to(`group:${groupId}`).emit('typing', { fromId, groupId, isTyping })
    } else if (toId) {
      const recipientSocketId = userSockets.get(toId)
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('typing', { fromId, toId, isTyping })
      }
    }
  })

  socket.on('disconnect', () => {
    const userId = onlineUsers.get(socket.id)
    if (userId) {
      onlineUsers.delete(socket.id)
      // Remove from all group rooms
      for (const [groupId, members] of groupMembers.entries()) {
        if (members.delete(userId) && members.size === 0) {
          groupMembers.delete(groupId)
        }
      }
      // Only mark offline if no other socket is holding this user
      if (!Array.from(onlineUsers.values()).includes(userId)) {
        userSockets.delete(userId)
        io.emit('presence', { userId, online: false })
        console.log(`[socket] ${userId} went offline`)
      }
    }
    console.log(`[socket] disconnected: ${socket.id}`)
  })

  socket.on('error', (err) => {
    console.error(`[socket] error (${socket.id}):`, err)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`Noldo chat WebSocket service running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...')
  httpServer.close(() => process.exit(0))
})

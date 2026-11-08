'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { Toaster } from '@/components/ui/toaster'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ThemeToggle } from '@/components/messenger/theme-toggle'
import { VoiceRecorder } from '@/components/messenger/voice-recorder'
import { CallScreen, IncomingCallDialog, type CallState } from '@/components/messenger/call-screen'
import {
  MessageCircle,
  User as UserIcon,
  Users,
  ArrowLeft,
  Send,
  Camera,
  ImagePlus,
  LogOut,
  Edit2,
  Search,
  Plus,
  Bell,
  BellOff,
  X,
  Phone,
  Video as VideoIcon,
} from 'lucide-react'
import type { ChatMessage, ChatTarget, Contact, Group, MessengerUser } from '@/lib/messenger/types'

type View = 'chats' | 'groups' | 'profile'
type Screen = 'auth' | 'app' | 'chat'

// Convert a base64url VAPID public key to a Uint8Array for pushManager.subscribe()
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export default function Home() {
  const { toast } = useToast()
  const [me, setMe] = useState<MessengerUser | null>(null)
  const [bootLoading, setBootLoading] = useState(true)
  const [view, setView] = useState<View>('chats')
  const [target, setTarget] = useState<ChatTarget | null>(null)
  const [screen, setScreen] = useState<Screen>('auth')

  const [contacts, setContacts] = useState<Contact[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [showCreateGroup, setShowCreateGroup] = useState(false)

  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [typingFrom, setTypingFrom] = useState<string | null>(null)

  // Active or incoming call (null when no call is in progress)
  const [callState, setCallState] = useState<CallState | null>(null)
  const [callPeer, setCallPeer] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null)
  // Hidden flag: when an incoming call arrives, the dialog is shown; on accept we dispatch a window event
  // that CallScreen listens for to actually start the peer connection.

  const socketRef = useRef<Socket | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const notificationsPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)

  // Refs that mirror state — so socket event handlers (which are bound once
  // per connection) can read the latest values without re-subscribing.
  const callStateRef = useRef<CallState | null>(null)
  const contactsRef = useRef<Contact[]>([])
  useEffect(() => {
    callStateRef.current = callState
  }, [callState])
  useEffect(() => {
    contactsRef.current = contacts
  }, [contacts])

  // -------- Boot: load current session --------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        if (data?.user) {
          setMe(data.user)
          setScreen('app')
        } else {
          setScreen('auth')
        }
      } catch {
        setScreen('auth')
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // -------- Browser notification permission state --------
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      notificationsPermissionRef.current = 'unsupported'
      return
    }
    notificationsPermissionRef.current = Notification.permission
    setNotificationsEnabled(Notification.permission === 'granted')
  }, [])

  const requestNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast({ title: 'Уведомления не поддерживаются этим браузером', variant: 'destructive' })
      return
    }
    // Ask for the Notification permission first (also unlocks push)
    const perm = await Notification.requestPermission()
    notificationsPermissionRef.current = perm
    setNotificationsEnabled(perm === 'granted')
    if (perm !== 'granted') {
      toast({ title: 'Разрешение на уведомления не получено', variant: 'destructive' })
      return
    }
    // Then subscribe to web push via the service worker
    try {
      const reg = await navigator.serviceWorker.ready
      const keyRes = await fetch('/api/push/key')
      const keyData = await keyRes.json()
      if (!keyData?.publicKey) {
        toast({ title: 'Push не настроен на сервере', variant: 'destructive' })
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      })
      const subJson = sub.toJSON()
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subJson),
      })
      toast({ title: 'Уведомления включены — вы получите оповещения о новых сообщениях' })
    } catch (e) {
      console.warn('[noldo] push subscribe failed', e)
      toast({ title: 'Не удалось подписаться на push', variant: 'destructive' })
    }
  }, [toast])

  const showBrowserNotification = useCallback(
    (title: string, body: string) => {
      if (typeof document !== 'undefined' && !document.hidden) return
      if (notificationsPermissionRef.current !== 'granted') return
      try {
        new Notification(title, { body, icon: '/icon-192.png' })
      } catch {
        /* ignore */
      }
    },
    [],
  )

  // -------- Call actions --------
  // Start an outgoing call to a user (audio or video).
  const startCall = useCallback(
    (peerId: string, peerName: string, peerAvatarUrl: string | null, isVideo: boolean) => {
      if (!me || !socketRef.current) {
        toast({ title: 'Не удалось начать звонок', variant: 'destructive' })
        return
      }
      // Don't allow calls to groups in this version (WebRTC mesh is complex).
      if (target?.kind !== 'direct') {
        toast({ title: 'Звонки поддерживаются только в личных чатах', variant: 'destructive' })
        return
      }
      const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setCallPeer({ id: peerId, name: peerName, avatarUrl: peerAvatarUrl })
      setCallState({ phase: 'outgoing', callId, isVideo })
    },
    [me, target, toast],
  )

  // Reject an incoming call (or end one we already started).
  const endCall = useCallback(
    (reason?: string) => {
      if (callState && socketRef.current && me) {
        // Best-effort notify peer (CallScreen already emits on hangup, but if we
        // reject from the dialog we need to send it here).
        socketRef.current.emit('call-end', {
          callId: callState.callId,
          fromId: me.id,
          toId: callPeer?.id ?? '',
          reason: reason || 'rejected',
        })
      }
      setCallState(null)
      setCallPeer(null)
    },
    [callState, callPeer, me],
  )

  // Accept an incoming call — transition to 'connected' phase as the callee.
  // CallScreen's callee useEffect will create the PC, apply the offer, create the answer,
  // and emit call-answer over the socket.
  const acceptIncomingCall = useCallback(() => {
    if (!callState || callState.phase !== 'incoming' || !me) return
    setCallState({
      phase: 'connected',
      callId: callState.callId,
      isVideo: callState.isVideo,
      initialOffer: callState.offer,
      isCallee: true,
    } as CallState)
  }, [callState, me])

  // -------- WebSocket connection --------
  useEffect(() => {
    if (!me) return
    const socket = io('/?XTransformPort=3003', {
      path: '/',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[noldo] socket connected', socket.id)
      socket.emit('identify', { userId: me.id })
    })

    socket.on('connect_error', (err: Error) => {
      console.warn('[noldo] socket connect_error', err.message)
    })

    socket.on('presence', ({ userId, online }: { userId: string; online: boolean }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev)
        if (online) next.add(userId)
        else next.delete(userId)
        return next
      })
    })

    socket.on('presence-batch', ({ onlineUserIds: ids }: { onlineUserIds: string[] }) => {
      setOnlineUserIds(new Set(ids))
    })

    socket.on('private-message', (msg: ChatMessage) => {
      handleIncomingMessage(msg, 'direct')
    })

    socket.on('group-message', (msg: ChatMessage) => {
      handleIncomingMessage(msg, 'group')
    })

    socket.on('typing', (data: { fromId: string; isTyping: boolean }) => {
      setTypingFrom(data.isTyping ? data.fromId : null)
    })

    // -------- Incoming call signaling --------
    socket.on('call-offer', (data: {
      callId: string
      fromId: string
      isVideo: boolean
      offer: { type: string; sdp: string }
      callerName?: string
    }) => {
      if (callStateRef.current) {
        // Already in a call — reject politely
        socket.emit('call-end', {
          callId: data.callId,
          fromId: me.id,
          toId: data.fromId,
          reason: 'busy',
        })
        return
      }
      // Look up the caller in contacts (so we have name + avatar)
      const caller = contactsRef.current.find((c) => c.id === data.fromId)
      setCallPeer({
        id: data.fromId,
        name: caller?.name ?? data.callerName ?? 'Неизвестный',
        avatarUrl: caller?.avatarUrl ?? null,
      })
      setCallState({
        phase: 'incoming',
        callId: data.callId,
        fromId: data.fromId,
        fromName: caller?.name ?? data.callerName ?? 'Неизвестный',
        isVideo: data.isVideo,
        offer: data.offer as unknown as RTCSessionDescriptionInit,
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [me?.id])

  // -------- Receive a message (direct or group) --------
  const handleIncomingMessage = useCallback(
    (msg: ChatMessage, kind: 'direct' | 'group') => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })

      const isMine = msg.fromId === me?.id
      const isActive =
        target !== null &&
        ((kind === 'direct' && target.kind === 'direct' && (target.userId === msg.fromId || target.userId === msg.toId)) ||
          (kind === 'group' && target.kind === 'group' && target.groupId === msg.groupId))

      if (isMine) {
        // My own echo: update preview for the recipient
        if (kind === 'direct') {
          setContacts((prev) =>
            prev.map((c) =>
              c.id === msg.toId
                ? {
                    ...c,
                    lastMessage: {
                      content: msg.content,
                      imageUrl: msg.imageUrl,
                      audioUrl: msg.audioUrl,
                      createdAt: msg.createdAt,
                      fromId: msg.fromId,
                    },
                  }
                : c,
            ),
          )
        } else {
          setGroups((prev) =>
            prev.map((g) =>
              g.id === msg.groupId
                ? {
                    ...g,
                    lastMessage: {
                      content: msg.content,
                      imageUrl: msg.imageUrl,
                      audioUrl: msg.audioUrl,
                      createdAt: msg.createdAt,
                      fromId: msg.fromId,
                    },
                  }
                : g,
            ),
          )
        }
        return
      }

      // From someone else
      if (!isActive) {
        // Bump unread + preview
        if (kind === 'direct') {
          setContacts((prev) =>
            prev.map((c) =>
              c.id === msg.fromId
                ? {
                    ...c,
                    unreadCount: c.unreadCount + 1,
                    lastMessage: {
                      content: msg.content,
                      imageUrl: msg.imageUrl,
                      audioUrl: msg.audioUrl,
                      createdAt: msg.createdAt,
                      fromId: msg.fromId,
                    },
                  }
                : c,
            ),
          )
        } else {
          setGroups((prev) =>
            prev.map((g) =>
              g.id === msg.groupId
                ? {
                    ...g,
                    unreadCount: (g.unreadCount ?? 0) + 1,
                    lastMessage: {
                      content: msg.content,
                      imageUrl: msg.imageUrl,
                      audioUrl: msg.audioUrl,
                      createdAt: msg.createdAt,
                      fromId: msg.fromId,
                    },
                  }
                : g,
            ),
          )
        }
        // Show a browser notification if tab is hidden
        const senderName =
          kind === 'direct'
            ? contacts.find((c) => c.id === msg.fromId)?.name ?? 'Сообщение'
            : groups.find((g) => g.id === msg.groupId)?.name ?? 'Группа'
        const preview = msg.content ?? (msg.imageUrl ? '📎 Фото' : 'Сообщение')
        showBrowserNotification(`Noldo · ${senderName}`, preview)
      } else {
        // Active chat: update preview without bumping unread
        if (kind === 'direct') {
          setContacts((prev) =>
            prev.map((c) =>
              c.id === msg.fromId
                ? {
                    ...c,
                    lastMessage: {
                      content: msg.content,
                      imageUrl: msg.imageUrl,
                      audioUrl: msg.audioUrl,
                      createdAt: msg.createdAt,
                      fromId: msg.fromId,
                    },
                  }
                : c,
            ),
          )
        } else {
          setGroups((prev) =>
            prev.map((g) =>
              g.id === msg.groupId
                ? {
                    ...g,
                    lastMessage: {
                      content: msg.content,
                      imageUrl: msg.imageUrl,
                      audioUrl: msg.audioUrl,
                      createdAt: msg.createdAt,
                      fromId: msg.fromId,
                    },
                  }
                : g,
            ),
          )
        }
      }
    },
    [me?.id, target, contacts, groups, showBrowserNotification],
  )

  // -------- Load contacts + groups --------
  const refreshContacts = useCallback(async () => {
    if (!me) return
    try {
      const [u, g] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/groups', { cache: 'no-store' }).then((r) => r.json()),
      ])
      if (u?.users) setContacts(u.users)
      if (g?.groups) setGroups(g.groups)
    } catch {
      /* ignore */
    }
  }, [me])

  useEffect(() => {
    if (screen === 'app') {
      refreshContacts()
      const t = setInterval(refreshContacts, 8000)
      return () => clearInterval(t)
    }
  }, [screen, refreshContacts])

  // -------- Open a chat --------
  const openChat = useCallback(async (t: ChatTarget) => {
    setTarget(t)
    setScreen('chat')
    setTypingFrom(null)

    // Join socket room if group (so group messages are broadcast to us)
    if (t.kind === 'group' && socketRef.current && me) {
      socketRef.current.emit('join-group', { groupId: t.groupId, userId: me.id })
    }

    try {
      const url =
        t.kind === 'direct'
          ? `/api/messages?with=${t.userId}`
          : `/api/messages?group=${t.groupId}`
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      setMessages(data?.messages ?? [])
      // Clear unread locally
      if (t.kind === 'direct') {
        setContacts((prev) =>
          prev.map((c) => (c.id === t.userId ? { ...c, unreadCount: 0 } : c)),
        )
      } else {
        setGroups((prev) =>
          prev.map((g) => (g.id === t.groupId ? { ...g, unreadCount: 0 } : g)),
        )
      }
    } catch {
      setMessages([])
    }
  }, [me])

  // -------- Send a message (text and/or image) --------
  const sendMessage = useCallback(
    async (override?: { content?: string; imageUrl?: string; audioUrl?: string; audioDurationSec?: number }) => {
      if (!me || !target) return
      const content = override?.content ?? draft.trim()
      const imageUrl = override?.imageUrl
      const audioUrl = override?.audioUrl
      const audioDurationSec = override?.audioDurationSec

      if (!content && !imageUrl && !audioUrl) return

      const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const createdAt = new Date().toISOString()
      const optimistic: ChatMessage = {
        id: tempId,
        content: content || null,
        imageUrl: imageUrl ?? null,
        audioUrl: audioUrl ?? null,
        audioDurationSec: audioDurationSec ?? null,
        fromId: me.id,
        toId: target.kind === 'direct' ? target.userId : null,
        groupId: target.kind === 'group' ? target.groupId : null,
        read: false,
        createdAt,
      }
      setMessages((prev) => [...prev, optimistic])
      if (!override) setDraft('')

      try {
        const body: Record<string, unknown> = {}
        if (content) body.content = content
        if (imageUrl) body.imageUrl = imageUrl
        if (audioUrl) body.audioUrl = audioUrl
        if (audioDurationSec) body.audioDurationSec = audioDurationSec
        if (target.kind === 'direct') body.toId = target.userId
        else body.groupId = target.groupId

        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (data?.message) {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)))
          // Broadcast over websocket
          if (target.kind === 'direct') {
            socketRef.current?.emit('private-message', data.message)
          } else {
            // Make sure I'm in the group room (so I receive my own echo)
            socketRef.current?.emit('join-group', { groupId: target.groupId, userId: me.id })
            socketRef.current?.emit('group-message', data.message)
          }
        }
      } catch {
        toast({ title: 'Не удалось отправить сообщение', variant: 'destructive' })
      }

      // Clear typing
      if (target.kind === 'direct') {
        socketRef.current?.emit('typing', {
          fromId: me.id,
          toId: target.userId,
          isTyping: false,
        })
      } else {
        socketRef.current?.emit('typing', {
          fromId: me.id,
          groupId: target.groupId,
          isTyping: false,
        })
      }
    },
    [me, target, draft, toast],
  )

  // -------- Send a voice recording --------
  const handleVoiceSend = useCallback(
    async (blob: Blob, durationSec: number) => {
      if (!me || !target) return
      try {
        const fd = new FormData()
        const ext = blob.type.includes('webm')
          ? 'webm'
          : blob.type.includes('ogg')
          ? 'ogg'
          : blob.type.includes('mp3')
          ? 'mp3'
          : blob.type.includes('wav')
          ? 'wav'
          : 'webm'
        fd.append('file', blob, `voice.${ext}`)
        const up = await fetch('/api/upload?type=audio', { method: 'POST', body: fd })
        const upData = await up.json()
        if (!up.ok) {
          toast({ title: upData?.error ?? 'Не удалось загрузить запись', variant: 'destructive' })
          return
        }
        await sendMessage({ audioUrl: upData.url, audioDurationSec: durationSec })
      } catch {
        toast({ title: 'Не удалось отправить голосовое', variant: 'destructive' })
      }
    },
    [me, target, sendMessage, toast],
  )

  // -------- Typing indicator --------
  const lastTypingSent = useRef(false)
  const handleDraftChange = (value: string) => {
    setDraft(value)
    if (!me || !target || !socketRef.current) return
    const isTyping = value.length > 0
    if (isTyping !== lastTypingSent.current) {
      lastTypingSent.current = isTyping
      if (target.kind === 'direct') {
        socketRef.current.emit('typing', { fromId: me.id, toId: target.userId, isTyping })
      } else {
        socketRef.current.emit('typing', { fromId: me.id, groupId: target.groupId, isTyping })
      }
    }
  }

  // -------- Auth actions --------
  const handleRegister = async (name: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data?.error ?? 'Ошибка', variant: 'destructive' })
        return false
      }
      setMe(data.user)
      setScreen('app')
      return true
    } catch {
      toast({ title: 'Не удалось зарегистрироваться', variant: 'destructive' })
      return false
    }
  }

  const handleLogin = async (name: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data?.error ?? 'Ошибка', variant: 'destructive' })
        return false
      }
      setMe(data.user)
      setScreen('app')
      return true
    } catch {
      toast({ title: 'Не удалось войти', variant: 'destructive' })
      return false
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* ignore */
    }
    setMe(null)
    setTarget(null)
    setMessages([])
    setContacts([])
    setGroups([])
    setScreen('auth')
  }

  // -------- Avatar upload --------
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !me) return
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch('/api/upload?type=avatar', { method: 'POST', body: fd })
      const upData = await up.json()
      if (!up.ok) {
        toast({ title: upData?.error ?? 'Не удалось загрузить фото', variant: 'destructive' })
        return
      }
      const prof = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: upData.url }),
      })
      const profData = await prof.json()
      if (prof.ok) {
        setMe(profData.user)
        toast({ title: 'Аватар обновлён' })
      }
    } catch {
      toast({ title: 'Не удалось обновить фото', variant: 'destructive' })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // -------- Image attachment in chat --------
  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !me || !target) return
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch('/api/upload?type=attachment', { method: 'POST', body: fd })
      const upData = await up.json()
      if (!up.ok) {
        toast({ title: upData?.error ?? 'Не удалось загрузить фото', variant: 'destructive' })
        return
      }
      // Send the message with imageUrl only (no text)
      await sendMessage({ imageUrl: upData.url })
    } catch {
      toast({ title: 'Не удалось отправить фото', variant: 'destructive' })
    } finally {
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  // -------- Profile save --------
  const handleSaveProfile = async (name: string, bio: string) => {
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio }),
      })
      const data = await res.json()
      if (res.ok) {
        setMe(data.user)
        toast({ title: 'Профиль сохранён' })
      } else {
        toast({ title: data?.error ?? 'Ошибка', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Не удалось сохранить', variant: 'destructive' })
    }
  }

  // -------- Create group --------
  const handleCreateGroup = async (name: string, memberIds: string[]) => {
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, memberIds }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data?.error ?? 'Ошибка', variant: 'destructive' })
        return false
      }
      toast({ title: `Группа «${data.group.name}» создана` })
      await refreshContacts()
      setShowCreateGroup(false)
      return true
    } catch {
      toast({ title: 'Не удалось создать группу', variant: 'destructive' })
      return false
    }
  }

  // -------- Derived data --------
  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) => c.name.toLowerCase().includes(q))
  }, [contacts, search])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.name.toLowerCase().includes(q))
  }, [groups, search])

  const initials = (name: string) =>
    name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const today = new Date()
    const sameDay =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
  }

  // -------- Loading splash --------
  if (bootLoading) {
    return <SplashScreen />
  }

  // -------- Auth screen --------
  if (screen === 'auth' || !me) {
    return <AuthScreen onRegister={handleRegister} onLogin={handleLogin} />
  }

  // -------- Chat view --------
  if (screen === 'chat' && target) {
    return (
      <>
        <ChatView
          target={target}
          me={me}
          messages={messages}
          draft={draft}
          onDraftChange={handleDraftChange}
          onSend={() => sendMessage()}
          onVoiceSend={handleVoiceSend}
          onBack={() => {
            if (target.kind === 'group' && socketRef.current && me) {
              socketRef.current.emit('leave-group', { groupId: target.groupId, userId: me.id })
            }
            setScreen('app')
            setTarget(null)
            setMessages([])
          }}
          online={
            target.kind === 'direct'
              ? onlineUserIds.has(target.userId)
              : target.members.some((m) => onlineUserIds.has(m.id) && m.id !== me.id)
          }
          typing={
            target.kind === 'direct'
              ? typingFrom === target.userId
              : typingFrom !== null && target.members.some((m) => m.id === typingFrom)
          }
          onAttachment={() => attachmentInputRef.current?.click()}
          onAttachmentSelected={handleAttachment}
          attachmentInputRef={attachmentInputRef}
          initials={initials}
          formatTime={formatTime}
          onCall={(isVideo) => {
            if (target.kind === 'direct') {
              startCall(target.userId, target.name, target.avatarUrl, isVideo)
            } else {
              toast({ title: 'Звонки в группах пока не поддерживаются', variant: 'destructive' })
            }
          }}
        />
        {/* Active call (outgoing or connected) */}
        {callState && callState.phase !== 'incoming' && callPeer && (
          <CallScreen
            state={callState}
            myId={me.id}
            peerId={callPeer.id}
            peerName={callPeer.name}
            peerAvatarUrl={callPeer.avatarUrl}
            socket={socketRef.current}
            onEnd={() => endCall('hangup')}
          />
        )}
        {/* Incoming call dialog */}
        {callState && callState.phase === 'incoming' && callPeer && (
          <IncomingCallDialog
            callerName={callPeer.name}
            callerAvatarUrl={callPeer.avatarUrl}
            isVideo={callState.isVideo}
            onAccept={acceptIncomingCall}
            onReject={() => endCall('rejected')}
          />
        )}
      </>
    )
  }

  // -------- Profile view --------
  if (view === 'profile') {
    return (
      <>
        <ProfileScreen
          me={me}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={requestNotifications}
          onBack={() => setView('chats')}
          onLogout={handleLogout}
          onAvatarChange={handleAvatarChange}
          onSave={handleSaveProfile}
          fileInputRef={fileInputRef}
          initials={initials(me.name)}
        />
        {/* Incoming calls ring even when not on the chat screen */}
        {callState && callState.phase === 'incoming' && callPeer && (
          <IncomingCallDialog
            callerName={callPeer.name}
            callerAvatarUrl={callPeer.avatarUrl}
            isVideo={callState.isVideo}
            onAccept={acceptIncomingCall}
            onReject={() => endCall('rejected')}
          />
        )}
        {callState && callState.phase !== 'incoming' && callPeer && (
          <CallScreen
            state={callState}
            myId={me.id}
            peerId={callPeer.id}
            peerName={callPeer.name}
            peerAvatarUrl={callPeer.avatarUrl}
            socket={socketRef.current}
            onEnd={() => endCall('hangup')}
          />
        )}
      </>
    )
  }

  // -------- Main: list (chats or groups) --------
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold">
            N
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight">Noldo</h1>
            <p className="text-xs text-muted-foreground">
              {view === 'chats'
                ? onlineUserIds.size > 0
                  ? `${onlineUserIds.size} онлайн`
                  : 'Контакты'
                : view === 'groups'
                ? 'Групповые чаты'
                : ''}
            </p>
          </div>
          <ThemeToggle />
          <button
            onClick={() => setView('profile')}
            className="rounded-full"
            aria-label="Профиль"
          >
            <Avatar className="w-9 h-9 border">
              <AvatarImage src={me.avatarUrl ?? undefined} alt={me.name} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials(me.name)}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={view === 'groups' ? 'Поиск групп…' : 'Поиск родных…'}
              className="pl-9 h-9 bg-muted/40 border-0"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted"
                aria-label="Очистить"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {view === 'groups' && (
            <Button
              size="icon"
              className="h-9 w-9 rounded-full bg-primary hover:bg-primary/90"
              onClick={() => setShowCreateGroup(true)}
              aria-label="Создать группу"
            >
              <Plus className="w-5 h-5" />
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {view === 'chats' ? (
            filteredContacts.length === 0 ? (
              <EmptyContactsHint meName={me.name} />
            ) : (
              <ul className="divide-y">
                {filteredContacts.map((c) => (
                  <ContactItem
                    key={c.id}
                    contact={c}
                    online={onlineUserIds.has(c.id)}
                    meId={me.id}
                    onClick={() =>
                      openChat({
                        kind: 'direct',
                        userId: c.id,
                        name: c.name,
                        avatarUrl: c.avatarUrl,
                      })
                    }
                    formatTime={formatTime}
                    initials={initials(c.name)}
                  />
                ))}
              </ul>
            )
          ) : filteredGroups.length === 0 ? (
            <EmptyGroupsHint onCreate={() => setShowCreateGroup(true)} />
          ) : (
            <ul className="divide-y">
              {filteredGroups.map((g) => (
                <GroupItem
                  key={g.id}
                  group={g}
                  meId={me.id}
                  onClick={() =>
                    openChat({
                      kind: 'group',
                      groupId: g.id,
                      name: g.name,
                      avatarUrl: g.avatarUrl,
                      members: g.members,
                    })
                  }
                  formatTime={formatTime}
                />
              ))}
            </ul>
          )}
        </div>
      </main>

      <BottomNav view={view} setView={setView} />
      <Toaster />

      {showCreateGroup && (
        <CreateGroupDialog
          contacts={contacts}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {/* Calls overlay (also on the chat list / groups screens) */}
      {callState && callPeer && callState.phase === 'incoming' && (
        <IncomingCallDialog
          callerName={callPeer.name}
          callerAvatarUrl={callPeer.avatarUrl}
          isVideo={callState.isVideo}
          onAccept={acceptIncomingCall}
          onReject={() => endCall('rejected')}
        />
      )}
      {callState && callPeer && callState.phase !== 'incoming' && (
        <CallScreen
          state={callState}
          myId={me.id}
          peerId={callPeer.id}
          peerName={callPeer.name}
          peerAvatarUrl={callPeer.avatarUrl}
          socket={socketRef.current}
          onEnd={() => endCall('hangup')}
        />
      )}
    </div>
  )
}

// =================================================================
// Subcomponents
// =================================================================

function SplashScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-primary">
        <div className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-2xl shadow-lg">
          N
        </div>
        <p className="text-sm text-muted-foreground">Noldo загружается…</p>
      </div>
    </div>
  )
}

function AuthScreen({
  onRegister,
  onLogin,
}: {
  onRegister: (name: string, password: string) => Promise<boolean>
  onLogin: (name: string, password: string) => Promise<boolean>
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !password) return
    setSubmitting(true)
    if (mode === 'register') {
      await onRegister(name.trim(), password)
    } else {
      await onLogin(name.trim(), password)
    }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-primary/10 to-background px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20 mb-4 font-bold text-4xl">
            N
          </div>
          <h1 className="text-2xl font-bold">Noldo</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            Мессенджер для родных. Общайтесь, делитесь фото, создавайте группы.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg mb-4">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`py-2 text-sm font-medium rounded-md transition ${
              mode === 'login' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            }`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`py-2 text-sm font-medium rounded-md transition ${
              mode === 'register' ? 'bg-background shadow-sm' : 'text-muted-foreground'
            }`}
          >
            Регистрация
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя"
            className="h-12 text-base"
            maxLength={40}
            autoComplete="username"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="h-12 text-base"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={4}
          />
          <Button
            type="submit"
            disabled={submitting || !name.trim() || !password}
            className="w-full h-12 text-base"
          >
            {submitting ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          {mode === 'register'
            ? 'Запомните имя и пароль — они нужны для входа на другом устройстве.'
            : 'Если забыли пароль — создайте новое имя.'}
        </p>

        <div className="mt-6 pt-6 border-t">
          <p className="text-xs text-muted-foreground text-center mb-3">
            Чтобы установить Noldo как приложение:
          </p>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Откройте эту страницу в Safari (iPhone) или Chrome (Android)</li>
            <li>Нажмите «Поделиться» → «На экран „Домой“»</li>
            <li>Запустите Noldo с иконки — будет полноэкранный режим</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

function ContactItem({
  contact,
  online,
  meId,
  onClick,
  formatTime,
  initials,
}: {
  contact: Contact
  online: boolean
  meId: string
  onClick: () => void
  formatTime: (iso: string) => string
  initials: string
}) {
  const preview = contact.lastMessage
    ? (contact.lastMessage.fromId === meId ? 'Вы: ' : '') +
      (contact.lastMessage.content ||
        (contact.lastMessage.audioUrl ? '🎤 Голосовое' : '') ||
        (contact.lastMessage.imageUrl ? '📎 Фото' : ''))
    : contact.bio || 'Нет сообщений'

  return (
    <li>
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition text-left"
      >
        <div className="relative">
          <Avatar className="w-12 h-12 border">
            <AvatarImage src={contact.avatarUrl ?? undefined} alt={contact.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          {online && (
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-primary border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium truncate">{contact.name}</p>
            {contact.lastMessage && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                {formatTime(contact.lastMessage.createdAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground truncate">{preview}</p>
            {contact.unreadCount > 0 && (
              <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] flex items-center justify-center font-semibold">
                {contact.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

function GroupItem({
  group,
  meId,
  onClick,
  formatTime,
}: {
  group: Group
  meId: string
  onClick: () => void
  formatTime: (iso: string) => string
}) {
  const initials = group.name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const preview = group.lastMessage
    ? (group.lastMessage.fromId === meId ? 'Вы: ' : '') +
      (group.lastMessage.content ||
        (group.lastMessage.audioUrl ? '🎤 Голосовое' : '') ||
        (group.lastMessage.imageUrl ? '📎 Фото' : ''))
    : `${group.members.length} участников`
  const online = group.members.some((m) => m.id !== meId)

  return (
    <li>
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition text-left"
      >
        <Avatar className="w-12 h-12 border">
          <AvatarImage src={group.avatarUrl ?? undefined} alt={group.name} />
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
            <Users className="w-5 h-5" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium truncate">{group.name}</p>
            {group.lastMessage && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                {formatTime(group.lastMessage.createdAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground truncate">{preview}</p>
            {group.unreadCount && group.unreadCount > 0 ? (
              <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] flex items-center justify-center font-semibold">
                {group.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  )
}

function ChatView({
  target,
  me,
  messages,
  draft,
  onDraftChange,
  onSend,
  onVoiceSend,
  onBack,
  online,
  typing,
  onAttachment,
  onAttachmentSelected,
  attachmentInputRef,
  initials,
  formatTime,
  onCall,
}: {
  target: ChatTarget
  me: MessengerUser
  messages: ChatMessage[]
  draft: string
  onDraftChange: (v: string) => void
  onSend: () => void
  onVoiceSend: (blob: Blob, durationSec: number) => void
  onBack: () => void
  online: boolean
  typing: boolean
  onAttachment: () => void
  onAttachmentSelected: (e: React.ChangeEvent<HTMLInputElement>) => void
  attachmentInputRef: React.RefObject<HTMLInputElement | null>
  initials: (name: string) => string
  formatTime: (iso: string) => string
  onCall: (isVideo: boolean) => void
}) {
  const localEndRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    localEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const title = target.name
  const subtitle = target.kind === 'group'
    ? `${target.members.length} участников`
    : typing ? 'печатает…' : (online ? 'в сети' : 'не в сети')

  const canCall = target.kind === 'direct'

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Назад"
            className="p-2 -ml-2 rounded-full hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Avatar className="w-10 h-10 border">
            <AvatarImage src={target.avatarUrl ?? undefined} alt={title} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {target.kind === 'group' ? <Users className="w-5 h-5" /> : initials(title)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          {canCall && (
            <>
              <button
                onClick={() => onCall(false)}
                aria-label="Аудиозвонок"
                className="p-2 rounded-full hover:bg-muted text-primary"
              >
                <Phone className="w-5 h-5" />
              </button>
              <button
                onClick={() => onCall(true)}
                aria-label="Видеозвонок"
                className="p-2 rounded-full hover:bg-muted text-primary"
              >
                <VideoIcon className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 bg-muted/30">
        <div className="max-w-2xl mx-auto space-y-2">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <MessageCircle className="w-8 h-8 text-primary" />
              </div>
              <p className="text-muted-foreground">Пока нет сообщений. Напишите первым!</p>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.fromId === me.id
              const showSender =
                target.kind === 'group' && !mine
              const sender =
                target.kind === 'group'
                  ? target.members.find((mem) => mem.id === m.fromId)?.name ?? '?'
                  : ''
              return (
                <div
                  key={m.id}
                  className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                      mine
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-background border rounded-bl-md'
                    }`}
                  >
                    {showSender && (
                      <p className="text-[11px] font-semibold text-primary mb-0.5">
                        {sender}
                      </p>
                    )}
                    {m.imageUrl && (
                      <a href={m.imageUrl} target="_blank" rel="noreferrer" className="block mb-1">
                        <img
                          src={m.imageUrl}
                          alt="Фото из чата"
                          className="rounded-lg max-w-full max-h-72 object-cover"
                        />
                      </a>
                    )}
                    {m.audioUrl && (
                      <div className="mb-1 flex items-center gap-2">
                        <audio
                          controls
                          src={m.audioUrl}
                          preload="metadata"
                          className="h-9 max-w-[220px]"
                        />
                        {m.audioDurationSec ? (
                          <span
                            className={`text-[10px] ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
                          >
                            {Math.floor(m.audioDurationSec / 60)}:{(m.audioDurationSec % 60).toString().padStart(2, '0')}
                          </span>
                        ) : null}
                      </div>
                    )}
                    {m.content && (
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    )}
                    <p
                      className={`text-[10px] mt-1 ${
                        mine ? 'text-primary-foreground/70' : 'text-muted-foreground'
                      }`}
                    >
                      {formatTime(m.createdAt)}
                    </p>
                  </div>
                </div>
              )
            })
          )}
          <div ref={localEndRef} />
        </div>
      </div>

      <div className="sticky bottom-0 bg-background border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-2xl mx-auto p-3 flex items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full w-11 h-11 p-0 shrink-0"
            onClick={onAttachment}
            aria-label="Прикрепить фото"
          >
            <ImagePlus className="w-5 h-5" />
          </Button>
          <input
            ref={attachmentInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onAttachmentSelected}
          />
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            rows={1}
            placeholder="Сообщение…"
            className="resize-none max-h-32 min-h-11 bg-muted/40 border-0 flex-1"
          />
          {draft.trim() ? (
            <Button
              onClick={onSend}
              className="rounded-full w-11 h-11 p-0 shrink-0"
              aria-label="Отправить"
            >
              <Send className="w-5 h-5" />
            </Button>
          ) : (
            <VoiceRecorder
              onSend={onVoiceSend}
              onCancel={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function BottomNav({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <nav className="sticky bottom-0 bg-background border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-2xl mx-auto grid grid-cols-3">
        <NavButton
          active={view === 'chats'}
          onClick={() => setView('chats')}
          icon={<MessageCircle className="w-5 h-5" />}
          label="Чаты"
        />
        <NavButton
          active={view === 'groups'}
          onClick={() => setView('groups')}
          icon={<Users className="w-5 h-5" />}
          label="Группы"
        />
        <NavButton
          active={view === 'profile'}
          onClick={() => setView('profile')}
          icon={<UserIcon className="w-5 h-5" />}
          label="Профиль"
        />
      </div>
    </nav>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-2.5 transition ${
        active ? 'text-primary' : 'text-muted-foreground'
      }`}
    >
      {icon}
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  )
}

function EmptyContactsHint({ meName }: { meName: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <MessageCircle className="w-8 h-8 text-primary" />
      </div>
      <h2 className="font-semibold text-lg">Привет, {meName}!</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
        Здесь появятся ваши родные. Попросите их открыть эту же ссылку и
        зарегистрироваться под другим именем — и вы сразу увидите друг друга в списке чатов.
      </p>
    </div>
  )
}

function EmptyGroupsHint({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Users className="w-8 h-8 text-primary" />
      </div>
      <h2 className="font-semibold text-lg">Групп пока нет</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto mb-4">
        Создайте семейный групповой чат, чтобы общаться сразу со всеми.
      </p>
      <Button onClick={onCreate} className="bg-primary hover:bg-primary/90">
        <Plus className="w-4 h-4 mr-1.5" />
        Создать группу
      </Button>
    </div>
  )
}

function ProfileScreen({
  me,
  notificationsEnabled,
  onToggleNotifications,
  onBack,
  onLogout,
  onAvatarChange,
  onSave,
  fileInputRef,
  initials,
}: {
  me: MessengerUser
  notificationsEnabled: boolean
  onToggleNotifications: () => void
  onBack: () => void
  onLogout: () => void
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onSave: (name: string, bio: string) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  initials: string
}) {
  const [name, setName] = useState(me.name)
  const [bio, setBio] = useState(me.bio ?? '')

  const dirty = name.trim() !== me.name || bio !== (me.bio ?? '')

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-3 py-3 flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Назад"
            className="p-2 -ml-2 rounded-full hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-semibold flex-1">Профиль</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          <div className="flex flex-col items-center">
            <div className="relative">
              <Avatar className="w-28 h-28 border-2 border-primary/20 shadow-sm">
                <AvatarImage src={me.avatarUrl ?? undefined} alt={me.name} />
                <AvatarFallback className="bg-primary/10 text-primary text-3xl font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90"
                aria-label="Сменить аватар"
              >
                <Camera className="w-5 h-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onAvatarChange}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Нажмите на фотоаппарат, чтобы поставить фото</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Имя</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">О себе</label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="Например: мама, бабушка, брат…"
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{bio.length}/200</p>
            </div>
          </div>

          <Button
            onClick={() => onSave(name, bio)}
            disabled={!dirty || !name.trim()}
            className="w-full h-11"
          >
            <Edit2 className="w-4 h-4 mr-1.5" />
            Сохранить изменения
          </Button>

          {/* Notifications toggle */}
          <div className="rounded-lg border p-4 flex items-center gap-3">
            {notificationsEnabled ? <Bell className="w-5 h-5 text-primary" /> : <BellOff className="w-5 h-5 text-muted-foreground" />}
            <div className="flex-1">
              <p className="text-sm font-medium">Уведомления</p>
              <p className="text-xs text-muted-foreground">
                {notificationsEnabled ? 'Включены — вы увидите оповещения о новых сообщениях' : 'Показывать уведомления о новых сообщениях'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onToggleNotifications}>
              {notificationsEnabled ? 'Настроены' : 'Включить'}
            </Button>
          </div>

          {/* PWA install hint */}
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium mb-1">Установить как приложение</p>
            <p className="text-xs text-muted-foreground">
              Откройте Noldo в Safari (iPhone) или Chrome (Android), нажмите «Поделиться» → «На экран Домой». Появится иконка Noldo, и мессенджер будет открываться в полноэкранном режиме, как обычное приложение.
            </p>
          </div>

          <div className="pt-4 border-t">
            <Button
              variant="ghost"
              onClick={onLogout}
              className="w-full h-11 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4 mr-1.5" />
              Выйти из аккаунта
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}

function CreateGroupDialog({
  contacts,
  onClose,
  onCreate,
}: {
  contacts: Contact[]
  onClose: () => void
  onCreate: (name: string, memberIds: string[]) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (!name.trim() || selected.size === 0) return
    setSubmitting(true)
    await onCreate(name.trim(), Array.from(selected))
    setSubmitting(false)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новая группа</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название группы (например, «Наша семья»)"
            maxLength={60}
          />
          <div>
            <p className="text-sm font-medium mb-2">Участники ({selected.size})</p>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Пока нет других пользователей. Попросите родных зарегистрироваться.
              </p>
            ) : (
              <ScrollArea className="h-72 pr-2">
                <ul className="space-y-1">
                  {contacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        className={`w-full flex items-center gap-3 p-2 rounded-md transition text-left ${
                          selected.has(c.id) ? 'bg-primary/10' : 'hover:bg-muted'
                        }`}
                      >
                        <Avatar className="w-9 h-9 border">
                          <AvatarImage src={c.avatarUrl ?? undefined} alt={c.name} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                            {c.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="flex-1 text-sm font-medium truncate">{c.name}</span>
                        {selected.has(c.id) && (
                          <Badge variant="default" className="bg-primary">
                            Выбран
                          </Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || selected.size === 0}
            className="bg-primary hover:bg-primary/90"
          >
            {submitting ? 'Создание…' : 'Создать группу'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

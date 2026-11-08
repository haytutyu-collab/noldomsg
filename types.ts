// Shared types for the Noldo messenger UI

export type MessengerUser = {
  id: string
  name: string
  avatarUrl: string | null
  bio?: string | null
}

export type Contact = MessengerUser & {
  lastMessage: {
    content: string | null
    imageUrl: string | null
    audioUrl: string | null
    createdAt: string
    fromId: string
  } | null
  unreadCount: number
}

export type GroupMember = MessengerUser

export type Group = {
  id: string
  name: string
  avatarUrl: string | null
  createdAt: string
  members: GroupMember[]
  lastMessage?: {
    content: string | null
    imageUrl: string | null
    audioUrl: string | null
    createdAt: string
    fromId: string
  } | null
  unreadCount?: number
}

export type ChatMessage = {
  id: string
  content: string | null
  imageUrl: string | null
  audioUrl: string | null
  audioDurationSec: number | null
  fromId: string
  toId: string | null
  groupId: string | null
  read: boolean
  createdAt: string
}

// Discriminated chat target the user has opened
export type ChatTarget =
  | { kind: 'direct'; userId: string; name: string; avatarUrl: string | null }
  | { kind: 'group'; groupId: string; name: string; avatarUrl: string | null; members: GroupMember[] }

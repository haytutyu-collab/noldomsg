'use client'

import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, User as UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { Socket } from 'socket.io-client'

// Free Google STUN servers. For users behind strict NATs (carrier-grade NAT,
// corporate firewalls) you'd also need a TURN server — see deployment docs.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type CallState =
  | { phase: 'outgoing'; callId: string; isVideo: boolean }
  | { phase: 'incoming'; callId: string; fromId: string; fromName: string; isVideo: boolean; offer: RTCSessionDescriptionInit }
  | { phase: 'connected'; callId: string; isVideo: boolean; initialOffer?: RTCSessionDescriptionInit; isCallee?: boolean }

type Props = {
  state: CallState
  // My user id (so we know which side of the call we're on)
  myId: string
  // Recipient user id (the other party)
  peerId: string
  peerName: string
  peerAvatarUrl?: string | null
  socket: Socket | null
  onEnd: (reason?: string) => void
}

export function CallScreen({ state, myId, peerId, peerName, peerAvatarUrl, socket, onEnd }: Props) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(state.isVideo)
  const [statusText, setStatusText] = useState<string>(
    state.phase === 'outgoing'
      ? 'Вызов…'
      : state.phase === 'incoming'
      ? 'Входящий звонок'
      : 'Соединено',
  )
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---- Helper: tear down everything ----
  const hangup = (reason?: string) => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    if (socket && state.callId) {
      socket.emit('call-end', {
        callId: state.callId,
        fromId: myId,
        toId: peerId,
        reason: reason || 'hangup',
      })
    }
    onEnd(reason)
  }

  // ---- Helper: set up the peer connection and ICE/SDP handlers ----
  const setupPeerConnection = (): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) {
        socket.emit('call-ice', {
          callId: state.callId,
          fromId: myId,
          toId: peerId,
          candidate: e.candidate.toJSON(),
        })
      }
    }

    pc.ontrack = (e) => {
      const remoteVideo = remoteVideoRef.current
      if (remoteVideo && e.streams[0]) {
        remoteVideo.srcObject = e.streams[0]
        remoteVideo.play().catch(() => {})
      }
    }

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') {
        setStatusText('Соединено')
        if (!timerRef.current) {
          const start = Date.now()
          timerRef.current = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000))
          }, 1000)
        }
      } else if (s === 'disconnected') {
        setStatusText('Соединение потеряно…')
      } else if (s === 'failed') {
        hangup('failed')
      } else if (s === 'closed') {
        // already cleaned up
      }
    }

    pcRef.current = pc
    return pc
  }

  // ---- Helper: get user media and attach to peer connection ----
  const attachLocalMedia = async (pc: RTCPeerConnection, isVideo: boolean): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo ? { facingMode: 'user' } : false,
    })
    localStreamRef.current = stream
    const localVideo = localVideoRef.current
    if (localVideo && isVideo) {
      localVideo.srcObject = stream
      localVideo.muted = true
      localVideo.play().catch(() => {})
    }
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    return stream
  }

  // ---- Outgoing call: create offer ----
  useEffect(() => {
    if (state.phase !== 'outgoing') return
    let cancelled = false

    ;(async () => {
      try {
        const pc = setupPeerConnection()
        await attachLocalMedia(pc, state.isVideo)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        if (cancelled) return
        socket?.emit('call-offer', {
          callId: state.callId,
          fromId: myId,
          toId: peerId,
          isVideo: state.isVideo,
          offer: { type: offer.type, sdp: offer.sdp },
          callerName: '',
        })
        setStatusText('Вызов…')
      } catch (e) {
        console.error('[call] outgoing setup failed', e)
        hangup('setup-failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [state.phase, state.callId])

  // ---- Callee path: parent transitioned us to 'connected' with isCallee=true
  //      after the user accepted. Apply the original offer and create an answer.
  useEffect(() => {
    if (state.phase !== 'connected') return
    if (!state.isCallee || !state.initialOffer) return
    let cancelled = false

    ;(async () => {
      try {
        const pc = setupPeerConnection()
        await attachLocalMedia(pc, state.isVideo)
        await pc.setRemoteDescription(state.initialOffer)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        if (cancelled) return
        socket?.emit('call-answer', {
          callId: state.callId,
          fromId: myId,
          toId: peerId,
          answer: { type: answer.type, sdp: answer.sdp },
        })
        setStatusText('Соединение…')
      } catch (e) {
        console.error('[call] callee setup failed', e)
        hangup('setup-failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [state.phase, state.callId])

  // ---- Listen for signaling events for this call ----
  useEffect(() => {
    if (!socket) return

    const onAnswer = async (data: { callId: string; answer: RTCSessionDescriptionInit }) => {
      if (data.callId !== state.callId) return
      const pc = pcRef.current
      if (!pc) return
      try {
        await pc.setRemoteDescription(data.answer)
        setStatusText('Соединение…')
      } catch (e) {
        console.error('[call] setRemoteDescription(answer) failed', e)
      }
    }

    const onIce = async (data: { callId: string; candidate: RTCIceCandidateInit }) => {
      if (data.callId !== state.callId) return
      const pc = pcRef.current
      if (!pc) return
      try {
        await pc.addIceCandidate(data.candidate)
      } catch (e) {
        console.warn('[call] addIceCandidate failed', e)
      }
    }

    const onEnd = (data: { callId: string; reason?: string }) => {
      if (data.callId !== state.callId) return
      // The other side ended the call — clean up locally without sending call-end again.
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
        localStreamRef.current = null
      }
      onEndCleanup(data.reason || 'peer-ended')
    }

    const onUnreachable = (data: { callId: string }) => {
      if (data.callId !== state.callId) return
      onEndCleanup('unreachable')
    }

    const onEndCleanup = (reason: string) => {
      // Avoid double-emit of call-end by calling onEnd directly
      onEndOuter(reason)
    }
    const onEndOuter = (reason: string) => {
      // The cleanup function (defined later) — but to avoid name collisions we
      // just inline the same teardown here.
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
        localStreamRef.current = null
      }
      onEnd(reason)
    }

    socket.on('call-answer', onAnswer)
    socket.on('call-ice', onIce)
    socket.on('call-end', onEnd)
    socket.on('call-unreachable', onUnreachable)

    return () => {
      socket.off('call-answer', onAnswer)
      socket.off('call-ice', onIce)
      socket.off('call-end', onEnd)
      socket.off('call-unreachable', onUnreachable)
    }
  }, [socket, state.callId])

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (pcRef.current) pcRef.current.close()
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const toggleMic = () => {
    const stream = localStreamRef.current
    if (!stream) return
    const audio = stream.getAudioTracks()
    audio.forEach((t) => (t.enabled = !micOn))
    setMicOn(!micOn)
  }

  const toggleCam = () => {
    const stream = localStreamRef.current
    if (!stream) return
    const video = stream.getVideoTracks()
    video.forEach((t) => (t.enabled = !camOn))
    setCamOn(!camOn)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const isVideo = state.isVideo

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Remote video / avatar */}
      <div className="flex-1 relative overflow-hidden bg-gradient-to-b from-primary/10 to-background">
        {isVideo && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        )}
        {!isVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <Avatar className="w-32 h-32 border-4 border-primary/20">
              <AvatarImage src={peerAvatarUrl ?? undefined} alt={peerName} />
              <AvatarFallback className="bg-primary/10 text-primary text-5xl font-semibold">
                {peerName.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || (
                  <UserIcon className="w-12 h-12" />
                )}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-2xl font-semibold">{peerName}</h2>
            <p className="text-muted-foreground">{statusText}</p>
            {elapsed > 0 && <p className="text-sm font-mono">{formatTime(elapsed)}</p>}
          </div>
        )}
        {isVideo && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/40 text-white px-4 py-1.5 rounded-full text-sm backdrop-blur">
            {peerName} · {statusText}{elapsed > 0 ? ` · ${formatTime(elapsed)}` : ''}
          </div>
        )}
        {/* Local video preview (small, top-right) */}
        {isVideo && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute top-3 right-3 w-28 h-40 object-cover rounded-lg border-2 border-white/30 shadow-lg"
          />
        )}
      </div>

      {/* Controls */}
      <div className="bg-background border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-md mx-auto px-4 py-6 flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className={`rounded-full w-12 h-12 ${micOn ? '' : 'bg-muted'}`}
            onClick={toggleMic}
            aria-label={micOn ? 'Выключить микрофон' : 'Включить микрофон'}
          >
            {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            className="rounded-full w-16 h-16"
            onClick={() => hangup('hangup')}
            aria-label="Завершить звонок"
          >
            <PhoneOff className="w-7 h-7" />
          </Button>

          {isVideo && (
            <Button
              variant="outline"
              size="icon"
              className={`rounded-full w-12 h-12 ${camOn ? '' : 'bg-muted'}`}
              onClick={toggleCam}
              aria-label={camOn ? 'Выключить камеру' : 'Включить камеру'}
            >
              {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Incoming call dialog (separate component for clarity) ----

type IncomingProps = {
  callerName: string
  callerAvatarUrl?: string | null
  isVideo: boolean
  onAccept: () => void
  onReject: () => void
}

export function IncomingCallDialog({
  callerName,
  callerAvatarUrl,
  isVideo,
  onAccept,
  onReject,
}: IncomingProps) {
  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col items-center justify-center px-6">
      <p className="text-sm text-muted-foreground mb-4">
        {isVideo ? '📹 Видеозвонок' : '📞 Звонок'}
      </p>
      <Avatar className="w-32 h-32 border-4 border-primary/20 mb-4">
        <AvatarImage src={callerAvatarUrl ?? undefined} alt={callerName} />
        <AvatarFallback className="bg-primary/10 text-primary text-5xl font-semibold">
          {callerName.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <h2 className="text-2xl font-semibold mb-1">{callerName}</h2>
      <p className="text-muted-foreground mb-10">звонит вам…</p>

      <div className="flex items-center gap-12">
        <button
          onClick={onReject}
          className="flex flex-col items-center gap-2 text-destructive"
          aria-label="Отклонить"
        >
          <span className="w-16 h-16 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center">
            <PhoneOff className="w-7 h-7" />
          </span>
          <span className="text-sm">Отклонить</span>
        </button>
        <button
          onClick={onAccept}
          className="flex flex-col items-center gap-2 text-primary"
          aria-label="Ответить"
        >
          <span className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center animate-pulse">
            <Phone className="w-7 h-7" />
          </span>
          <span className="text-sm">Ответить</span>
        </button>
      </div>
    </div>
  )
}

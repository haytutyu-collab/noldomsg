'use client'

import { Mic, Square, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Props = {
  // Called with the recorded blob + duration when the user taps "send"
  onSend: (blob: Blob, durationSec: number) => void
  // Called when the user cancels the recording
  onCancel: () => void
}

/**
 * A press-to-record UI. The user taps the mic to start recording,
 * then can either send the recording or cancel it.
 *
 * While recording, MediaRecorder writes chunks; we also keep a timer.
 * On send, we build a single Blob and pass it back to the parent.
 */
export function VoiceRecorder({ onSend, onCancel }: Props) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const stopTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    stopTracks()
    mediaRecorderRef.current = null
    chunksRef.current = []
  }

  useEffect(() => {
    // Cleanup on unmount
    return () => cleanup()
  }, [])

  const startRecording = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Pick a mime type the browser supports
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ]
      const mimeType = candidates.find((t) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
      )

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.start()
      startTimeRef.current = Date.now()
      setSeconds(0)
      setRecording(true)
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 200)
    } catch (e: unknown) {
      const err = e as { name?: string }
      if (err?.name === 'NotAllowedError') {
        setError('Микрофон заблокирован. Разрешите доступ в настройках браузера.')
      } else {
        setError('Не удалось получить доступ к микрофону')
      }
      stopTracks()
    }
  }

  const stopRecording = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) {
        resolve(null)
        return
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        cleanup()
        resolve(blob)
      }
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve(null)
    })
  }

  const handleSend = async () => {
    const blob = await stopRecording()
    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
    setRecording(false)
    if (blob) onSend(blob, duration)
    else setError('Запись не удалась')
  }

  const handleCancel = async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    cleanup()
    setRecording(false)
    setSeconds(0)
    onCancel()
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-2 px-3">
        <p className="text-xs text-destructive text-center">{error}</p>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Закрыть
        </Button>
      </div>
    )
  }

  if (!recording) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-full w-11 h-11 p-0 shrink-0"
        onClick={startRecording}
        aria-label="Записать голосовое"
      >
        <Mic className="w-5 h-5" />
      </Button>
    )
  }

  return (
    <div className="flex-1 flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
      <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" aria-hidden />
      <span className="text-sm font-mono tabular-nums">{formatTime(seconds)}</span>
      <span className="text-xs text-muted-foreground flex-1">Запись…</span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full w-9 h-9 p-0 text-destructive"
        onClick={handleCancel}
        aria-label="Отменить запись"
      >
        <X className="w-5 h-5" />
      </Button>
      <Button
        type="button"
        size="icon"
        className="rounded-full w-9 h-9 p-0 bg-primary hover:bg-primary/90"
        onClick={handleSend}
        aria-label="Отправить запись"
      >
        <Send className="w-4 h-4" />
      </Button>
      <span className="sr-only">
        <Square />
      </span>
    </div>
  )
}

import { NextResponse } from 'next/server'

// GET /api/push/key — returns the public VAPID key for the browser to subscribe.
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 })
  }
  return NextResponse.json({ publicKey })
}

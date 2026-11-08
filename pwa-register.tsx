'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker for PWA offline support.
 * Renders nothing — purely a side-effect component.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') {
      // In dev, also register so the install prompt shows up; SW file is at /public/sw.js → /sw.js
    }
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[noldo] SW registration failed', err)
      })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])
  return null
}

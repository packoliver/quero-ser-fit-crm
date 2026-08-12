'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return

    let cancelled = false
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
      if (cancelled) return
      // Ask for an update on each app load without forcing a reload loop.
      void registration.update()
    }).catch(() => {
      // PWA support is optional; authentication and normal navigation must continue.
    })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}

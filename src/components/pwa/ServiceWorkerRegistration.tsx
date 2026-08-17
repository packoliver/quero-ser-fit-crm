'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return

    let cancelled = false
    let reloading = false

    // sw.js já chama skipWaiting()/clients.claim() ao ativar uma versão nova — isso faz o
    // NAVEGADOR trocar de controlador, mas o JavaScript já carregado na aba/PWA aberta
    // continua rodando o código antigo até alguém recarregar manualmente. Sem isso, um
    // deploy novo (como o que corrigiu o badge "Fila de Espera") só chegava em quem
    // fechasse e reabrisse o app por conta própria. Só liga esse listener quando JÁ havia
    // um controlador ativo (ou seja, não é a primeiríssima visita) — assim não recarrega
    // à toa logo no primeiro carregamento, quando o service worker está só se instalando.
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return
        reloading = true
        window.location.reload()
      })
    }

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

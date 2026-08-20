/**
 * Inscrição do aparelho para receber notificação de mensagem nova.
 *
 * Devolve o motivo da falha, e não só `false`, por um motivo prático: no iPhone o caminho
 * feliz depende de uma condição que a pessoa não tem como adivinhar — notificação web só
 * funciona com o app adicionado à tela de início, nunca numa aba comum do Safari. Um
 * "não foi possível" genérico deixa quem tentou sem nenhuma pista do que fazer.
 */
export type PushFailureReason =
  /** Aparelho/navegador não faz notificação web de jeito nenhum (ou iOS anterior ao 16.4). */
  | 'sem-suporte'
  /** iPhone/iPad com o app aberto no Safari em vez da tela de início. */
  | 'nao-instalado'
  /** A pessoa (ou o sistema) negou a permissão. */
  | 'permissao-negada'
  /** As chaves VAPID não estão configuradas no servidor. */
  | 'servidor-sem-chave'
  /** Rede, endpoint recusado, ou o registro no nosso banco falhou. */
  | 'falhou'

export type PushSetupResult = { ok: true } | { ok: false; reason: PushFailureReason }

/** Texto mostrado quando não dá pra ativar. Puro de propósito — dá pra testar sem navegador. */
export function pushSetupMessage(reason: PushFailureReason): string {
  switch (reason) {
    case 'nao-instalado':
      return 'No iPhone, notificação só funciona com o app na tela de início: Compartilhar › Adicionar à Tela de Início.'
    case 'permissao-negada':
      return 'Notificações bloqueadas. Libere em Ajustes › Notificações › Quero Ser Fit CRM.'
    case 'sem-suporte':
      return 'Este aparelho não recebe notificações. No iPhone, precisa de iOS 16.4 ou mais novo.'
    case 'servidor-sem-chave':
      return 'As notificações ainda não estão configuradas no servidor.'
    case 'falhou':
      return 'Não foi possível ativar as notificações neste dispositivo.'
  }
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPad com iPadOS 13+ se anuncia como Macintosh; o que o denuncia é ter tela de toque.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // Propriedade só do Safari, mantida aqui porque é a que responde nas versões mais antigas.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export async function subscribeToPush(): Promise<PushSetupResult> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return { ok: false, reason: 'sem-suporte' }
  }
  if (!('PushManager' in window)) {
    // No iPhone, `PushManager` só existe quando o app foi aberto pela tela de início. Fora
    // dali some — é este ramo que explica o caso mais comum de "ativei e não recebo nada".
    return { ok: false, reason: isApple() && !isInstalled() ? 'nao-instalado' : 'sem-suporte' }
  }

  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, reason: 'permissao-negada' }

    const keyResponse = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' })
    const keyBody = await keyResponse.json().catch(() => null)
    if (!keyResponse.ok || !keyBody?.enabled || !keyBody.publicKey) {
      return { ok: false, reason: 'servidor-sem-chave' }
    }

    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey) as unknown as BufferSource,
    })
    const response = await fetch('/api/push/subscriptions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }),
    })
    return response.ok ? { ok: true } : { ok: false, reason: 'falhou' }
  } catch {
    return { ok: false, reason: 'falhou' }
  }
}

/**
 * Este aparelho tem mesmo uma inscrição ativa?
 *
 * Serve pra conferir o que ficou guardado no localStorage. Uma inscrição some sem avisar
 * ninguém: o servidor de push pode expirar o endpoint (e aí a gente apaga o registro, ver
 * sendPushToOrganization), ou a pessoa reinstala o app. O botão continuaria aceso, e ela
 * ficaria esperando uma notificação que não vem mais.
 */
export async function hasPushSubscription(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const registration = await navigator.serviceWorker.ready
    return (await registration.pushManager.getSubscription()) !== null
  } catch {
    return false
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return true

    const response = await fetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    const removed = await subscription.unsubscribe()
    return response.ok && removed
  } catch {
    return false
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const result = new Uint8Array(rawData.length)
  for (let index = 0; index < rawData.length; index++) result[index] = rawData.charCodeAt(index)
  return result
}

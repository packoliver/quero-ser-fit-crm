export async function subscribeToPush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false

  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return false

    const keyResponse = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' })
    const keyBody = await keyResponse.json().catch(() => null)
    if (!keyResponse.ok || !keyBody?.enabled || !keyBody.publicKey) return false

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
    return response.ok
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

import { describe, it, expect } from 'vitest'

interface WebhookStore {
  events: Set<string>
}

function processWebhookEvent(store: WebhookStore, provider: string, externalEventId: string): { processed: boolean; duplicate: boolean } {
  const key = `${provider}:${externalEventId}`
  if (store.events.has(key)) {
    return { processed: false, duplicate: true }
  }
  store.events.add(key)
  return { processed: true, duplicate: false }
}

describe('Idempotência no Processamento de Webhooks Meta', () => {
  it('deve processar um novo evento pela primeira vez', () => {
    const store: WebhookStore = { events: new Set() }
    const result = processWebhookEvent(store, 'whatsapp_meta', 'wamid_12345')

    expect(result.processed).toBe(true)
    expect(result.duplicate).toBe(false)
  })

  it('deve ignorar eventos duplicados com a mesma chave (provider + external_event_id)', () => {
    const store: WebhookStore = { events: new Set() }
    processWebhookEvent(store, 'whatsapp_meta', 'wamid_12345')

    const duplicateResult = processWebhookEvent(store, 'whatsapp_meta', 'wamid_12345')

    expect(duplicateResult.processed).toBe(false)
    expect(duplicateResult.duplicate).toBe(true)
  })
})

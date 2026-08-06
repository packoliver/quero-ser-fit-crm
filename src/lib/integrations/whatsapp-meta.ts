import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  OutgoingMessagePayload,
} from './types'

/**
 * Conector Oficial da Meta WhatsApp Cloud API (Coexistência habilitada com WhatsApp Business App).
 * Nota: Bibliotecas não oficiais e conexões via WhatsApp Web NÃO são utilizadas.
 */
export class MetaWhatsAppProvider implements ICRMIntegrationProvider {
  channelType = 'whatsapp' as const

  verifyWebhook(verifyToken: string, expectedToken: string): boolean {
    return !!verifyToken && verifyToken === expectedToken
  }

  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[] {
    const events: IncomingWebhookEvent[] = []
    
    try {
      const entryArray = (body.entry as Array<Record<string, unknown>>) || []
      for (const entry of entryArray) {
        const changes = (entry.changes as Array<Record<string, unknown>>) || []
        for (const change of changes) {
          const value = change.value as Record<string, unknown> | undefined
          if (!value) continue

          const messages = (value.messages as Array<Record<string, unknown>>) || []
          for (const msg of messages) {
            const externalId = (msg.id as string) || `wa_msg_${Date.now()}`
            const senderId = (msg.from as string) || ''
            const textObj = msg.text as { body?: string } | undefined
            const content = textObj?.body || '[Mídia/Outro]'

            events.push({
              provider: 'whatsapp_meta',
              externalEventId: externalId,
              eventType: 'messages',
              senderId,
              recipientId: (value.metadata as { display_phone_number?: string })?.display_phone_number || '',
              content,
              timestamp: new Date().toISOString(),
              rawPayload: msg,
            })
          }
        }
      }
    } catch (err) {
      console.error('Erro ao interpretar payload do WhatsApp Meta:', err)
    }

    return events
  }

  async sendMessage(
    payload: OutgoingMessagePayload
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    // Fase 1: Interface preparada. Envio real aguarda adição de Tokens da Meta Cloud API nas configurações.
    console.log('[MetaWhatsAppProvider] Simulação de envio oficial Cloud API:', payload)
    return {
      success: true,
      externalId: `wamid.simulated_${Date.now()}`,
    }
  }
}

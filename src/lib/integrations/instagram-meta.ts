import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  OutgoingMessagePayload,
} from './types'

/**
 * Conector Oficial da Meta Instagram Graph API (Direct Messaging).
 */
export class MetaInstagramProvider implements ICRMIntegrationProvider {
  channelType = 'instagram' as const

  verifyWebhook(verifyToken: string, expectedToken: string): boolean {
    return !!verifyToken && verifyToken === expectedToken
  }

  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[] {
    const events: IncomingWebhookEvent[] = []

    try {
      const entryArray = (body.entry as Array<Record<string, unknown>>) || []
      for (const entry of entryArray) {
        const messaging = (entry.messaging as Array<Record<string, unknown>>) || []
        for (const item of messaging) {
          const sender = item.sender as { id?: string } | undefined
          const recipient = item.recipient as { id?: string } | undefined
          const message = item.message as { mid?: string; text?: string } | undefined

          if (message && sender?.id) {
            events.push({
              provider: 'instagram_meta',
              externalEventId: message.mid || `ig_msg_${Date.now()}`,
              eventType: 'instagram_direct',
              senderId: sender.id,
              recipientId: recipient?.id || '',
              content: message.text || '[Mídia Direct]',
              timestamp: new Date().toISOString(),
              rawPayload: item,
            })
          }
        }
      }
    } catch (err) {
      console.error('Erro ao interpretar payload do Instagram Meta:', err)
    }

    return events
  }

  async sendMessage(
    payload: OutgoingMessagePayload
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    // Fase 1: Interface preparada. Envio real aguarda adição de Tokens da Graph API nas configurações.
    console.log('[MetaInstagramProvider] Simulação de envio Direct Graph API:', payload)
    return {
      success: true,
      externalId: `ig_mid.simulated_${Date.now()}`,
    }
  }
}

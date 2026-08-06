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
    if (!payload.accessToken || !payload.fromExternalId) {
      return { success: false, error: 'Conexão sem token/Page ID configurado (Cloud API).' }
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(payload.fromExternalId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${payload.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: { id: payload.recipientExternalId },
            message: { text: payload.content },
          }),
        }
      )

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        return { success: false, error: body?.error?.message || `Falha HTTP ${res.status} ao enviar Direct do Instagram.` }
      }

      const externalId = body?.message_id as string | undefined
      return { success: true, externalId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro de rede ao enviar mensagem.' }
    }
  }
}

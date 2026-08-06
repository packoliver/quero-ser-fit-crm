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

            // phone_number_id (not display_phone_number) is the stable routing key Meta
            // uses to identify which of our registered numbers received this message —
            // it's what we store as integration_connections.external_identifier.
            const metadata = value.metadata as { phone_number_id?: string } | undefined

            events.push({
              provider: 'whatsapp_meta',
              externalEventId: externalId,
              eventType: 'messages',
              senderId,
              recipientId: metadata?.phone_number_id || '',
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
    if (!payload.accessToken || !payload.fromExternalId) {
      return { success: false, error: 'Conexão sem token/phone_number_id configurado (Cloud API).' }
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
            messaging_product: 'whatsapp',
            to: payload.recipientExternalId,
            type: 'text',
            text: { body: payload.content },
          }),
        }
      )

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        return { success: false, error: body?.error?.message || `Falha HTTP ${res.status} ao enviar via WhatsApp Cloud API.` }
      }

      const externalId = body?.messages?.[0]?.id as string | undefined
      return { success: true, externalId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro de rede ao enviar mensagem.' }
    }
  }
}

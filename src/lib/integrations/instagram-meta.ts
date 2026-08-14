import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  MediaType,
  OutgoingMessagePayload,
} from './types'

// O Instagram usa "file" onde a Cloud API do WhatsApp usa "document" — normalizamos
// pro nosso vocabulário comum.
const INSTAGRAM_MEDIA_TYPES: Record<string, MediaType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
  share: 'document',
}

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
          const message = item.message as
            | { mid?: string; text?: string; attachments?: Array<{ type?: string; payload?: { url?: string } }> }
            | undefined

          if (message && sender?.id) {
            // Diferente da Cloud API do WhatsApp (que exige um segundo hop autenticado
            // pra resolver o media id), o Instagram já entrega a URL do anexo direto no
            // payload do webhook — pronta pra baixar sem token. Sem essa URL não tem
            // como resolver a mídia depois, então nem marcamos mediaType nesse caso —
            // vira mensagem de texto (vazia, se não tiver `text` também) em vez de uma
            // linha com media_type preenchido e media_url nulo (que não renderiza nada).
            const attachment = message.attachments?.[0]
            const detectedMediaType = attachment?.type ? INSTAGRAM_MEDIA_TYPES[attachment.type] : undefined
            const mediaType = detectedMediaType && attachment?.payload?.url ? detectedMediaType : undefined

            // `item.timestamp` (Unix ms) é a hora real de envio que a Meta manda — evita
            // desordenar mensagens quando a entrega do webhook atrasa ou é reenviada.
            const rawTimestamp = typeof item.timestamp === 'number' ? item.timestamp : undefined
            const timestamp = rawTimestamp ? new Date(rawTimestamp).toISOString() : new Date().toISOString()

            events.push({
              provider: 'instagram_meta',
              externalEventId: message.mid || `ig_msg_${Date.now()}`,
              eventType: 'instagram_direct',
              senderId: sender.id,
              recipientId: recipient?.id || '',
              content: message.text || '',
              timestamp,
              rawPayload: item,
              mediaType,
              mediaUrl: mediaType ? attachment?.payload?.url : undefined,
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

    // Instagram Direct usa "file" onde outros conectores usam "document".
    const attachmentType = payload.mediaType === 'document' ? 'file' : payload.mediaType

    const message =
      payload.mediaUrl && attachmentType
        ? { attachment: { type: attachmentType, payload: { url: payload.mediaUrl, is_reusable: true } } }
        : { text: payload.content }

    try {
      const res = await fetch(
        `https://graph.instagram.com/v25.0/${encodeURIComponent(payload.fromExternalId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${payload.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipient: { id: payload.recipientExternalId },
            message,
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

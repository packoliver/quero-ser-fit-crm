import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  MediaType,
  MessageStatusUpdate,
  OutgoingMessagePayload,
} from './types'

// Tipos de mensagem que a Cloud API entrega em `msg.type`, mapeados pro nosso MediaType.
const META_MEDIA_TYPES: Record<string, MediaType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
}

// A Cloud API já usa exatamente os mesmos nomes que a gente ('sent', 'delivered',
// 'read', 'failed') — sem necessidade de mapear. 'deleted' não é um status real de
// entrega, ignoramos.
const META_STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed'])

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

            // phone_number_id (not display_phone_number) is the stable routing key Meta
            // uses to identify which of our registered numbers received this message —
            // it's what we store as integration_connections.external_identifier.
            const metadata = value.metadata as { phone_number_id?: string } | undefined

            const msgType = typeof msg.type === 'string' ? msg.type : undefined
            const detectedMediaType = msgType ? META_MEDIA_TYPES[msgType] : undefined
            // Mídia vem como {[type]: {id, mime_type, caption?, sha256, filename?}} — o
            // `id` é o identificador de mídia da Meta, resolvido depois via uma chamada
            // autenticada separada (a rota do webhook, que tem o token decifrado da conexão).
            const mediaObj = detectedMediaType ? (msg[detectedMediaType] as { id?: string; caption?: string } | undefined) : undefined
            // Sem media id não tem como resolver a mídia depois — sem isso, cai no
            // fallback de texto abaixo em vez de virar uma linha com media_type
            // preenchido e media_url nulo (que não renderiza nada no chat).
            const mediaType = detectedMediaType && mediaObj?.id ? detectedMediaType : undefined

            events.push({
              provider: 'whatsapp_meta',
              externalEventId: externalId,
              eventType: 'messages',
              senderId,
              recipientId: metadata?.phone_number_id || '',
              content: textObj?.body || mediaObj?.caption || (msgType && !mediaType ? `[${msgType}, tipo não suportado]` : ''),
              timestamp: new Date().toISOString(),
              rawPayload: msg,
              mediaType,
              providerMediaId: mediaType ? mediaObj?.id : undefined,
            })
          }
        }
      }
    } catch (err) {
      console.error('Erro ao interpretar payload do WhatsApp Meta:', err)
    }

    return events
  }

  /**
   * The same webhook call that carries inbound messages also carries delivery/read
   * receipts for messages WE sent, as a `statuses` array alongside (never mixed into)
   * the `messages` array — https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#status--sent.
   */
  parseStatusUpdates(body: Record<string, unknown>): MessageStatusUpdate[] {
    const updates: MessageStatusUpdate[] = []
    try {
      const entryArray = (body.entry as Array<Record<string, unknown>>) || []
      for (const entry of entryArray) {
        const changes = (entry.changes as Array<Record<string, unknown>>) || []
        for (const change of changes) {
          const value = change.value as Record<string, unknown> | undefined
          const statuses = (value?.statuses as Array<Record<string, unknown>>) || []
          for (const s of statuses) {
            const id = typeof s.id === 'string' ? s.id : undefined
            const status = typeof s.status === 'string' ? s.status : undefined
            if (id && status && META_STATUS_VALUES.has(status)) {
              updates.push({ externalId: id, status: status as MessageStatusUpdate['status'] })
            }
          }
        }
      }
    } catch (err) {
      console.error('Erro ao interpretar status de mensagem do WhatsApp Meta:', err)
    }
    return updates
  }

  async sendMessage(
    payload: OutgoingMessagePayload
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (!payload.accessToken || !payload.fromExternalId) {
      return { success: false, error: 'Conexão sem token/phone_number_id configurado (Cloud API).' }
    }

    const requestBody =
      payload.mediaUrl && payload.mediaType
        ? {
            messaging_product: 'whatsapp',
            to: payload.recipientExternalId,
            type: payload.mediaType,
            [payload.mediaType]: {
              link: payload.mediaUrl,
              ...(payload.content ? { caption: payload.content } : {}),
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: payload.recipientExternalId,
            type: 'text',
            text: { body: payload.content },
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
          body: JSON.stringify(requestBody),
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

/**
 * Resolve a URL temporária (minutos de validade) de um arquivo de mídia recebido,
 * dado o media id que a Cloud API manda no payload do webhook. A URL retornada só é
 * baixável com o mesmo Bearer token — quem chama isso precisa reenviar esse header ao
 * baixar os bytes (ver mirrorMediaToStorage's `authHeader`). Retorna null em qualquer
 * falha, nunca lança.
 */
export async function resolveMetaMediaUrl(
  accessToken: string,
  mediaId: string
): Promise<{ url: string; mimeType?: string } | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body?.url) {
      console.error('resolveMetaMediaUrl: falha ao resolver mídia:', body?.error?.message || res.status)
      return null
    }
    return { url: body.url, mimeType: body.mime_type }
  } catch (err) {
    console.error('resolveMetaMediaUrl: erro de rede:', err)
    return null
  }
}

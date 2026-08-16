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
        const entryId = typeof entry.id === 'string' ? entry.id : ''

        const messagingList: Array<Record<string, unknown>> = []

        if (Array.isArray(entry.messaging)) {
          messagingList.push(...(entry.messaging as Array<Record<string, unknown>>))
        }

        if (Array.isArray(entry.changes)) {
          for (const change of entry.changes as Array<Record<string, unknown>>) {
            if (change.field === 'messages' && change.value && typeof change.value === 'object') {
              messagingList.push(change.value as Record<string, unknown>)
            }
          }
        }

        for (const item of messagingList) {
          const sender = item.sender as { id?: string } | undefined
          const recipient = item.recipient as { id?: string } | undefined
          const message = (item.message || item.messaging) as
            | {
                mid?: string
                text?: string
                is_echo?: boolean
                is_self?: boolean
                attachments?: Array<{ type?: string; payload?: { url?: string } }>
              }
            | undefined

          // Echoes são cópias das mensagens que a PRÓPRIA conta enviou (pelo CRM ou pelo
          // app do Instagram), não mensagens recebidas. A notificação de teste do painel
          // da Meta também vem assim — com is_echo/is_self e recipient.id apontando pra
          // própria conta conectada, que casa com a nossa conexão. Sem esse filtro, cada
          // teste no painel e cada resposta enviada viravam uma "mensagem recebida" de um
          // contato falso (a própria loja) dentro do Inbox.
          if (message?.is_echo || message?.is_self) continue

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
              recipientId: recipient?.id || entryId,
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

/**
 * Consulta nome, username e foto de perfil de um usuário do Instagram (IGSID) via Meta Graph API.
 */
export async function fetchInstagramUserProfile(
  accessToken: string,
  igsid: string
): Promise<{ name?: string; username?: string; profilePic?: string } | null> {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v25.0/${encodeURIComponent(igsid)}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`
    )
    if (res.ok) {
      const data = await res.json()
      return {
        name: data.name || (data.username ? `@${data.username}` : undefined),
        username: data.username,
        profilePic: data.profile_pic,
      }
    }

    const fbRes = await fetch(
      `https://graph.facebook.com/v25.0/${encodeURIComponent(igsid)}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`
    )
    if (fbRes.ok) {
      const fbData = await fbRes.json()
      return {
        name: fbData.name || (fbData.username ? `@${fbData.username}` : undefined),
        username: fbData.username,
        profilePic: fbData.profile_pic,
      }
    }
  } catch (err) {
    console.error('[fetchInstagramUserProfile] Erro ao consultar perfil do Instagram:', err)
  }
  return null
}


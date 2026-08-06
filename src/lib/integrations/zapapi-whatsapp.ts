import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  OutgoingMessagePayload,
} from './types'

const ZAPAPI_BASE_URL = 'https://api.zap-api.tech/v1'

/**
 * Conector WhatsApp via zap-api.tech — serviço terceiro hospedado que mantém a sessão
 * do WhatsApp Web (pareada por QR Code) e expõe uma API REST + webhooks assinados
 * (HMAC-SHA256).
 *
 * IMPORTANTE: Isso NÃO é a Cloud API oficial da Meta. É automação não-oficial do
 * WhatsApp Web, terceirizada para a infraestrutura da zap-api.tech — o risco de
 * banimento do número pelo WhatsApp continua existindo, só a complexidade de hospedar
 * o processo de sessão foi delegada a eles.
 */
export class ZapApiWhatsAppProvider implements ICRMIntegrationProvider {
  channelType = 'whatsapp' as const

  // Verificação real acontece via assinatura HMAC-SHA256 no header
  // x-zapapi-signature-256 (ver /api/webhooks/zapapi), não neste método.
  verifyWebhook(): boolean {
    return true
  }

  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[] {
    try {
      if (body.event !== 'message.received') return []

      const instanceId = body.instanceId as string | undefined
      const data = body.data as
        | { messageId?: string; from?: string; type?: string; body?: string }
        | undefined
      const timestamp = body.timestamp as string | undefined

      if (!instanceId || !data?.from || data.type !== 'text' || !data.body) return []

      return [
        {
          provider: 'whatsapp_zapapi',
          externalEventId: data.messageId || `zapapi_msg_${Date.now()}`,
          eventType: 'message.received',
          senderId: data.from,
          recipientId: instanceId,
          content: data.body,
          timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
          rawPayload: body,
        },
      ]
    } catch (err) {
      console.error('Erro ao interpretar payload do ZAP API:', err)
      return []
    }
  }

  async sendMessage(
    payload: OutgoingMessagePayload
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (!payload.accessToken || !payload.fromExternalId) {
      return { success: false, error: 'Conexão sem Instance ID/Token configurado (ZAP API).' }
    }

    try {
      const res = await fetch(`${ZAPAPI_BASE_URL}/instances/${encodeURIComponent(payload.fromExternalId)}/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${payload.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: payload.recipientExternalId,
          type: 'text',
          body: payload.content,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        return { success: false, error: body?.message || body?.error || `Falha HTTP ${res.status} ao enviar via ZAP API.` }
      }

      return { success: !!body?.success, externalId: body?.messageId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro de rede ao enviar mensagem via ZAP API.' }
    }
  }
}

export { ZAPAPI_BASE_URL }

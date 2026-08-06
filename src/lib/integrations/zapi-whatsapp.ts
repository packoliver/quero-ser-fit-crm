import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  OutgoingMessagePayload,
} from './types'

/**
 * Conector WhatsApp via z-api.io — um serviço terceiro hospedado que mantém a sessão
 * do WhatsApp Web (pareada por QR Code) e expõe uma API REST + webhooks comuns.
 *
 * IMPORTANTE: Isso NÃO é a Cloud API oficial da Meta. É automação não-oficial do
 * WhatsApp Web, terceirizada para a infraestrutura da z-api.io — o risco de banimento
 * do número pelo WhatsApp continua existindo, só a complexidade de hospedar o processo
 * de sessão foi delegada a eles.
 *
 * Docs: https://developer.z-api.io/
 */
export class ZApiWhatsAppProvider implements ICRMIntegrationProvider {
  channelType = 'whatsapp' as const

  // Z-API não assina os webhooks (sem HMAC) — a verificação real acontece via um
  // segredo próprio na query string da URL do webhook (ver /api/webhooks/zapi).
  verifyWebhook(): boolean {
    return true
  }

  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[] {
    try {
      // Mensagens que nós mesmos enviamos (pelo celular conectado, fora do nosso CRM)
      // também disparam esse webhook com fromMe=true — ignoramos pra não duplicar.
      if (body.fromMe === true) return []

      const phone = body.phone as string | undefined
      const instanceId = body.instanceId as string | undefined
      const text = body.text as { message?: string } | undefined
      const messageId = body.messageId as string | undefined
      const moment = body.momment as number | undefined

      if (!phone || !instanceId || !text?.message) return []

      return [
        {
          provider: 'whatsapp_zapi',
          externalEventId: messageId || `zapi_msg_${Date.now()}`,
          eventType: 'message-received',
          senderId: phone,
          recipientId: instanceId,
          content: text.message,
          timestamp: moment ? new Date(moment).toISOString() : new Date().toISOString(),
          rawPayload: body,
        },
      ]
    } catch (err) {
      console.error('Erro ao interpretar payload do Z-API:', err)
      return []
    }
  }

  async sendMessage(
    payload: OutgoingMessagePayload
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (!payload.accessToken || !payload.fromExternalId) {
      return { success: false, error: 'Conexão sem Instance ID/Token configurado (Z-API).' }
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (payload.secondaryToken) {
        headers['Client-Token'] = payload.secondaryToken
      }

      const res = await fetch(
        `https://api.z-api.io/instances/${encodeURIComponent(payload.fromExternalId)}/token/${encodeURIComponent(payload.accessToken)}/send-text`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            phone: payload.recipientExternalId,
            message: payload.content,
          }),
        }
      )

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        return { success: false, error: body?.error || body?.message || `Falha HTTP ${res.status} ao enviar via Z-API.` }
      }

      const externalId = (body?.messageId || body?.zaapId) as string | undefined
      return { success: true, externalId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro de rede ao enviar mensagem via Z-API.' }
    }
  }
}

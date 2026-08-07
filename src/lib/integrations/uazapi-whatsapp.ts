import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  OutgoingMessagePayload,
} from './types'

/**
 * Conector WhatsApp via uazapi (uazapiGO) — serviço terceiro que mantém a sessão do
 * WhatsApp Web (pareada por QR Code ou código de pareamento) e expõe uma API REST +
 * webhooks. Documentação: https://docs.uazapi.com/
 *
 * IMPORTANTE: Isso NÃO é a Cloud API oficial da Meta. É automação não-oficial do
 * WhatsApp Web — o risco de banimento do número pelo WhatsApp existe (a própria uazapi
 * recomenda usar contas WhatsApp Business para reduzir esse risco).
 *
 * Diferente da Cloud API (uma única URL fixa: graph.facebook.com), cada conta uazapi
 * tem seu próprio subdomínio (ex: https://minhaempresa.uazapi.com) — por isso a base
 * URL é armazenada por conexão (settings.apiBaseUrl / connection.api_base_url), não
 * fixa neste arquivo.
 *
 * Autenticação: header `token` (não `Authorization: Bearer`) com o token da instância.
 */
export class UazapiWhatsAppProvider implements ICRMIntegrationProvider {
  channelType = 'whatsapp' as const

  // A uazapi não assina seus webhooks com HMAC — autenticidade é garantida pelo
  // segredo aleatório embutido no próprio caminho da URL do webhook (ver
  // /api/webhooks/uazapi/[secret]), não por verificação de assinatura aqui.
  verifyWebhook(): boolean {
    return true
  }

  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[] {
    try {
      const data = body.data as Record<string, unknown> | undefined
      if (!data) return []

      // A uazapi documenta o formato de `data` como variável por tipo de evento, sem
      // publicar um exemplo fixo para "messages" — por isso identificamos uma mensagem
      // de texto recebida pelo formato dos próprios dados (chatid + sender + text +
      // fromMe:false), mais resiliente a variações do payload do que depender só do
      // valor do campo `event`.
      const fromMe = data.fromMe === true
      const text = typeof data.text === 'string' ? data.text : undefined
      const chatId = typeof data.chatid === 'string' ? data.chatid : undefined
      const sender = typeof data.sender === 'string' ? data.sender : chatId
      const messageId = typeof data.messageid === 'string' ? data.messageid : undefined
      const timestampMs = typeof data.messageTimestamp === 'number' ? data.messageTimestamp : undefined
      const isGroup = data.isGroup === true

      // Grupos ficam fora de escopo por enquanto (o CRM modela conversas 1:1 com contatos).
      if (fromMe || isGroup || !text || !sender) return []

      const instanceId = typeof body.instance === 'string' ? body.instance : ''

      return [
        {
          provider: 'whatsapp_uazapi',
          externalEventId: messageId || `uazapi_msg_${Date.now()}`,
          eventType: 'message',
          senderId: sender,
          recipientId: instanceId,
          content: text,
          timestamp: timestampMs ? new Date(timestampMs).toISOString() : new Date().toISOString(),
          rawPayload: body,
        },
      ]
    } catch (err) {
      console.error('Erro ao interpretar payload da uazapi:', err)
      return []
    }
  }

  async sendMessage(
    payload: OutgoingMessagePayload
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (!payload.accessToken || !payload.apiBaseUrl) {
      return { success: false, error: 'Conexão sem Base URL/Token configurado (uazapi).' }
    }

    try {
      const base = payload.apiBaseUrl.replace(/\/$/, '')
      const res = await fetch(`${base}/send/text`, {
        method: 'POST',
        headers: {
          token: payload.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: payload.recipientExternalId,
          text: payload.content,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        return { success: false, error: body?.error || body?.message || `Falha HTTP ${res.status} ao enviar via uazapi.` }
      }

      return { success: true, externalId: body?.messageid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro de rede ao enviar mensagem via uazapi.' }
    }
  }
}

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
      // A OpenAPI da uazapi documenta um envelope genérico {event, instance, data}, mas
      // o payload REAL que o servidor deles envia (confirmado via /webhook/errors, que
      // guarda o corpo exato de tentativas de entrega) é diferente: o evento de mensagem
      // vem como {EventType: "messages", instanceName, message: {...}, chat: {...}},
      // com os dados da mensagem dentro de `message`, não `data`. Aceitamos os dois
      // formatos por segurança, priorizando o real.
      const message = (body.message ?? body.data) as Record<string, unknown> | undefined
      if (!message) return []

      const fromMe = message.fromMe === true
      const isGroup = message.isGroup === true
      const text =
        typeof message.text === 'string'
          ? message.text
          : typeof message.content === 'string'
            ? message.content
            : undefined
      const chatId = typeof message.chatid === 'string' ? message.chatid : undefined
      // `sender` costuma vir no formato @lid (identificador de privacidade do WhatsApp,
      // não o telefone). `sender_pn` é a versão com o telefone real quando disponível —
      // preferimos ela pra manter contatos legíveis e consistentes com o que /send/text espera.
      // Em ambos os casos removemos o sufixo @... (s.whatsapp.net / lid / g.us) — o
      // resto do CRM (nome do contato, /send/text) espera um número puro, igual ao que
      // o conector da Meta já entrega.
      const senderRaw =
        typeof message.sender_pn === 'string'
          ? message.sender_pn
          : typeof message.sender === 'string'
            ? message.sender
            : chatId
      const sender = senderRaw?.split('@')[0]
      const messageId = typeof message.messageid === 'string' ? message.messageid : undefined
      const timestampMs = typeof message.messageTimestamp === 'number' ? message.messageTimestamp : undefined

      // Grupos ficam fora de escopo por enquanto (o CRM modela conversas 1:1 com contatos).
      if (fromMe || isGroup || !text || !sender) return []

      // O nome da instância (`instanceName`) não é um identificador estável o bastante
      // pra rotear com segurança — a rota do webhook (que já sabe qual conexão é essa
      // pelo segredo na URL) sobrescreve este campo com o external_identifier real
      // salvo no banco. Isso aqui é só um valor de fallback.
      const instanceName = typeof body.instanceName === 'string' ? body.instanceName : ''

      return [
        {
          provider: 'whatsapp_uazapi',
          externalEventId: messageId || `uazapi_msg_${Date.now()}`,
          eventType: 'message',
          senderId: sender,
          recipientId: instanceName,
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

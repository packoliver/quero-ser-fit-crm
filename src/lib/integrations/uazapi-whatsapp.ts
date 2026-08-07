import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  MediaType,
  OutgoingMessagePayload,
} from './types'

// A uazapi documenta um campo `type` simples (image/video/audio/document/sticker —
// o mesmo vocabulário de POST /send/media), mas o payload REAL de uma mensagem de
// mídia recebida (confirmado via POST /message/find contra uma imagem de teste
// enviada de verdade) não traz esse campo de forma confiável — o que SEMPRE vem
// preenchido é `messageType`, com os nomes de tipo cru do protocolo do WhatsApp
// (ex: "ImageMessage"). Detectamos por `messageType` primeiro, com `type` como
// fallback pra qualquer variação futura.
const UAZAPI_MESSAGE_TYPE_MAP: Record<string, MediaType> = {
  imagemessage: 'image',
  videomessage: 'video',
  ptvmessage: 'video',
  audiomessage: 'audio',
  pttmessage: 'audio',
  documentmessage: 'document',
  documentwithcaptionmessage: 'document',
  stickermessage: 'sticker',
}

const UAZAPI_TYPE_MAP: Record<string, MediaType> = {
  image: 'image',
  video: 'video',
  videoplay: 'video',
  ptv: 'video',
  audio: 'audio',
  ptt: 'audio',
  myaudio: 'audio',
  document: 'document',
  sticker: 'sticker',
}

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
      // Pra mídia, `message.content` é um objeto ({caption, mimetype, fileURL: "", ...}),
      // não string — então esse `typeof === 'string'` já filtra isso corretamente e só
      // pega legenda/texto quando é mesmo texto puro. A legenda de uma mídia às vezes
      // vem em `message.content.caption` em vez de `message.text`, por isso o segundo fallback.
      const contentObj = message.content && typeof message.content === 'object' ? (message.content as Record<string, unknown>) : undefined
      const text =
        typeof message.text === 'string'
          ? message.text
          : typeof message.content === 'string'
            ? message.content
            : typeof contentObj?.caption === 'string'
              ? contentObj.caption
              : undefined
      const rawMessageType = typeof message.messageType === 'string' ? message.messageType.toLowerCase() : undefined
      const rawType = typeof message.type === 'string' ? message.type.toLowerCase() : undefined
      const mediaType = (rawMessageType && UAZAPI_MESSAGE_TYPE_MAP[rawMessageType]) || (rawType && UAZAPI_TYPE_MAP[rawType]) || undefined
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
      // Uma mensagem é válida se tiver texto OU for de um tipo de mídia reconhecido —
      // uma imagem sem legenda, por exemplo, não tem `text`, mas ainda é uma mensagem real.
      if (fromMe || isGroup || !sender || (!text && !mediaType)) return []

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
          content: text || '',
          timestamp: timestampMs ? new Date(timestampMs).toISOString() : new Date().toISOString(),
          rawPayload: body,
          mediaType,
          // A URL de verdade precisa de uma chamada autenticada extra (POST
          // /message/download) — a rota do webhook resolve isso usando o messageId aqui
          // antes de persistir, porque só ela tem o token decifrado da conexão.
          providerMediaId: mediaType ? messageId : undefined,
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

    const base = payload.apiBaseUrl.replace(/\/$/, '')

    try {
      const res = payload.mediaUrl && payload.mediaType
        ? await fetch(`${base}/send/media`, {
            method: 'POST',
            headers: { token: payload.accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              number: payload.recipientExternalId,
              type: payload.mediaType,
              file: payload.mediaUrl,
              text: payload.content || undefined,
            }),
          })
        : await fetch(`${base}/send/text`, {
            method: 'POST',
            headers: { token: payload.accessToken, 'Content-Type': 'application/json' },
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

/**
 * Resolve o arquivo de uma mensagem de mídia recebida via POST /message/download.
 * Retorna uma URL (hospedada pela própria uazapi, válida por ~2 dias) + o mimetype, ou
 * null em qualquer falha — quem chama decide o que fazer (normalmente: seguir sem mídia
 * em vez de perder o evento inteiro).
 */
export async function downloadUazapiMedia(
  apiBaseUrl: string,
  instanceToken: string,
  messageId: string
): Promise<{ fileURL: string; mimetype?: string } | null> {
  try {
    const base = apiBaseUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/message/download`, {
      method: 'POST',
      headers: { token: instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: messageId, return_link: true, return_base64: false }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body?.fileURL) {
      console.error('downloadUazapiMedia: falha ao baixar mídia:', body?.error || res.status)
      return null
    }
    return { fileURL: body.fileURL, mimetype: body.mimetype }
  } catch (err) {
    console.error('downloadUazapiMedia: erro de rede:', err)
    return null
  }
}

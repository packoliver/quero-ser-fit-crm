import {
  ICRMIntegrationProvider,
  IncomingWebhookEvent,
  MediaType,
  MessageStatusUpdate,
  OutgoingMessagePayload,
} from './types'

// Valores de `status` observados no schema Message da uazapi (POST /message/find):
// "Queued", "Sent", "Delivered", "Read", "Failed", "Canceled". Mapeamos pro nosso
// vocabulário; "Queued"/"Canceled" não têm equivalente direto e são ignorados (não é
// um evento de entrega de verdade, é mais um estado interno de fila).
const UAZAPI_STATUS_MAP: Record<string, MessageStatusUpdate['status']> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
}

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
      const messageId = typeof message.messageid === 'string' ? message.messageid : undefined
      // Sem messageId não tem como chamar /message/download depois — sem detectar
      // mediaType aqui, a mensagem cai no fallback de texto abaixo em vez de virar uma
      // linha com media_type preenchido e media_url nulo (que não renderiza nada no chat).
      const detectedMediaType = (rawMessageType && UAZAPI_MESSAGE_TYPE_MAP[rawMessageType]) || (rawType && UAZAPI_TYPE_MAP[rawType]) || undefined
      const mediaType = detectedMediaType && messageId ? detectedMediaType : undefined
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
      const senderName = typeof message.senderName === 'string' && message.senderName ? message.senderName : undefined
      const timestampMs = typeof message.messageTimestamp === 'number' ? message.messageTimestamp : undefined

      // Uma mensagem é válida se tiver texto OU for de um tipo de mídia reconhecido —
      // uma imagem sem legenda, por exemplo, não tem `text`, mas ainda é uma mensagem real.
      //
      // fromMe (mensagem que a NOSSA conta mandou) não é mais descartada — antes era, pra
      // não duplicar o que o CRM já registra sozinho ao enviar pelo botão, mas isso também
      // apagava silenciosamente qualquer resposta mandada direto pelo WhatsApp do celular
      // (fora do CRM): a vendedora respondia o cliente e a conversa continuava parada,
      // como se ninguém tivesse respondido. persistOutgoingEchoEvent (persist-event.ts)
      // resolve a duplicata comparando pelo external_id em vez de jogar tudo fora. `chatId`
      // continua identificando o cliente certo mesmo numa mensagem fromMe (é a identidade
      // do CHAT, não de quem mandou essa mensagem específica) — não confirmado ainda contra
      // um payload real fromMe capturado, mas é o comportamento padrão do protocolo do
      // WhatsApp Web que a uazapi encapsula.
      if (!sender || (!text && !mediaType)) return []

      // `chatid` é a identidade ESTÁVEL da conversa — pra um chat 1:1 é o próprio
      // contato (igual a `sender`, só que sempre presente mesmo quando sender/sender_pn
      // variam entre mensagens), e pra um grupo é o grupo inteiro, o mesmo pra todo
      // membro que mandar mensagem nele. É isso que faz todas as mensagens de um grupo
      // caírem na mesma conversa, e é o que persist-event.ts usa pra achar/reaproveitar
      // a conversa — não o `sender` sozinho.
      const conversationKey = chatId?.split('@')[0] || sender
      // Nome do grupo — confirmado contra o schema `Chat` documentado da uazapi
      // (docs.uazapi.com): `name` é o valor já resolvido pelo sistema (melhor fallback
      // entre as fontes, maior chance de vir preenchido), `wa_name` é o nome de perfil do
      // WhatsApp do grupo, `wa_contactName` só existe se o grupo estiver salvo na agenda.
      // Se nenhum vier, cai no fallback padrão (o próprio ID) em persist-event.ts.
      const chatObj = body.chat && typeof body.chat === 'object' ? (body.chat as Record<string, unknown>) : undefined
      const groupName =
        isGroup && chatObj
          ? ([chatObj.name, chatObj.wa_name, chatObj.wa_contactName].find(
              (v): v is string => typeof v === 'string' && v.length > 0
            ) ?? undefined)
          : undefined
      // Foto do chat (contato 1:1 ou grupo) — também confirmada no schema `Chat`:
      // `image` é a URL em resolução original, `imagePreview` a miniatura. Só está
      // presente quando a uazapi já resolveu isso pro payload do webhook; quando não
      // vem, fica undefined e simplesmente não temos foto ainda (não é um erro).
      const conversationAvatarUrl =
        chatObj && typeof chatObj.image === 'string' && chatObj.image
          ? chatObj.image
          : chatObj && typeof chatObj.imagePreview === 'string' && chatObj.imagePreview
            ? chatObj.imagePreview
            : undefined

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
          senderName,
          recipientId: instanceName,
          content: text || '',
          timestamp: timestampMs ? new Date(timestampMs).toISOString() : new Date().toISOString(),
          rawPayload: body,
          mediaType,
          // A URL de verdade precisa de uma chamada autenticada extra (POST
          // /message/download) — a rota do webhook resolve isso usando o messageId aqui
          // antes de persistir, porque só ela tem o token decifrado da conexão.
          providerMediaId: mediaType ? messageId : undefined,
          conversationKey,
          conversationName: isGroup ? groupName : senderName,
          isGroup,
          conversationAvatarUrl,
          isOutgoingEcho: fromMe,
        },
      ]
    } catch (err) {
      console.error('Erro ao interpretar payload da uazapi:', err)
      return []
    }
  }

  /**
   * Atualizações de status (entregue/lido) de mensagens que NÓS enviamos chegam como um
   * evento separado (`EventType: "messages_update"`), não junto do evento `messages`
   * comum. O formato exato não está documentado nem confirmado com um exemplo real
   * ainda (diferente do parser de mensagem recebida acima, que foi corrigido depois de
   * confirmar contra um payload de verdade) — por isso aceita algumas variações
   * plausíveis de nome de campo e loga o que não reconhecer, pra facilitar ajustar
   * depois de ver um exemplo real no log de produção.
   */
  parseStatusUpdates(body: Record<string, unknown>): MessageStatusUpdate[] {
    try {
      const eventType = typeof body.EventType === 'string' ? body.EventType.toLowerCase() : undefined
      if (eventType !== 'messages_update' && eventType !== 'message_status' && eventType !== 'status') return []

      const message = (body.message ?? body.data ?? body) as Record<string, unknown>
      const externalId =
        typeof message.messageid === 'string'
          ? message.messageid
          : typeof message.id === 'string'
            ? message.id
            : undefined
      const rawStatus = typeof message.status === 'string' ? message.status.toLowerCase() : undefined
      const status = rawStatus ? UAZAPI_STATUS_MAP[rawStatus] : undefined

      if (!externalId || !status) {
        console.error('uazapi parseStatusUpdates: payload de status não reconhecido:', JSON.stringify(body).slice(0, 500))
        return []
      }

      return [{ externalId, status }]
    } catch (err) {
      console.error('Erro ao interpretar status de mensagem da uazapi:', err)
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
 * Busca nome + foto de perfil de um número específico via POST /chat/details —
 * documentado (schema `Chat`) como o jeito de obter `image`/`imagePreview` pra um
 * contato ou grupo. Usado pelo webhook pra resolver a fotinha de cada participante
 * dentro de uma conversa de grupo (o payload da própria mensagem não traz isso — só
 * `senderName`, sem foto — conferido contra o schema `Message` da uazapi). Retorna null
 * em qualquer falha; quem chama decide o que fazer (normalmente: seguir sem foto).
 */
export async function fetchUazapiChatDetails(
  apiBaseUrl: string,
  instanceToken: string,
  number: string
): Promise<{ name: string | null; avatarUrl: string | null } | null> {
  try {
    const base = apiBaseUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/chat/details`, {
      method: 'POST',
      headers: { token: instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, preview: true }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('fetchUazapiChatDetails: falha ao buscar detalhes do chat:', body?.error || res.status)
      return null
    }
    const name = typeof body?.name === 'string' && body.name ? body.name : typeof body?.wa_name === 'string' ? body.wa_name : null
    const avatarUrl = typeof body?.image === 'string' && body.image ? body.image : typeof body?.imagePreview === 'string' ? body.imagePreview : null
    return { name, avatarUrl }
  } catch (err) {
    console.error('fetchUazapiChatDetails: erro de rede:', err)
    return null
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

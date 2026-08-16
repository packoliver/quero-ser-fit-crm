import { NextRequest, NextResponse } from 'next/server'
import { MetaWhatsAppProvider, resolveMetaMediaUrl } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { processInboundEvents, applyStatusUpdates } from '@/lib/integrations/persist-event'
import { mirrorMediaToStorage } from '@/lib/integrations/media'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
import { getServerEnv } from '@/lib/env'
import { timingSafeEqualString, verifyMetaHmacSignature } from '@/lib/security/webhook'
import { z } from 'zod'
import { ICRMIntegrationProvider, IncomingWebhookEvent } from '@/lib/integrations/types'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()

interface ConnectionForMedia {
  organization_id: string
  encrypted_credentials: string | null
}

/**
 * Mensagens de mídia da Cloud API (WhatsApp) chegam só com um media id — resolver o
 * arquivo de verdade exige uma chamada autenticada extra com o token da conexão certa
 * (Bearer), então buscamos a conexão (provider + external_identifier = recipientId) só
 * pros eventos que realmente precisam disso. O Instagram já manda a URL do anexo direto
 * no payload — só precisa ser espelhada pro nosso Storage pra virar permanente.
 */
async function resolveMediaForEvents(
  admin: ReturnType<typeof createAdminClient>,
  events: IncomingWebhookEvent[]
): Promise<IncomingWebhookEvent[]> {
  const needsResolution = events.filter((e) => e.mediaType && (e.providerMediaId || e.mediaUrl))
  if (needsResolution.length === 0) return events

  const connectionCache = new Map<string, ConnectionForMedia | null>()
  const db = admin

  return Promise.all(
    events.map(async (event) => {
      if (!event.mediaType || (!event.providerMediaId && !event.mediaUrl)) return event

      const cacheKey = `${event.provider}:${event.recipientId}`
      let connection = connectionCache.get(cacheKey)
      if (connection === undefined) {
        const { data } = await db
          .from('integration_connections')
          .select('organization_id, encrypted_credentials')
          .eq('provider', event.provider)
          .eq('external_identifier', event.recipientId)
          .maybeSingle()
        connection = data
        connectionCache.set(cacheKey, connection)
      }
      if (!connection) return event

      let sourceUrl = event.mediaUrl
      let authHeader: string | undefined

      // WhatsApp Cloud API: media id → resolve pra URL temporária, que só é baixável
      // com o mesmo Bearer token da conexão.
      if (!sourceUrl && event.providerMediaId) {
        if (!connection.encrypted_credentials) return event
        let accessToken: string
        try {
          accessToken = decryptToken(connection.encrypted_credentials)
        } catch {
          return event
        }
        const resolved = await resolveMetaMediaUrl(accessToken, event.providerMediaId)
        if (!resolved) {
          return { ...event, mediaType: undefined, content: event.content || '[Mídia recebida, mas não foi possível baixar]' }
        }
        sourceUrl = resolved.url
        authHeader = `Bearer ${accessToken}`
      }

      if (!sourceUrl) return event

      const storedUrl = await mirrorMediaToStorage({
        sourceUrl,
        organizationId: connection.organization_id,
        authHeader,
      })

      if (!storedUrl) {
        return { ...event, mediaType: undefined, content: event.content || '[Mídia recebida, mas não foi possível baixar]' }
      }

      return { ...event, mediaUrl: storedUrl }
    })
  )
}

const genericPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough()

/**
 * GET Handler para verificação de Webhook da Meta (hub.challenge / hub.verify_token)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const env = getServerEnv()

  if (!env.META_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json(
      { error: 'Serviço de webhook temporariamente indisponível.' },
      { status: 503 }
    )
  }

  if (mode === 'subscribe' && token && challenge) {
    const isTokenValid = timingSafeEqualString(token, env.META_WEBHOOK_VERIFY_TOKEN)
    if (isTokenValid) {
      return new NextResponse(challenge, { status: 200 })
    }
  }

  return NextResponse.json(
    { error: 'Falha na verificação de autenticidade da requisição.' },
    { status: 403 }
  )
}

/**
 * POST Handler para recepção de eventos de Webhook da Meta.
 *
 * Uses the service-role admin client (not the cookie-based user client) because Meta
 * calls this endpoint server-to-server with no logged-in user session — under the
 * regular client this request has the Postgres `anon` role, which (correctly) has no
 * write access to these tables.
 */
export async function POST(request: NextRequest) {
  console.log('[Meta Webhook] POST recebido em', new Date().toISOString())
  try {
    const env = getServerEnv()

    const candidateSecrets = [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET].filter(
      (secret): secret is string => !!secret
    )

    if (candidateSecrets.length === 0) {
      console.error('[Meta Webhook] Erro: Nenhum segredo configurado (META_APP_SECRET / INSTAGRAM_APP_SECRET)')
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
    }

    const rawBody = await request.text()
    const signatureHeader = request.headers.get('x-hub-signature-256')

    const isSignatureValid = candidateSecrets.some((secret) =>
      verifyMetaHmacSignature(rawBody, signatureHeader, secret)
    )
    if (!isSignatureValid) {
      console.error('[Meta Webhook] Erro: Assinatura HMAC inválida ou ausente.', {
        signatureHeader,
        candidateSecretsCount: candidateSecrets.length,
      })
      return NextResponse.json(
        { error: 'Assinatura de segurança inválida ou ausente.' },
        { status: 401 }
      )
    }

    let jsonBody: Record<string, unknown>
    try {
      jsonBody = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      console.error('[Meta Webhook] Erro: Payload não é um JSON válido.')
      return NextResponse.json(
        { error: 'Formato de payload inválido.' },
        { status: 400 }
      )
    }

    const payloadValidation = genericPayloadSchema.safeParse(jsonBody)
    if (!payloadValidation.success) {
      console.error('[Meta Webhook] Erro: Schema genérico do payload falhou.', payloadValidation.error)
      return NextResponse.json(
        { error: 'Estrutura de evento não reconhecida.' },
        { status: 422 }
      )
    }

    const headerProvider = request.headers.get('x-meta-provider')
    const providerType = headerProvider || (
      jsonBody.object === 'whatsapp_business_account'
        ? 'whatsapp_meta'
        : jsonBody.object === 'instagram' || jsonBody.object === 'page'
          ? 'instagram_meta'
          : null
    )

    if (providerType !== 'whatsapp_meta' && providerType !== 'instagram_meta') {
      console.error('[Meta Webhook] Erro: Objeto do webhook não reconhecido:', jsonBody.object)
      return NextResponse.json({ error: 'Objeto de webhook da Meta não reconhecido.' }, { status: 422 })
    }

    const provider: ICRMIntegrationProvider = providerType === 'whatsapp_meta' ? whatsappProvider : instagramProvider
    const events = provider.parseWebhookPayload(jsonBody)
    console.log('[Meta Webhook] Eventos extraídos do payload:', events.length, events)

    const statusUpdates = provider.parseStatusUpdates?.(jsonBody) || []

    let admin
    try {
      admin = createAdminClient()
    } catch (err) {
      console.error('[Meta Webhook] Erro ao criar cliente admin do Supabase:', err)
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
    }

    const eventsWithMedia = await resolveMediaForEvents(admin, events)
    const processedCount = await processInboundEvents(admin, eventsWithMedia)

    // Status updates must be scoped by organization/connection, using recipientId (phone_number_id)
    // to find the matching connection before applying status changes.
    let statusUpdateCount = 0
    if (statusUpdates.length > 0) {
      for (const update of statusUpdates) {
        if (!update.recipientId) continue

        const { data: connection } = await admin
          .from('integration_connections')
          .select('id, organization_id')
          .eq('provider', 'whatsapp_meta')
          .eq('external_identifier', update.recipientId)
          .maybeSingle() as { data: { id: string; organization_id: string } | null; error?: unknown }

        if (connection) {
          statusUpdateCount += await applyStatusUpdates(admin, [update], {
            connectionId: connection.id,
            organizationId: connection.organization_id,
          })
        }
      }
    }

    return NextResponse.json(
      { status: 'success', processed: processedCount, statusUpdates: statusUpdateCount },
      { status: 200 }
    )
  } catch {
    return NextResponse.json(
      { error: 'Erro interno no processamento do evento.' },
      { status: 500 }
    )
  }
}

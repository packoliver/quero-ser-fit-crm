import { NextRequest, NextResponse } from 'next/server'
import { UazapiWhatsAppProvider, downloadUazapiMedia } from '@/lib/integrations/uazapi-whatsapp'
import { processInboundEvents } from '@/lib/integrations/persist-event'
import { mirrorMediaToStorage } from '@/lib/integrations/media'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'

const uazapiProvider = new UazapiWhatsAppProvider()

/**
 * POST /api/webhooks/uazapi/[secret]
 *
 * uazapi doesn't sign its webhook calls (no HMAC/secret header support at all — see
 * verify-connection.ts), so authenticity here is guaranteed by a random secret
 * embedded in the URL path itself instead, generated per-connection and registered
 * directly on their /webhook endpoint at connection creation/reverify time. Anyone
 * without that secret gets a 404 — the lookup below only proceeds when a connection
 * with a matching webhook_secret actually exists.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ secret: string }> }) {
  try {
    const { secret } = await context.params
    if (!secret) {
      return NextResponse.json({ error: 'Segredo do webhook ausente.' }, { status: 401 })
    }

    let admin
    try {
      admin = createAdminClient()
    } catch {
      return NextResponse.json({ status: 'accepted', processed: 0, warning: 'admin client unavailable' }, { status: 200 })
    }

    const { data: connection } = await (admin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{
              data: {
                id: string
                organization_id: string
                external_identifier: string | null
                api_base_url: string | null
                encrypted_credentials: string | null
              } | null
            }>
          }
        }
      }
    })
      .from('integration_connections')
      .select('id, organization_id, external_identifier, api_base_url, encrypted_credentials')
      .eq('webhook_secret', secret)
      .maybeSingle()

    if (!connection) {
      return NextResponse.json({ error: 'Conexão não encontrada para este segredo.' }, { status: 404 })
    }

    let jsonBody: Record<string, unknown>
    try {
      jsonBody = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Formato de payload inválido.' }, { status: 400 })
    }

    const events = uazapiProvider.parseWebhookPayload(jsonBody)

    // O segredo na URL já identifica a conexão com certeza — sobrescrevemos o
    // recipientId (que o parser só preenche com um valor de fallback, o nome da
    // instância) pelo external_identifier real salvo no banco, que é o que
    // persistInboundEvent usa pra casar o evento com a conexão certa. Evita depender de
    // qualquer campo de identificação inconsistente que a uazapi mande no payload.
    let eventsWithConnection = connection.external_identifier
      ? events.map((event) => ({ ...event, recipientId: connection.external_identifier as string }))
      : events

    // Mensagens de mídia chegam sem a URL de verdade (só o messageId, em
    // providerMediaId) — precisamos de uma chamada autenticada extra pra resolver e
    // baixar o arquivo, e só esta rota tem o token decifrado da conexão pra isso.
    const hasMediaToResolve = eventsWithConnection.some((e) => e.providerMediaId)
    if (hasMediaToResolve && connection.api_base_url && connection.encrypted_credentials) {
      let instanceToken: string | null = null
      try {
        instanceToken = decryptToken(connection.encrypted_credentials)
      } catch {
        instanceToken = null
      }

      if (instanceToken) {
        const token = instanceToken
        const baseUrl = connection.api_base_url
        eventsWithConnection = await Promise.all(
          eventsWithConnection.map(async (event) => {
            if (!event.providerMediaId) return event

            const downloaded = await downloadUazapiMedia(baseUrl, token, event.providerMediaId)
            if (!downloaded) {
              // Não conseguimos baixar — vira uma mensagem de texto com um aviso, em vez
              // de perder o evento inteiro ou salvar um media_type sem media_url (que
              // renderizaria uma imagem/vídeo quebrado na tela).
              return { ...event, mediaType: undefined, content: event.content || '[Mídia recebida, mas não foi possível baixar]' }
            }

            const storedUrl = await mirrorMediaToStorage({
              sourceUrl: downloaded.fileURL,
              organizationId: connection.organization_id,
              mimetypeHint: downloaded.mimetype,
            })

            if (!storedUrl) {
              return { ...event, mediaType: undefined, content: event.content || '[Mídia recebida, mas não foi possível baixar]' }
            }

            return { ...event, mediaUrl: storedUrl }
          })
        )
      }
    }

    const processedCount = await processInboundEvents(admin, eventsWithConnection)

    return NextResponse.json({ status: 'success', processed: processedCount }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Erro interno no processamento do evento.' }, { status: 500 })
  }
}

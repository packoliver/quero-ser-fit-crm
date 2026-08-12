import { NextRequest, NextResponse } from 'next/server'
import { UazapiWhatsAppProvider, downloadUazapiMedia, fetchUazapiChatDetails } from '@/lib/integrations/uazapi-whatsapp'
import { processInboundEvents, applyStatusUpdates } from '@/lib/integrations/persist-event'
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
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
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
    const statusUpdates = uazapiProvider.parseStatusUpdates(jsonBody)

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
    // Qualquer que seja o motivo de não conseguir resolver (sem credenciais salvas,
    // falha ao decifrar, download falhou, mirror falhou), o evento vira uma mensagem de
    // texto com aviso — nunca fica com media_type sem media_url (que renderizaria uma
    // imagem/vídeo quebrado na tela) nem se perde silenciosamente.
    const unresolvedMediaPlaceholder = '[Mídia recebida, mas não foi possível baixar]'
    const hasMediaToResolve = eventsWithConnection.some((e) => e.providerMediaId)

    if (hasMediaToResolve) {
      let instanceToken: string | null = null
      if (connection.api_base_url && connection.encrypted_credentials) {
        try {
          instanceToken = decryptToken(connection.encrypted_credentials)
        } catch {
          instanceToken = null
        }
      }

      const token = instanceToken
      const baseUrl = connection.api_base_url

      eventsWithConnection = await Promise.all(
        eventsWithConnection.map(async (event) => {
          if (!event.providerMediaId) return event

          if (!token || !baseUrl) {
            return { ...event, mediaType: undefined, content: event.content || unresolvedMediaPlaceholder }
          }

          const downloaded = await downloadUazapiMedia(baseUrl, token, event.providerMediaId)
          if (!downloaded) {
            return { ...event, mediaType: undefined, content: event.content || unresolvedMediaPlaceholder }
          }

          const storedUrl = await mirrorMediaToStorage({
            sourceUrl: downloaded.fileURL,
            organizationId: connection.organization_id,
            mimetypeHint: downloaded.mimetype,
          })

          if (!storedUrl) {
            return { ...event, mediaType: undefined, content: event.content || unresolvedMediaPlaceholder }
          }

          return { ...event, mediaUrl: storedUrl }
        })
      )
    }

    const processedCount = await processInboundEvents(admin, eventsWithConnection)
    const statusUpdateCount = await applyStatusUpdates(admin, statusUpdates, {
      connectionId: connection.id,
      organizationId: connection.organization_id,
    })

    // Fotos + nomes de participantes de grupo — best-effort, nunca deve derrubar a
    // resposta do webhook. O payload da mensagem em si não traz foto (só senderName),
    // então isso é uma chamada extra por remetente novo/desatualizado, cacheada em
    // whatsapp_profiles por até 24h pra não bater na API da uazapi a cada mensagem.
    try {
      const groupSenderIds = Array.from(
        new Set(eventsWithConnection.filter((e) => e.isGroup && e.senderId).map((e) => e.senderId))
      )

      if (groupSenderIds.length > 0 && connection.api_base_url && connection.encrypted_credentials) {
        const profileToken = decryptToken(connection.encrypted_credentials)
        const ONE_DAY_MS = 24 * 60 * 60 * 1000

        const { data: cached } = await (admin as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (
                c: string,
                v: string
              ) => { in: (c: string, v: string[]) => Promise<{ data: Array<{ external_id: string; updated_at: string }> | null }> }
            }
          }
        })
          .from('whatsapp_profiles')
          .select('external_id, updated_at')
          .eq('organization_id', connection.organization_id)
          .in('external_id', groupSenderIds)

        const freshIds = new Set(
          (cached || [])
            .filter((row) => Date.now() - new Date(row.updated_at).getTime() < ONE_DAY_MS)
            .map((row) => row.external_id)
        )
        const staleOrMissingIds = groupSenderIds.filter((id) => !freshIds.has(id))

        await Promise.all(
          staleOrMissingIds.map(async (senderId) => {
            const details = await fetchUazapiChatDetails(connection.api_base_url as string, profileToken, senderId)
            if (!details || (!details.name && !details.avatarUrl)) return

            await (admin as unknown as {
              from: (t: string) => { upsert: (d: unknown, o: { onConflict: string }) => Promise<{ error: unknown }> }
            })
              .from('whatsapp_profiles')
              .upsert(
                {
                  organization_id: connection.organization_id,
                  external_id: senderId,
                  name: details.name,
                  avatar_url: details.avatarUrl,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'organization_id,external_id' }
              )
          })
        )
      }
    } catch {
      // Não deixa uma falha aqui (rede, decrypt, schema) derrubar o processamento das
      // mensagens em si — foto de participante de grupo é um extra, não o essencial.
    }

    return NextResponse.json({ status: 'success', processed: processedCount, statusUpdates: statusUpdateCount }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Erro interno no processamento do evento.' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { createClient } from '@/lib/supabase/server'
import { Json } from '@/types/database'
import { getServerEnv } from '@/lib/env'
import { timingSafeEqualString, verifyMetaHmacSignature } from '@/lib/security/webhook'
import { z } from 'zod'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()

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

  // Se o token de verificação da Meta não estiver configurado no ambiente, desabilitar a rota com erro controlado 503
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
 * Processamento defensivo com validação HMAC SHA-256 e suporte a ausência de chaves da Meta sem causar 500.
 */
export async function POST(request: NextRequest) {
  try {
    const env = getServerEnv()

    // Se o segredo do aplicativo Meta não estiver configurado no ambiente, desabilitar a rota com erro controlado 503
    if (!env.META_APP_SECRET) {
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
    }

    const rawBody = await request.text()
    const signatureHeader = request.headers.get('x-hub-signature-256')

    // Validação obrigatória da assinatura HMAC SHA-256 em tempo constante
    const isSignatureValid = verifyMetaHmacSignature(rawBody, signatureHeader, env.META_APP_SECRET)
    if (!isSignatureValid) {
      return NextResponse.json(
        { error: 'Assinatura de segurança inválida ou ausente.' },
        { status: 401 }
      )
    }

    let jsonBody: Record<string, unknown>
    try {
      jsonBody = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: 'Formato de payload inválido.' },
        { status: 400 }
      )
    }

    const payloadValidation = genericPayloadSchema.safeParse(jsonBody)
    if (!payloadValidation.success) {
      return NextResponse.json(
        { error: 'Estrutura de evento não reconhecida.' },
        { status: 422 }
      )
    }

    const providerType =
      request.headers.get('x-meta-provider') ||
      (jsonBody.object === 'whatsapp_business_account' ? 'whatsapp_meta' : 'instagram_meta')

    const events =
      providerType === 'whatsapp_meta'
        ? whatsappProvider.parseWebhookPayload(jsonBody)
        : instagramProvider.parseWebhookPayload(jsonBody)

    const supabase = await createClient()
    const db = supabase as unknown as {
      from: (table: string) => {
        insert: (data: unknown) => Promise<{ error: { code?: string; message: string } | null }>
      }
    }

    let processedCount = 0

    for (const event of events) {
      // Inserção idempotente na tabela webhook_events
      const { error: insertError } = await db.from('webhook_events').insert({
        provider: event.provider,
        external_event_id: event.externalEventId,
        event_type: event.eventType,
        payload: event.rawPayload as Json,
        processed: true,
        processed_at: new Date().toISOString(),
      })

      if (insertError) {
        if (insertError.code === '23505') {
          // Evento duplicado (idempotente) -> Sucesso sem duplicar dados
          continue
        }
      }
      processedCount++
    }

    return NextResponse.json(
      { status: 'success', processed: processedCount },
      { status: 200 }
    )
  } catch {
    return NextResponse.json(
      { error: 'Erro interno no processamento do evento.' },
      { status: 500 }
    )
  }
}

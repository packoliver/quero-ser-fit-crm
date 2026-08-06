import { NextRequest, NextResponse } from 'next/server'
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { processInboundEvents } from '@/lib/integrations/persist-event'
import { createAdminClient } from '@/lib/supabase/admin'
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
  try {
    const env = getServerEnv()

    if (!env.META_APP_SECRET) {
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
    }

    const rawBody = await request.text()
    const signatureHeader = request.headers.get('x-hub-signature-256')

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

    let admin
    try {
      admin = createAdminClient()
    } catch {
      // No SUPABASE_SERVICE_ROLE_KEY configured — accept the webhook (avoid Meta retry
      // storms) but we can't persist anything without it.
      return NextResponse.json({ status: 'accepted', processed: 0, warning: 'admin client unavailable' }, { status: 200 })
    }

    const processedCount = await processInboundEvents(admin, events)

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

import { NextRequest, NextResponse } from 'next/server'
import { ZapApiWhatsAppProvider } from '@/lib/integrations/zapapi-whatsapp'
import { processInboundEvents } from '@/lib/integrations/persist-event'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerEnv } from '@/lib/env'
import { verifyHmacSha256Signature } from '@/lib/security/webhook'

const zapapiProvider = new ZapApiWhatsAppProvider()

/**
 * POST /api/webhooks/zapapi
 *
 * Receives "message.received" callbacks from zap-api.tech. The webhook URL is
 * registered automatically for each instance when its connection is created (see
 * POST /api/integrations/connections), using ZAPAPI_WEBHOOK_SECRET as the signing
 * secret — so the same value must verify the x-zapapi-signature-256 header here.
 */
export async function POST(request: NextRequest) {
  try {
    const env = getServerEnv()

    if (!env.ZAPAPI_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
    }

    const rawBody = await request.text()
    const signatureHeader = request.headers.get('x-zapapi-signature-256')

    if (!verifyHmacSha256Signature(rawBody, signatureHeader, env.ZAPAPI_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: 'Assinatura de segurança inválida ou ausente.' }, { status: 401 })
    }

    let jsonBody: Record<string, unknown>
    try {
      jsonBody = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Formato de payload inválido.' }, { status: 400 })
    }

    const events = zapapiProvider.parseWebhookPayload(jsonBody)

    let admin
    try {
      admin = createAdminClient()
    } catch {
      return NextResponse.json({ status: 'accepted', processed: 0, warning: 'admin client unavailable' }, { status: 200 })
    }

    const processedCount = await processInboundEvents(admin, events)

    return NextResponse.json({ status: 'success', processed: processedCount }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Erro interno no processamento do evento.' }, { status: 500 })
  }
}

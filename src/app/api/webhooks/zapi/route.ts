import { NextRequest, NextResponse } from 'next/server'
import { ZApiWhatsAppProvider } from '@/lib/integrations/zapi-whatsapp'
import { processInboundEvents } from '@/lib/integrations/persist-event'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerEnv } from '@/lib/env'
import { timingSafeEqualString } from '@/lib/security/webhook'

const zapiProvider = new ZApiWhatsAppProvider()

/**
 * POST /api/webhooks/zapi
 *
 * Receives "message received" callbacks from z-api.io. Register this URL (with the
 * ?secret=... query param below) in the Z-API dashboard for each instance, under
 * Webhooks → "Ao receber". Z-API does not sign its webhook payloads (no HMAC), so this
 * shared secret in the URL is what proves the call is legitimate — set
 * ZAPI_WEBHOOK_SECRET to a long random value and configure the same URL+secret in Z-API.
 */
export async function POST(request: NextRequest) {
  try {
    const env = getServerEnv()

    if (!env.ZAPI_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: 'Serviço de webhook temporariamente indisponível.' },
        { status: 503 }
      )
    }

    const secret = request.nextUrl.searchParams.get('secret')
    if (!timingSafeEqualString(secret, env.ZAPI_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: 'Segredo de webhook inválido ou ausente.' }, { status: 401 })
    }

    let jsonBody: Record<string, unknown>
    try {
      jsonBody = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Formato de payload inválido.' }, { status: 400 })
    }

    const events = zapiProvider.parseWebhookPayload(jsonBody)

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

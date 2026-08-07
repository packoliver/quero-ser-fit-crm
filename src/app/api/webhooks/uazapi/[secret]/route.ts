import { NextRequest, NextResponse } from 'next/server'
import { UazapiWhatsAppProvider } from '@/lib/integrations/uazapi-whatsapp'
import { processInboundEvents } from '@/lib/integrations/persist-event'
import { createAdminClient } from '@/lib/supabase/admin'

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
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string } | null }> }
        }
      }
    })
      .from('integration_connections')
      .select('id')
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
    const processedCount = await processInboundEvents(admin, events)

    return NextResponse.json({ status: 'success', processed: processedCount }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Erro interno no processamento do evento.' }, { status: 500 })
  }
}

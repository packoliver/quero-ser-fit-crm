import { NextRequest, NextResponse } from 'next/server'
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { IncomingWebhookEvent } from '@/lib/integrations/types'
import { createAdminClient } from '@/lib/supabase/admin'
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

interface ConnectionMatch {
  id: string
  organization_id: string
}

interface ContactMatch {
  id: string
}

interface ConversationMatch {
  id: string
}

/**
 * Processes one parsed inbound event: finds which of our registered numbers/pages it
 * belongs to, then finds-or-creates the contact, the conversation, and the message row.
 * Returns false (without throwing) when no matching connection is registered yet, so the
 * caller can skip it — this happens for messages arriving before an admin has finished
 * configuring that number in Integrações.
 */
async function persistEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: IncomingWebhookEvent
): Promise<boolean> {
  const db = admin as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: unknown }>
            limit: (n: number) => { maybeSingle: () => Promise<{ data: unknown }> }
          }
        }
      }
      insert: (data: unknown) => {
        select: (cols: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> }
      }
      update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
    }
  }

  const { data: connection } = await db
    .from('integration_connections')
    .select('id, organization_id')
    .eq('provider', event.provider)
    .eq('external_identifier', event.recipientId)
    .maybeSingle()

  const matchedConnection = connection as ConnectionMatch | null
  if (!matchedConnection) {
    // No admin has registered this number/page yet — nothing to attach the message to.
    return false
  }

  const channelType = event.provider === 'whatsapp_meta' ? 'whatsapp' : 'instagram'

  // 1. Find or create the contact via its channel identity (external_id = platform-side sender id).
  const { data: existingChannel } = await db
    .from('contact_channels')
    .select('contact_id')
    .eq('organization_id', matchedConnection.organization_id)
    .eq('external_id', event.senderId)
    .maybeSingle()

  let contactId = (existingChannel as { contact_id: string } | null)?.contact_id

  if (!contactId) {
    const { data: newContact, error: contactError } = await db
      .from('contacts')
      .insert({
        organization_id: matchedConnection.organization_id,
        name: event.senderId,
        phone: channelType === 'whatsapp' ? event.senderId : null,
        status: 'active',
      })
      .select('id')
      .single()

    if (contactError || !newContact) return false
    contactId = (newContact as ContactMatch).id

    await db
      .from('contact_channels')
      .insert({
        organization_id: matchedConnection.organization_id,
        contact_id: contactId,
        channel_type: channelType,
        external_id: event.senderId,
        identifier: event.senderId,
      })
      .select('contact_id')
      .single()
  }

  // 2. Find or create an open conversation on this exact connection for this contact.
  const { data: existingConversation } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('integration_connection_id', matchedConnection.id)
    .limit(1)
    .maybeSingle()

  let conversationId = (existingConversation as ConversationMatch | null)?.id

  if (!conversationId) {
    const { data: newConversation, error: convError } = await db
      .from('conversations')
      .insert({
        organization_id: matchedConnection.organization_id,
        contact_id: contactId,
        channel_type: channelType,
        status: 'open',
        integration_connection_id: matchedConnection.id,
        last_message_at: event.timestamp,
      })
      .select('id')
      .single()

    if (convError || !newConversation) return false
    conversationId = (newConversation as ConversationMatch).id
  } else {
    await db.from('conversations').update({ last_message_at: event.timestamp, status: 'open' }).eq('id', conversationId)
  }

  // 3. Insert the message itself.
  await db
    .from('messages')
    .insert({
      organization_id: matchedConnection.organization_id,
      conversation_id: conversationId,
      sender_type: 'contact',
      content: event.content,
      status: 'delivered',
      external_id: event.externalEventId,
      metadata: event.rawPayload as Json,
    })
    .select('id')
    .single()

  return true
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

    const db = admin as unknown as {
      from: (table: string) => {
        insert: (data: unknown) => Promise<{ error: { code?: string; message: string } | null }>
      }
    }

    let processedCount = 0

    for (const event of events) {
      // Idempotent log entry first — if this exact event was already processed
      // (Meta retried the delivery), skip re-creating the message.
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
          continue
        }
        continue
      }

      const persisted = await persistEvent(admin, event)
      if (persisted) processedCount++
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

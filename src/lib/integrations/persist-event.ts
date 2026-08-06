import { createAdminClient } from '@/lib/supabase/admin'
import { Json } from '@/types/database'
import { IncomingWebhookEvent } from './types'

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

type AdminDb = {
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

/**
 * Processes one parsed inbound event (from any provider — Meta or ZAP API): finds which of
 * our registered numbers/pages it belongs to, then finds-or-creates the contact, the
 * conversation, and the message row. Returns false (without throwing) when no matching
 * connection is registered yet, so the caller can skip it — this happens for messages
 * arriving before an admin has finished configuring that number in Integrações.
 */
export async function persistInboundEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: IncomingWebhookEvent
): Promise<boolean> {
  const db = admin as unknown as AdminDb

  const { data: connection } = await db
    .from('integration_connections')
    .select('id, organization_id')
    .eq('provider', event.provider)
    .eq('external_identifier', event.recipientId)
    .maybeSingle()

  const matchedConnection = connection as ConnectionMatch | null
  if (!matchedConnection) {
    return false
  }

  const channelType = event.provider === 'instagram_meta' ? 'instagram' : 'whatsapp'

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
 * Idempotently logs + persists a batch of parsed inbound events. Shared by every
 * webhook route (Meta, ZAP API, ...): logs each event to webhook_events first (skipping
 * ones already processed, e.g. a provider retrying delivery), then calls
 * persistInboundEvent for the new ones. Returns how many were newly persisted.
 */
export async function processInboundEvents(
  admin: ReturnType<typeof createAdminClient>,
  events: IncomingWebhookEvent[]
): Promise<number> {
  const db = admin as unknown as {
    from: (table: string) => {
      insert: (data: unknown) => Promise<{ error: { code?: string; message: string } | null }>
    }
  }

  let processedCount = 0

  for (const event of events) {
    const { error: insertError } = await db.from('webhook_events').insert({
      provider: event.provider,
      external_event_id: event.externalEventId,
      event_type: event.eventType,
      payload: event.rawPayload as Json,
      processed: true,
      processed_at: new Date().toISOString(),
    })

    if (insertError) {
      // 23505 = duplicate (already processed, e.g. provider retried delivery) — skip.
      continue
    }

    const persisted = await persistInboundEvent(admin, event)
    if (persisted) processedCount++
  }

  return processedCount
}

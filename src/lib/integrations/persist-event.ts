import { createAdminClient } from '@/lib/supabase/admin'
import { Json } from '@/types/database'
import { IncomingWebhookEvent, MessageStatusUpdate } from './types'

// Nunca deixa um status "voltar pra trás" se as atualizações chegarem fora de ordem
// (ex: um "delivered" atrasado chegando depois de um "read" que já processamos).
const STATUS_RANK: Record<string, number> = { sent: 0, delivered: 1, read: 2 }

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

  // conversationKey is the stable identity of the THREAD (the contact for a 1:1 chat,
  // the group for a group message) — deliberately not always the same as senderId, so
  // every member of a group lands in one shared conversation instead of each spawning
  // their own. Providers that don't set it (Meta/Instagram, both 1:1-only) fall back to
  // senderId, which is exactly the old behavior for them.
  const contactExternalId = event.conversationKey || event.senderId
  const contactName = event.conversationName || event.senderName || contactExternalId

  // 1. Find or create the contact via its channel identity.
  const { data: existingChannel } = await db
    .from('contact_channels')
    .select('contact_id')
    .eq('organization_id', matchedConnection.organization_id)
    .eq('external_id', contactExternalId)
    .maybeSingle()

  let contactId = (existingChannel as { contact_id: string } | null)?.contact_id

  if (!contactId) {
    const { data: newContact, error: contactError } = await db
      .from('contacts')
      .insert({
        organization_id: matchedConnection.organization_id,
        name: contactName,
        phone: channelType === 'whatsapp' ? contactExternalId : null,
        status: 'active',
        is_group: !!event.isGroup,
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
        external_id: contactExternalId,
        identifier: contactExternalId,
      })
      .select('contact_id')
      .single()
  }

  // 2. Find or reuse this contact's conversation. Matched by contact_id ALONE — NOT also
  // scoped to this specific integration_connection_id. A connection can get recreated
  // (a free-tier uazapi instance expiring and being re-added, an admin deleting and
  // re-adding a number) without the contact's phone number changing at all; scoping by
  // connection used to treat that as a brand new conversation every time, scattering a
  // recurring client's history across several dead-end threads. If more than one
  // conversation already exists for this contact (from before this fix), we reuse the
  // most recently active one and just keep going from there.
  const { data: existingConversation } = await (
    db as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: ConversationMatch | null }> } }
          }
        }
      }
    }
  )
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversationId = existingConversation?.id

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
    // Always point at the connection THIS message actually came in on — keeps outbound
    // replies going out via whichever number/instance is currently live for this contact.
    await db
      .from('conversations')
      .update({ last_message_at: event.timestamp, status: 'open', integration_connection_id: matchedConnection.id })
      .eq('id', conversationId)
  }

  // 3. Insert the message itself. For a group, the conversation belongs to the group as
  // a whole, but we still record which specific member sent this particular message.
  await db
    .from('messages')
    .insert({
      organization_id: matchedConnection.organization_id,
      conversation_id: conversationId,
      sender_type: 'contact',
      content: event.content,
      media_url: event.mediaUrl || null,
      media_type: event.mediaType || null,
      status: 'delivered',
      external_id: event.externalEventId,
      metadata: {
        ...(event.rawPayload as object),
        ...(event.isGroup ? { group_sender_id: event.senderId, group_sender_name: event.senderName || null } : {}),
      } as Json,
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

function shouldApplyStatus(currentStatus: string, nextStatus: MessageStatusUpdate['status']): boolean {
  // 'failed' is treated as terminal from our side — a real retry sends a brand new
  // message with its own external_id, it doesn't "un-fail" the old one.
  if (currentStatus === 'failed') return false
  if (nextStatus === 'failed') return true
  const currentRank = STATUS_RANK[currentStatus] ?? -1
  const nextRank = STATUS_RANK[nextStatus] ?? -1
  return nextRank > currentRank
}

/**
 * Applies delivery/read (or failure) status updates to messages WE sent, matched by
 * the external_id we got back from sendMessage. Never downgrades (see
 * shouldApplyStatus) — providers don't always deliver these in order. Returns how many
 * rows were actually updated (a message with no matching external_id, or an
 * out-of-order/no-op update, doesn't count).
 */
export async function applyStatusUpdates(
  admin: ReturnType<typeof createAdminClient>,
  updates: MessageStatusUpdate[]
): Promise<number> {
  if (updates.length === 0) return 0

  const db = admin as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: { id: string; status: string } | null }> }
      }
      update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
    }
  }

  let appliedCount = 0

  for (const update of updates) {
    const { data: existing } = await db
      .from('messages')
      .select('id, status')
      .eq('external_id', update.externalId)
      .maybeSingle()

    if (!existing || !shouldApplyStatus(existing.status, update.status)) continue

    const { error } = await db.from('messages').update({ status: update.status }).eq('id', existing.id)
    if (!error) appliedCount++
  }

  return appliedCount
}

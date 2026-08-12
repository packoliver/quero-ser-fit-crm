import { AdminClient } from '@/lib/supabase/admin'
import { Json } from '@/types/database'
import { IncomingWebhookEvent, MessageStatusUpdate } from './types'
import { sendPushToOrganization } from '@/lib/pwa/push'

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

/**
 * Processes one parsed inbound event (from any provider — Meta or ZAP API): finds which of
 * our registered numbers/pages it belongs to, then finds-or-creates the contact, the
 * conversation, and the message row. Returns false (without throwing) when no matching
 * connection is registered yet, so the caller can skip it — this happens for messages
 * arriving before an admin has finished configuring that number in Integrações.
 */
export async function persistInboundEvent(
  admin: AdminClient,
  event: IncomingWebhookEvent
): Promise<boolean> {
  const db = admin

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
        avatar_url: event.conversationAvatarUrl || null,
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
  } else if (event.conversationAvatarUrl) {
    // Best-effort refresh — a contact's WhatsApp photo can change, and the very first
    // message that created this contact might have arrived before uazapi had resolved
    // a photo yet. Never overwrites a known photo with nothing; only writes when this
    // event actually carries one.
    await db.from('contacts').update({ avatar_url: event.conversationAvatarUrl }).eq('id', contactId)
  }

  // 2. Find or reuse this contact's conversation. Matched by contact_id ALONE — NOT also
  // scoped to this specific integration_connection_id. A connection can get recreated
  // (a free-tier uazapi instance expiring and being re-added, an admin deleting and
  // re-adding a number) without the contact's phone number changing at all; scoping by
  // connection used to treat that as a brand new conversation every time, scattering a
  // recurring client's history across several dead-end threads. If more than one
  // conversation already exists for this contact (from before this fix), we reuse the
  // most recently active one and just keep going from there.
  const { data: existingConversation } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: ConversationMatch | null; error?: unknown }

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
 * persistInboundEvent for the new ones. Only marks as processed=true AFTER persistence
 * succeeds — failed persistence remains retryable. Returns how many were newly persisted.
 */
export async function processInboundEvents(
  admin: AdminClient,
  events: IncomingWebhookEvent[]
): Promise<number> {
  let processedCount = 0

  for (const event of events) {
    const { data: connection } = await admin
      .from('integration_connections')
      .select('id, organization_id')
      .eq('provider', event.provider)
      .eq('external_identifier', event.recipientId)
      .maybeSingle()

    if (!connection) continue

    // First, check if this event was already processed
    const { error: checkError, data: existing } = await admin
      .from('webhook_events')
      .select('id, processed')
      .eq('provider', event.provider)
      .eq('integration_connection_id', connection.id)
      .eq('external_event_id', event.externalEventId)
      .maybeSingle() as { error: unknown; data: { id: string; processed: boolean } | null }

    if (!checkError && existing?.processed) {
      // Already processed — skip
      continue
    }

    // If not found, insert as pending (processed=false initially)
    if (!existing) {
      const { error: insertError } = await admin.from('webhook_events').insert({
        provider: event.provider,
        external_event_id: event.externalEventId,
        event_type: event.eventType,
        payload: event.rawPayload as Json,
        processed: false,
        processed_at: null,
        organization_id: connection.organization_id,
        integration_connection_id: connection.id,
      })

      if (insertError) {
        // 23505 = another concurrent insert already created this event — treat as not-yet-processed
        if (!('code' in insertError) || insertError.code !== '23505') {
          // Some other error — skip this event, leave it pending for retry
          continue
        }
      }
    }

    // Attempt persistence; only mark as processed if it succeeds
    const persisted = await persistInboundEvent(admin, event)
    if (persisted) {
      // Mark as processed only after persistence succeeded
      await admin
        .from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('integration_connection_id', connection.id)
        .eq('external_event_id', event.externalEventId)

      processedCount++
      await sendPushToOrganization(admin, connection.organization_id, {
        title: 'Nova mensagem no Quero Ser Fit CRM',
        body: event.content || 'Você recebeu uma nova mensagem.',
        url: `/inbox?conversa=${event.conversationKey || event.senderId}`,
        tag: `crm-message-${event.externalEventId}`,
      })
    }
    // If persisted=false, the event stays pending — next webhook retry will attempt again
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
  admin: AdminClient,
  updates: MessageStatusUpdate[],
  scope: { connectionId: string; organizationId: string }
): Promise<number> {
  if (updates.length === 0) return 0

  let appliedCount = 0

  for (const update of updates) {
    // The receipt is accepted only for an outbound message in the same tenant and
    // connection. The relation filter prevents an external id collision from crossing
    // either organization or WhatsApp connection.
    const { data: existing } = await admin
      .from('messages')
      .select('id, status, conversations!inner(integration_connection_id)')
      .eq('external_id', update.externalId)
      .eq('organization_id', scope.organizationId)
      .eq('sender_type', 'user')
      .eq('conversations.integration_connection_id', scope.connectionId)
      .maybeSingle()

    if (!existing || !shouldApplyStatus(existing.status, update.status)) continue

    const { error } = await admin
      .from('messages')
      .update({ status: update.status })
      .eq('id', existing.id)
      .eq('organization_id', scope.organizationId)

    if (!error) appliedCount++
  }

  return appliedCount
}

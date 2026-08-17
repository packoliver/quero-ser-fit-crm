import { AdminClient } from '@/lib/supabase/admin'
import { Json } from '@/types/database'
import { IncomingWebhookEvent, MessageStatusUpdate } from './types'
import { sendPushToOrganization } from '@/lib/pwa/push'
import { decryptToken } from '@/lib/security/encryption'
import { fetchInstagramUserProfile } from './instagram-meta'
import { maybeSendAutoReply } from './auto-reply'
import { maybeCaptureCsatReply } from './csat'

const STATUS_RANK: Record<string, number> = { sent: 0, delivered: 1, read: 2 }

interface ConnectionMatch {
  id: string
  organization_id: string
  encrypted_credentials?: string | null
  connection_method?: string | null
  external_identifier?: string | null
  api_base_url?: string | null
}

interface ContactMatch {
  id: string
}

interface ConversationMatch {
  id: string
}

/**
 * Descobre a qual conexão registrada um evento pertence.
 *
 * O caminho normal é casar `recipientId` com `external_identifier`. Para o Instagram há
 * um segundo caminho: a Meta expõe dois identificadores pra mesma conta (o `user_id` da
 * conta profissional e o `id` app-scoped) e não é documentado com clareza qual deles vem
 * como `recipient.id` no webhook. Se salvamos um e ela manda o outro, a mensagem seria
 * descartada em silêncio — nenhum log, nenhum erro, só "não chega nada". Por isso o
 * fallback para o identificador alternativo guardado em settings.
 */
async function findConnectionForEvent(
  db: AdminClient,
  event: IncomingWebhookEvent
): Promise<ConnectionMatch | null> {
  const { data: direct } = await db
    .from('integration_connections')
    .select('id, organization_id, encrypted_credentials, connection_method, external_identifier, api_base_url')
    .eq('provider', event.provider)
    .eq('external_identifier', event.recipientId)
    .maybeSingle()

  if (direct) return direct as ConnectionMatch

  if (event.provider !== 'instagram_meta') return null

  if (event.recipientId) {
    const { data: byAppScopedId } = await db
      .from('integration_connections')
      .select('id, organization_id, encrypted_credentials, connection_method, external_identifier, api_base_url')
      .eq('provider', 'instagram_meta')
      .filter('settings->>instagram_app_scoped_id', 'eq', event.recipientId)
      .maybeSingle()

    if (byAppScopedId) return byAppScopedId as ConnectionMatch
  }

  // Fallback 3: For Instagram Meta, route to the registered Instagram connection
  const { data: instagramConnections } = await db
    .from('integration_connections')
    .select('id, organization_id, encrypted_credentials, connection_method, external_identifier, api_base_url')
    .eq('provider', 'instagram_meta')
    .order('updated_at', { ascending: false })

  if (instagramConnections && instagramConnections.length > 0) {
    return instagramConnections[0] as ConnectionMatch
  }

  return null
}

/**
 * Processes one parsed inbound event (from any provider — Meta or ZAP API): finds which of
 * our registered numbers/pages it belongs to, then finds-or-creates the contact, the
 * conversation, and the message row. Returns { success: false } (without throwing) when
 * no matching connection is registered yet, so the caller can skip it — this happens for
 * messages arriving before an admin has finished configuring that number in Integrações.
 * `conversationId` comes back alongside success so the caller can act on that specific
 * conversation afterward (e.g. the business-hours auto-reply) without a second lookup.
 */
export async function persistInboundEvent(
  admin: AdminClient,
  event: IncomingWebhookEvent
): Promise<{ success: boolean; conversationId?: string }> {
  const db = admin

  const matchedConnection = await findConnectionForEvent(db, event)
  if (!matchedConnection) {
    console.log('[persistInboundEvent] Nenhum registro de conexão encontrado para o evento:', {
      provider: event.provider,
      recipientId: event.recipientId,
    })
    return { success: false }
  }

  const channelType = event.provider === 'instagram_meta' ? 'instagram' : 'whatsapp'

  // conversationKey is the stable identity of the THREAD (the contact for a 1:1 chat,
  // the group for a group message) — deliberately not always the same as senderId, so
  // every member of a group lands in one shared conversation instead of each spawning
  // their own. Providers that don't set it (Meta/Instagram, both 1:1-only) fall back to
  // senderId, which is exactly the old behavior for them.
  const contactExternalId = event.conversationKey || event.senderId
  let contactName = event.conversationName || event.senderName || contactExternalId
  let avatarUrl = event.conversationAvatarUrl || null

  // Se for Instagram e tivermos as credenciais, busca automaticamente o nome, @username e foto de perfil na Meta
  if (channelType === 'instagram' && matchedConnection.encrypted_credentials) {
    try {
      const accessToken = decryptToken(matchedConnection.encrypted_credentials)
      const profile = await fetchInstagramUserProfile(accessToken, contactExternalId)
      if (profile) {
        if (profile.name || profile.username) {
          contactName = profile.name || `@${profile.username}`
        }
        if (profile.profilePic) {
          avatarUrl = profile.profilePic
        }
      }
    } catch (err) {
      console.warn('[persistInboundEvent] Não foi possível consultar perfil do Instagram:', err)
    }
  }

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
        avatar_url: avatarUrl,
      })
      .select('id')
      .single()

    if (contactError || !newContact) {
      console.error('[persistInboundEvent] Erro ao criar contato no Supabase:', contactError)
      return { success: false }
    }
    contactId = (newContact as ContactMatch).id

    const { error: channelError } = await db
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

    if (channelError) {
      console.error('[persistInboundEvent] Erro ao criar canal de contato:', channelError)
    }
  } else {
    // Atualiza nome e foto caso tenhamos obtido novas informações do perfil
    const updates: Record<string, unknown> = {}
    if (avatarUrl) updates.avatar_url = avatarUrl
    if (contactName && contactName !== contactExternalId) updates.name = contactName
    if (Object.keys(updates).length > 0) {
      await db.from('contacts').update(updates).eq('id', contactId)
    }
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

    if (convError || !newConversation) {
      console.error('[persistInboundEvent] Erro ao criar conversa no Supabase:', convError)
      return { success: false }
    }
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
  const { error: msgError } = await db
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

  if (msgError) {
    console.error('[persistInboundEvent] Erro ao inserir mensagem no Supabase:', msgError)
    return { success: false }
  }

  console.log('[persistInboundEvent] Mensagem salva com sucesso no Supabase! Conversation ID:', conversationId)
  return { success: true, conversationId }
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
    const connection = await findConnectionForEvent(admin, event)

    if (!connection) continue

    // First, check if this event was already processed
    // Note: webhook_events table only has: id, provider, external_event_id, event_type,
    // payload, processed, processed_at, error_message, created_at
    // (no organization_id or integration_connection_id columns)
    const { error: checkError, data: existing } = await admin
      .from('webhook_events')
      .select('id, processed')
      .eq('provider', event.provider)
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
      })

      if (insertError) {
        // 23505 = another concurrent insert already created this event — treat as not-yet-processed
        if (!('code' in insertError) || insertError.code !== '23505') {
          console.error('[processInboundEvents] Erro ao inserir webhook_event (não é duplicata):', insertError)
          // Still try to persist — log failure but don't block message saving
        }
      }
    }

    // Attempt persistence; only mark as processed if it succeeds
    const persistResult = await persistInboundEvent(admin, event)
    if (persistResult.success) {
      // Mark as processed only after persistence succeeded
      await admin
        .from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('provider', event.provider)
        .eq('external_event_id', event.externalEventId)

      processedCount++
      await sendPushToOrganization(admin, connection.organization_id, {
        title: 'Nova mensagem no Quero Ser Fit CRM',
        body: event.content || 'Você recebeu uma nova mensagem.',
        url: `/inbox?conversa=${event.conversationKey || event.senderId}`,
        tag: `crm-message-${event.externalEventId}`,
      })

      // Resposta automática fora do horário e captura de avaliação (CSAT) — nenhuma das
      // duas bloqueia o processamento do webhook se falhar (ambas nunca lançam exceção).
      if (persistResult.conversationId) {
        await maybeSendAutoReply(admin, event, connection, persistResult.conversationId)
        await maybeCaptureCsatReply(admin, event, connection, persistResult.conversationId)
      }
    }
    // If persistResult.success is false, the event stays pending — next webhook retry will attempt again
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

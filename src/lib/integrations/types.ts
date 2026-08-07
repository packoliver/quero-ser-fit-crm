import { ChannelType } from '@/types/database'

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

export interface OutgoingMessagePayload {
  organizationId: string
  conversationId: string
  recipientExternalId: string
  content: string
  /** Publicly fetchable URL (our own Storage bucket) — required alongside mediaType to send media instead of plain text. */
  mediaUrl?: string
  mediaType?: MediaType
  /** Decrypted access token for this connection (Cloud API access token / uazapi instance token). */
  accessToken?: string
  /** Our identifier for the connection sending this message (phone_number_id / Page ID). */
  fromExternalId?: string
  /** Per-account API host, only used by providers without a fixed base URL (e.g. uazapi's subdomain). */
  apiBaseUrl?: string
}

export interface IncomingWebhookEvent {
  provider: 'whatsapp_meta' | 'instagram_meta' | 'whatsapp_uazapi'
  externalEventId: string
  eventType: string
  /** Who actually sent THIS message — for a group, one specific member; for a 1:1 chat, the contact themself. */
  senderId: string
  /** Display name of whoever sent this specific message, when the provider gives one (e.g. a group member's name). */
  senderName?: string
  recipientId: string
  content: string
  timestamp: string
  rawPayload: Record<string, unknown>
  /** Set directly when the provider already gives a fetchable URL (e.g. Instagram attachments). */
  mediaUrl?: string
  mediaType?: MediaType
  /**
   * Set by the parser when the message IS media but resolving the actual URL requires an
   * extra authenticated call back to the provider (uazapi's /message/download, Meta's
   * media-id lookup) — the webhook route makes that call (it already has the decrypted
   * connection credentials) and fills in mediaUrl before persisting. providerMediaId is
   * whatever ID that follow-up call needs (a message id for uazapi, a media id for Meta).
   */
  providerMediaId?: string
  /**
   * Stable identity of the THREAD this message belongs to — the contact's own id for a
   * 1:1 chat, or the group's id for a group message. This is what contacts/conversations
   * get matched and reused by; it's deliberately separate from `senderId` because in a
   * group, many different senderIds share the same conversationKey. Falls back to
   * senderId when omitted (the right behavior for 1:1-only providers like Meta/Instagram,
   * where every message's sender IS the conversation).
   */
  conversationKey?: string
  /** Display name for the conversationKey's contact — the group's name/subject, when known. */
  conversationName?: string
  isGroup?: boolean
  /**
   * Profile photo URL for the conversationKey's contact (the 1:1 contact's own picture,
   * or the group's photo) — confirmed against uazapi's documented `Chat` schema
   * (`image`/`imagePreview` fields), extracted here when the webhook's embedded `chat`
   * object happens to include it. Free (no extra API call); absent when uazapi doesn't
   * send it for that event.
   */
  conversationAvatarUrl?: string
}

/** A delivery/read status change for a message we already sent, identified by the externalId we got back from sendMessage. */
export interface MessageStatusUpdate {
  externalId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
}

export interface ICRMIntegrationProvider {
  channelType: ChannelType
  verifyWebhook(verifyToken: string, expectedToken: string): boolean
  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[]
  sendMessage(payload: OutgoingMessagePayload): Promise<{ success: boolean; externalId?: string; error?: string }>
  /** Optional — not every provider's webhook exposes delivery/read receipts the same webhook call handles regular messages. */
  parseStatusUpdates?(body: Record<string, unknown>): MessageStatusUpdate[]
}

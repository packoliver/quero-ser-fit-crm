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
  senderId: string
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

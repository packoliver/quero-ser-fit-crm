import { ChannelType } from '@/types/database'

export interface OutgoingMessagePayload {
  organizationId: string
  conversationId: string
  recipientExternalId: string
  content: string
  mediaUrl?: string
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
}

export interface ICRMIntegrationProvider {
  channelType: ChannelType
  verifyWebhook(verifyToken: string, expectedToken: string): boolean
  parseWebhookPayload(body: Record<string, unknown>): IncomingWebhookEvent[]
  sendMessage(payload: OutgoingMessagePayload): Promise<{ success: boolean; externalId?: string; error?: string }>
}

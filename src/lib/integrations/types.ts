import { ChannelType } from '@/types/database'

export interface OutgoingMessagePayload {
  organizationId: string
  conversationId: string
  recipientExternalId: string
  content: string
  mediaUrl?: string
  /** Cloud API: decrypted access token. Z-API: decrypted Instance Token. */
  accessToken?: string
  /** Cloud API: our phone_number_id/Page ID. Z-API: our Instance ID. */
  fromExternalId?: string
  /** Z-API only: decrypted account-level Client-Token (optional security feature). */
  secondaryToken?: string
}

export interface IncomingWebhookEvent {
  provider: 'whatsapp_meta' | 'whatsapp_zapi' | 'instagram_meta'
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

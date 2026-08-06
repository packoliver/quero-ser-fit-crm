import { ChannelType } from '@/types/database'

export interface OutgoingMessagePayload {
  organizationId: string
  conversationId: string
  recipientExternalId: string
  content: string
  mediaUrl?: string
  /** Cloud API only: decrypted access token for this specific connection. */
  accessToken?: string
  /** Cloud API only: our phone_number_id (WhatsApp) or Page ID (Instagram) sending the message. */
  fromExternalId?: string
}

export interface IncomingWebhookEvent {
  provider: 'whatsapp_meta' | 'instagram_meta'
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

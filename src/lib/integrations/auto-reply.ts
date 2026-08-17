import { AdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
import { IncomingWebhookEvent } from './types'
import { MetaWhatsAppProvider } from './whatsapp-meta'
import { MetaInstagramProvider } from './instagram-meta'
import { UazapiWhatsAppProvider } from './uazapi-whatsapp'
import { isOutsideBusinessHours, WeekSchedule } from './business-hours'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()
const uazapiProvider = new UazapiWhatsAppProvider()

// Não reenvia a resposta automática pra mesma conversa toda hora que o cliente escreve
// de novo fora do horário — só depois que passar esse tanto de horas desde o último
// auto-reply ali.
const AUTO_REPLY_COOLDOWN_HOURS = 6

interface ConnectionForAutoReply {
  id: string
  organization_id: string
  encrypted_credentials?: string | null
  connection_method?: string | null
  external_identifier?: string | null
  api_base_url?: string | null
}

/**
 * Se a organização tiver "resposta automática fora do horário" ativada e a mensagem
 * tiver chegado fora do expediente configurado, manda a mensagem automática — mas só
 * uma vez a cada AUTO_REPLY_COOLDOWN_HOURS por conversa, pra não virar spam quando o
 * cliente manda várias mensagens seguidas de madrugada. Nunca lança exceção — uma
 * falha aqui não pode derrubar o processamento do webhook em si.
 */
export async function maybeSendAutoReply(
  admin: AdminClient,
  event: IncomingWebhookEvent,
  connection: ConnectionForAutoReply,
  conversationId: string
): Promise<void> {
  try {
    const db = admin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> }
        }
        update: (vals: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
        insert: (vals: Record<string, unknown>) => Promise<{ error: unknown }>
      }
    }

    const { data: settingsData } = await db
      .from('business_hours_settings')
      .select('enabled, timezone, schedule, auto_reply_message')
      .eq('organization_id', connection.organization_id)
      .maybeSingle()

    const settings = settingsData as {
      enabled: boolean
      timezone: string
      schedule: WeekSchedule
      auto_reply_message: string
    } | null

    if (!settings || !settings.enabled) return
    if (!isOutsideBusinessHours(settings.schedule, settings.timezone)) return

    const { data: convData } = await db
      .from('conversations')
      .select('last_auto_reply_at')
      .eq('id', conversationId)
      .maybeSingle()

    const conv = convData as { last_auto_reply_at: string | null } | null
    if (conv?.last_auto_reply_at) {
      const hoursSinceLastReply = (Date.now() - new Date(conv.last_auto_reply_at).getTime()) / 3_600_000
      if (hoursSinceLastReply < AUTO_REPLY_COOLDOWN_HOURS) return
    }

    if (!connection.encrypted_credentials) return
    const accessToken = decryptToken(connection.encrypted_credentials)

    const provider =
      connection.connection_method === 'uazapi'
        ? uazapiProvider
        : event.provider === 'whatsapp_meta'
          ? whatsappProvider
          : instagramProvider

    // Mesma lógica de "quem é o destinatário" usada em persist-event.ts: o thread inteiro
    // (grupo ou contato 1:1), não necessariamente quem mandou esta mensagem específica.
    const recipientExternalId = event.conversationKey || event.senderId

    const result = await provider.sendMessage({
      organizationId: connection.organization_id,
      conversationId,
      recipientExternalId,
      content: settings.auto_reply_message,
      accessToken,
      fromExternalId: connection.external_identifier || undefined,
      apiBaseUrl: connection.api_base_url || undefined,
    })

    if (!result.success) {
      console.error('[maybeSendAutoReply] Falha ao enviar resposta automática:', result.error)
      return
    }

    await db.from('messages').insert({
      organization_id: connection.organization_id,
      conversation_id: conversationId,
      sender_type: 'user',
      content: settings.auto_reply_message,
      status: 'sent',
      external_id: result.externalId || null,
    })

    await db.from('conversations').update({ last_auto_reply_at: new Date().toISOString() }).eq('id', conversationId)
  } catch (err) {
    console.error('[maybeSendAutoReply] Erro inesperado:', err)
  }
}

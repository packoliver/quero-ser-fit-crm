import { AdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
import { IncomingWebhookEvent } from './types'
import { MetaWhatsAppProvider } from './whatsapp-meta'
import { MetaInstagramProvider } from './instagram-meta'
import { UazapiWhatsAppProvider } from './uazapi-whatsapp'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()
const uazapiProvider = new UazapiWhatsAppProvider()

interface ConnectionForCsat {
  organization_id: string
  encrypted_credentials?: string | null
  connection_method?: string | null
  external_identifier?: string | null
  api_base_url?: string | null
}

/**
 * Interpreta a resposta de uma pesquisa de satisfação: um número de 1 a 5, com ou sem
 * texto ao redor ("5", "5 ⭐", "nota 4, adorei!"). Só aceita o número no INÍCIO da
 * mensagem (ignorando espaços) — evita capturar um "5" que apareça no meio de uma frase
 * não relacionada à avaliação.
 */
export function parseCsatScore(content: string): number | null {
  const match = content.trim().match(/^([1-5])\b/)
  return match ? Number(match[1]) : null
}

/**
 * Se essa conversa está esperando uma nota de avaliação (csat_requested_at setado,
 * csat_score ainda nulo) e a mensagem que acabou de chegar é interpretável como nota,
 * grava a nota e manda um agradecimento. Nunca lança exceção.
 */
export async function maybeCaptureCsatReply(
  admin: AdminClient,
  event: IncomingWebhookEvent,
  connection: ConnectionForCsat,
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

    const { data: convData } = await db
      .from('conversations')
      .select('csat_requested_at, csat_score')
      .eq('id', conversationId)
      .maybeSingle()

    const conv = convData as { csat_requested_at: string | null; csat_score: number | null } | null
    if (!conv?.csat_requested_at || conv.csat_score !== null) return

    const score = parseCsatScore(event.content)
    if (score === null) return

    await db.from('conversations').update({ csat_score: score }).eq('id', conversationId)

    const { data: orgData } = await db
      .from('organizations')
      .select('csat_thank_you_message')
      .eq('id', connection.organization_id)
      .maybeSingle()
    const thankYouMessage = (orgData as { csat_thank_you_message: string } | null)?.csat_thank_you_message

    if (!thankYouMessage || !connection.encrypted_credentials) return

    const accessToken = decryptToken(connection.encrypted_credentials)
    const provider =
      connection.connection_method === 'uazapi'
        ? uazapiProvider
        : event.provider === 'whatsapp_meta'
          ? whatsappProvider
          : instagramProvider

    const recipientExternalId = event.conversationKey || event.senderId
    const result = await provider.sendMessage({
      organizationId: connection.organization_id,
      conversationId,
      recipientExternalId,
      content: thankYouMessage,
      accessToken,
      fromExternalId: connection.external_identifier || undefined,
      apiBaseUrl: connection.api_base_url || undefined,
    })

    if (!result.success) {
      console.error('[maybeCaptureCsatReply] Falha ao enviar agradecimento:', result.error)
      return
    }

    await db.from('messages').insert({
      organization_id: connection.organization_id,
      conversation_id: conversationId,
      sender_type: 'user',
      content: thankYouMessage,
      status: 'sent',
      external_id: result.externalId || null,
    })
  } catch (err) {
    console.error('[maybeCaptureCsatReply] Erro inesperado:', err)
  }
}

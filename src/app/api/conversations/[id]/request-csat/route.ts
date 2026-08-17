import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
import { hasPermission } from '@/lib/security/permissions'
import { UserRole, CustomPermissions } from '@/types/database'
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { UazapiWhatsAppProvider } from '@/lib/integrations/uazapi-whatsapp'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()
const uazapiProvider = new UazapiWhatsAppProvider()

interface ConversationRow {
  id: string
  organization_id: string
  contact_id: string
  channel_type: 'whatsapp' | 'instagram'
  integration_connection_id: string | null
  csat_requested_at: string | null
}

interface ConnectionRow {
  connection_method: 'cloud_api' | 'oauth' | 'uazapi'
  external_identifier: string | null
  api_base_url: string | null
  encrypted_credentials: string | null
}

/**
 * Dispara o pedido de avaliação (CSAT) pra uma conversa — chamado pelo Inbox logo após
 * "Encerrar" ter sucesso. Fica de fora do fluxo de fechar em si (que é uma chamada RPC
 * direta do navegador) porque enviar mensagem pro cliente exige o token da conexão, que
 * o navegador nunca tem acesso (encrypted_credentials tem SELECT revogado de
 * `authenticated`) — só o client admin (service role), daí precisar de uma rota própria.
 * Sempre responde 200 com `sent: false` quando não há nada a fazer (CSAT desligado,
 * conversa já avaliada, etc.) — não é um erro do ponto de vista do Inbox, que só quer
 * "melhor esforço" aqui, nunca bloquear o fechamento da conversa por causa disso.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await context.params

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
    }

    const db = supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: unknown }>
            limit: (n: number) => { maybeSingle: () => Promise<{ data: unknown }> }
          }
        }
      }
    }

    const { data: membershipData } = await db
      .from('organization_members')
      .select('role, permissions')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    const membership = membershipData as { role: UserRole; permissions: CustomPermissions | null } | null
    if (!membership || !hasPermission(membership.role, membership.permissions, 'close_conversations')) {
      return NextResponse.json({ error: 'Sem permissão para encerrar/avaliar conversas.' }, { status: 403 })
    }

    const { data: conversationData } = await db
      .from('conversations')
      .select('id, organization_id, contact_id, channel_type, integration_connection_id, csat_requested_at')
      .eq('id', conversationId)
      .maybeSingle()

    const conversation = conversationData as ConversationRow | null
    if (!conversation) {
      return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
    }
    if (conversation.csat_requested_at) {
      return NextResponse.json({ sent: false, reason: 'already_requested' })
    }
    if (!conversation.integration_connection_id) {
      return NextResponse.json({ sent: false, reason: 'no_connection' })
    }

    let admin
    try {
      admin = createAdminClient()
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Cliente administrativo indisponível.' },
        { status: 500 }
      )
    }

    const adminDb = admin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> }
        }
        update: (vals: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
        insert: (vals: Record<string, unknown>) => Promise<{ error: unknown }>
      }
    }

    const { data: orgData } = await adminDb
      .from('organizations')
      .select('csat_enabled, csat_request_message')
      .eq('id', conversation.organization_id)
      .maybeSingle()

    const org = orgData as { csat_enabled: boolean; csat_request_message: string } | null
    if (!org?.csat_enabled) {
      return NextResponse.json({ sent: false, reason: 'csat_disabled' })
    }

    const { data: contactChannelData } = await adminDb
      .from('contact_channels')
      .select('external_id')
      .eq('contact_id', conversation.contact_id)
      .maybeSingle()
    const recipientExternalId = (contactChannelData as { external_id: string } | null)?.external_id
    if (!recipientExternalId) {
      return NextResponse.json({ sent: false, reason: 'no_recipient' })
    }

    const { data: connectionData } = await adminDb
      .from('integration_connections')
      .select('connection_method, external_identifier, api_base_url, encrypted_credentials')
      .eq('id', conversation.integration_connection_id)
      .maybeSingle()
    const connection = connectionData as ConnectionRow | null
    if (!connection?.encrypted_credentials) {
      return NextResponse.json({ sent: false, reason: 'connection_incomplete' })
    }

    const accessToken = decryptToken(connection.encrypted_credentials)
    const provider =
      connection.connection_method === 'uazapi'
        ? uazapiProvider
        : conversation.channel_type === 'whatsapp'
          ? whatsappProvider
          : instagramProvider

    const result = await provider.sendMessage({
      organizationId: conversation.organization_id,
      conversationId: conversation.id,
      recipientExternalId,
      content: org.csat_request_message,
      accessToken,
      fromExternalId: connection.external_identifier || undefined,
      apiBaseUrl: connection.api_base_url || undefined,
    })

    if (!result.success) {
      return NextResponse.json({ sent: false, reason: 'provider_error', error: result.error })
    }

    await adminDb.from('messages').insert({
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      sender_type: 'user',
      content: org.csat_request_message,
      status: 'sent',
      external_id: result.externalId || null,
    })

    await adminDb
      .from('conversations')
      .update({ csat_requested_at: new Date().toISOString() })
      .eq('id', conversation.id)

    return NextResponse.json({ sent: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Erro inesperado: ${err.message}` : 'Erro inesperado ao pedir avaliação.' },
      { status: 500 }
    )
  }
}

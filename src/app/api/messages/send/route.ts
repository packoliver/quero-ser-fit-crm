import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { ZApiWhatsAppProvider } from '@/lib/integrations/zapi-whatsapp'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()
const zapiProvider = new ZApiWhatsAppProvider()

const sendSchema = z.object({
  conversationId: z.string().uuid('ID de conversa inválido'),
  content: z.string().min(1, 'Mensagem vazia'),
})

interface ConversationRow {
  id: string
  organization_id: string
  contact_id: string
  channel_type: 'whatsapp' | 'instagram'
  integration_connection_id: string | null
}

interface ConnectionRow {
  id: string
  connection_method: 'cloud_api' | 'zapi'
  external_identifier: string | null
  encrypted_credentials: string | null
  status: string
}

type TypedSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      }
    }
    insert: (data: unknown) => Promise<{ error: { message: string } | null }>
    update: (data: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const db = supabase as unknown as TypedSupabase

  // RLS scopes this select to the caller's own organization automatically.
  const { data: conversationData } = await db
    .from('conversations')
    .select('id, organization_id, contact_id, channel_type, integration_connection_id')
    .eq('id', parsed.data.conversationId)
    .maybeSingle()

  const conversation = conversationData as ConversationRow | null
  if (!conversation) {
    return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
  }
  if (!conversation.integration_connection_id) {
    return NextResponse.json(
      { error: 'Esta conversa não está vinculada a uma conexão de WhatsApp/Instagram configurada.' },
      { status: 422 }
    )
  }

  const { data: contactChannelData } = await db
    .from('contact_channels')
    .select('external_id')
    .eq('contact_id', conversation.contact_id)
    .maybeSingle()

  const recipientExternalId = (contactChannelData as { external_id: string } | null)?.external_id
  if (!recipientExternalId) {
    return NextResponse.json({ error: 'Não foi possível identificar o destinatário desta conversa.' }, { status: 422 })
  }

  // integration_connections has SELECT revoked for `authenticated` at the DB level
  // (holds encrypted_credentials) — read it via the service-role admin client. Safe here
  // because we already scoped the lookup by conversation.organization_id above via the
  // RLS-respecting client, and we filter by that same organization_id again below.
  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cliente administrativo indisponível.' },
      { status: 500 }
    )
  }

  const { data: connectionData } = await (admin as unknown as TypedSupabase)
    .from('integration_connections')
    .select('id, connection_method, external_identifier, encrypted_credentials, status')
    .eq('id', conversation.integration_connection_id)
    .maybeSingle()

  const connection = connectionData as ConnectionRow | null
  if (!connection) {
    return NextResponse.json({ error: 'Conexão associada não encontrada.' }, { status: 422 })
  }

  if (!connection.external_identifier || !connection.encrypted_credentials) {
    return NextResponse.json({ error: 'Conexão incompleta (falta token ou identificador).' }, { status: 422 })
  }

  let result: { success: boolean; externalId?: string; error?: string }

  if (connection.connection_method === 'zapi') {
    let instanceToken: string
    let clientToken: string | undefined
    try {
      const decoded = JSON.parse(decryptToken(connection.encrypted_credentials)) as {
        instanceToken: string
        clientToken?: string
      }
      instanceToken = decoded.instanceToken
      clientToken = decoded.clientToken || undefined
    } catch {
      return NextResponse.json({ error: 'Falha ao decifrar as credenciais da conexão Z-API.' }, { status: 500 })
    }

    result = await zapiProvider.sendMessage({
      organizationId: conversation.organization_id,
      conversationId: conversation.id,
      recipientExternalId,
      content: parsed.data.content,
      accessToken: instanceToken,
      fromExternalId: connection.external_identifier,
      secondaryToken: clientToken,
    })
  } else {
    let accessToken: string
    try {
      accessToken = decryptToken(connection.encrypted_credentials)
    } catch {
      return NextResponse.json({ error: 'Falha ao decifrar as credenciais da conexão.' }, { status: 500 })
    }

    const provider = conversation.channel_type === 'whatsapp' ? whatsappProvider : instagramProvider

    result = await provider.sendMessage({
      organizationId: conversation.organization_id,
      conversationId: conversation.id,
      recipientExternalId,
      content: parsed.data.content,
      accessToken,
      fromExternalId: connection.external_identifier,
    })
  }

  const { error: insertError } = await db.from('messages').insert({
    organization_id: conversation.organization_id,
    conversation_id: conversation.id,
    sender_type: 'user',
    sender_id: user.id,
    content: parsed.data.content,
    status: result.success ? 'sent' : 'failed',
    external_id: result.externalId || null,
  })

  if (insertError) {
    return NextResponse.json({ error: 'Mensagem enviada, mas falhou ao registrar no histórico.' }, { status: 500 })
  }

  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Falha ao enviar mensagem.' }, { status: 502 })
  }

  return NextResponse.json({ success: true, externalId: result.externalId })
}

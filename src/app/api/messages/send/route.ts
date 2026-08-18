import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/security/encryption'
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp-meta'
import { MetaInstagramProvider } from '@/lib/integrations/instagram-meta'
import { UazapiWhatsAppProvider } from '@/lib/integrations/uazapi-whatsapp'

const whatsappProvider = new MetaWhatsAppProvider()
const instagramProvider = new MetaInstagramProvider()
const uazapiProvider = new UazapiWhatsAppProvider()

const sendSchema = z
  .object({
    conversationId: z.string().uuid('ID de conversa inválido'),
    content: z.string().max(4096, 'Mensagem muito longa').default(''),
    mediaUrl: z.string().url('URL de mídia inválida').optional(),
    mediaType: z.enum(['image', 'video', 'audio', 'document', 'sticker']).optional(),
    idempotencyKey: z.string().uuid('Chave de idempotência inválida').optional(),
  })
  .refine((data) => data.content.trim().length > 0 || !!data.mediaUrl, {
    message: 'Mensagem vazia',
    path: ['content'],
  })
  .refine((data) => !data.mediaUrl || !!data.mediaType, {
    message: 'Falta o tipo da mídia enviada',
    path: ['mediaType'],
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
  connection_method: 'cloud_api' | 'uazapi'
  external_identifier: string | null
  api_base_url: string | null
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
  try {
    return await handlePost(request)
  } catch {
    return NextResponse.json(
      { error: 'Erro interno ao enviar mensagem.' },
      { status: 500 }
    )
  }
}

async function handlePost(request: NextRequest) {
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

  const idempotencyKey = parsed.data.idempotencyKey || randomUUID()
  const requestHash = createHash('sha256').update(JSON.stringify({ conversationId: parsed.data.conversationId, content: parsed.data.content, mediaUrl: parsed.data.mediaUrl || null, mediaType: parsed.data.mediaType || null })).digest('hex')
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
    .select('id, connection_method, external_identifier, api_base_url, encrypted_credentials, status')
    .eq('id', conversation.integration_connection_id)
    .maybeSingle()

  const connection = connectionData as ConnectionRow | null
  if (!connection) {
    return NextResponse.json({ error: 'Conexão associada não encontrada.' }, { status: 422 })
  }
  if (!connection.encrypted_credentials) {
    return NextResponse.json({ error: 'Conexão incompleta (falta token).' }, { status: 422 })
  }
  if (connection.connection_method === 'cloud_api' && !connection.external_identifier) {
    return NextResponse.json({ error: 'Conexão incompleta (falta identificador).' }, { status: 422 })
  }
  if (connection.connection_method === 'uazapi' && !connection.api_base_url) {
    return NextResponse.json({ error: 'Conexão incompleta (falta Base URL).' }, { status: 422 })
  }

  let accessToken: string
  try {
    accessToken = decryptToken(connection.encrypted_credentials)
  } catch {
    return NextResponse.json({ error: 'Falha ao decifrar as credenciais da conexão.' }, { status: 500 })
  }

  const provider = connection.connection_method === 'uazapi' ? uazapiProvider : conversation.channel_type === 'whatsapp' ? whatsappProvider : instagramProvider

  const attemptsReader = admin as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { eq: (column: string, secondValue: string) => { maybeSingle: () => Promise<{ data: { request_hash: string; status: string; external_id: string | null; error_message: string | null } | null }> } } } } }
  const { data: existingAttempt } = await attemptsReader.from('outbound_message_attempts').select('request_hash, status, external_id, error_message').eq('organization_id', conversation.organization_id).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existingAttempt) {
    if (existingAttempt.request_hash !== requestHash) return NextResponse.json({ error: 'Chave de idempotência reutilizada com outro conteúdo.' }, { status: 409 })
    if (existingAttempt.status === 'sent') return NextResponse.json({ success: true, externalId: existingAttempt.external_id, idempotent: true })
    if (existingAttempt.status === 'failed') return NextResponse.json({ error: existingAttempt.error_message || 'Esta tentativa já falhou.' }, { status: 502 })
  }

  const attemptsWriter = admin as unknown as { from: (table: string) => { insert: (data: unknown) => Promise<{ error: { message: string } | null }>; update: (data: unknown) => { eq: (column: string, value: string) => { eq: (column: string, secondValue: string) => Promise<{ error: { message: string } | null }> } } } }
  await attemptsWriter.from('outbound_message_attempts').insert({
    organization_id: conversation.organization_id,
    user_id: user.id,
    idempotency_key: idempotencyKey,
    conversation_id: conversation.id,
    content: parsed.data.content,
    media_url: parsed.data.mediaUrl || null,
    media_type: parsed.data.mediaType || null,
    request_hash: requestHash,
    status: 'pending',
  })

  const result = await provider.sendMessage({
    organizationId: conversation.organization_id,
    conversationId: conversation.id,
    recipientExternalId,
    content: parsed.data.content,
    mediaUrl: parsed.data.mediaUrl,
    mediaType: parsed.data.mediaType,
    accessToken,
    fromExternalId: connection.external_identifier || undefined,
    apiBaseUrl: connection.api_base_url || undefined,
  })

  const { error: insertError } = await db.from('messages').insert({
    organization_id: conversation.organization_id,
    conversation_id: conversation.id,
    sender_type: 'user',
    sender_id: user.id,
    content: parsed.data.content,
    media_url: parsed.data.mediaUrl || null,
    media_type: parsed.data.mediaType || null,
    status: result.success ? 'sent' : 'failed',
    external_id: result.externalId || null,
  })

  if (insertError) {
    // Se o envio externo TAMBÉM falhou (não só o insert local), não marca como "sent" —
    // uma tentativa futura com essa mesma idempotencyKey precisa poder tentar de novo em
    // vez de receber de volta um falso "sucesso" (ver outbound_message_attempts acima:
    // status 'sent' faz o bloco de reuso no topo desta rota devolver sucesso sem reenviar).
    await attemptsWriter.from('outbound_message_attempts').update({
      status: result.success ? 'sent' : 'failed',
      external_id: result.externalId || null,
      error_message: result.success ? 'Histórico local indisponível após envio externo.' : (result.error || 'Falha no provedor e no histórico local.'),
    }).eq('organization_id', conversation.organization_id).eq('idempotency_key', idempotencyKey)

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Falha ao enviar mensagem (e também ao registrar a tentativa localmente).' }, { status: 502 })
    }
    return NextResponse.json({ error: 'Mensagem enviada, mas o histórico local precisa ser reconciliado.', externalId: result.externalId || null }, { status: 503 })
  }

  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

  await attemptsWriter.from('outbound_message_attempts').update({ status: result.success ? 'sent' : 'failed', external_id: result.externalId || null, error_message: result.success ? null : (result.error || 'Falha no provedor.') }).eq('organization_id', conversation.organization_id).eq('idempotency_key', idempotencyKey)

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Falha ao enviar mensagem.' }, { status: 502 })
  }

  return NextResponse.json({ success: true, externalId: result.externalId })
}

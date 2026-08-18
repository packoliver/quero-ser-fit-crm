import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/security/audit'
import { hasPermission } from '@/lib/security/permissions'
import { UserRole, CustomPermissions } from '@/types/database'

interface MembershipRow {
  organization_id: string
  role: UserRole
  permissions: CustomPermissions | null
}

interface MessageRow {
  id: string
  conversation_id: string
  content: string
  media_type: string | null
  sender_type: 'contact' | 'user' | 'system'
}

/**
 * Exclui uma mensagem (WhatsApp ou Instagram) do histórico. Gate por `delete_messages`
 * na matriz de permissões — não por role fixo — porque admin/manager têm por padrão,
 * mas um dono de organização pode revogar isso de um manager específico via overrides
 * em `organization_members.permissions`, e essa rota precisa respeitar isso.
 *
 * A tabela `messages` não tem SELECT/DELETE revogado de `authenticated` (RLS já isola
 * por tenant), então usamos o client normal (respeitando a sessão do usuário) em vez do
 * admin — igual ao padrão usado em /api/messages/send.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params

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
            maybeSingle: () => Promise<{ data: unknown; error: unknown }>
          }
        }
        delete: () => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
          }
        }
      }
    }

    const { data: membershipData } = await db
      .from('organization_members')
      .select('organization_id, role, permissions')
      .eq('user_id', user.id)
      .maybeSingle()

    const membership = membershipData as MembershipRow | null
    if (!membership) {
      return NextResponse.json({ error: 'Usuário sem organização associada.' }, { status: 403 })
    }

    if (!hasPermission(membership.role, membership.permissions, 'delete_messages')) {
      return NextResponse.json(
        { error: 'Você não tem permissão para excluir mensagens.' },
        { status: 403 }
      )
    }

    const { data: existingData } = await db
      .from('messages')
      .select('id, conversation_id, content, media_type, sender_type')
      .eq('id', id)
      .maybeSingle()

    const existing = existingData as MessageRow | null
    if (!existing) {
      return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
    }

    const { error: deleteError } = await db
      .from('messages')
      .delete()
      .eq('id', id)
      .eq('organization_id', membership.organization_id)

    if (deleteError) {
      console.error('[messages/[id]] Falha ao excluir:', deleteError.message)
      return NextResponse.json({ error: 'Falha ao excluir mensagem.' }, { status: 500 })
    }

    // Guarda o conteúdo apagado no log de auditoria — a mensagem some da conversa, mas
    // fica rastreável quem excluiu o quê e quando, igual ao resto das ações sensíveis do CRM.
    await logAuditEvent({
      organizationId: membership.organization_id,
      actorId: user.id,
      action: 'message_deleted',
      targetType: 'message',
      targetId: id,
      details: {
        conversationId: existing.conversation_id,
        senderType: existing.sender_type,
        hadMedia: !!existing.media_type,
        contentPreview: existing.content?.slice(0, 200) || null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[messages/[id]] Erro inesperado:', err)
    return NextResponse.json({ error: 'Erro inesperado ao excluir mensagem.' }, { status: 500 })
  }
}

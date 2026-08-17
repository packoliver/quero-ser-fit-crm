import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasPermission } from '@/lib/security/permissions'
import { logAuditEvent } from '@/lib/security/audit'
import { UserRole, CustomPermissions } from '@/types/database'

// Revoga (soft-delete) uma chave de API — nunca apaga a linha, pra manter o rastro de
// auditoria de quando cada chave existiu e foi usada pela última vez.
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: { organization_id: string; role: UserRole; permissions: CustomPermissions | null } | null }> } }
      }
    }
  }
  const { data: membership } = await db
    .from('organization_members')
    .select('organization_id, role, permissions')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership || !hasPermission(membership.role, membership.permissions, 'manage_integrations')) {
    return NextResponse.json({ error: 'Apenas administradores podem revogar chaves de API.' }, { status: 403 })
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
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null; count?: number | null }> }
      }
    }
  }
  const { error: updateError } = await adminDb
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', membership.organization_id)

  if (updateError) {
    return NextResponse.json({ error: 'Falha ao revogar a chave.' }, { status: 500 })
  }

  await logAuditEvent({
    organizationId: membership.organization_id,
    actorId: user.id,
    action: 'api_key_revoked',
    targetType: 'api_key',
    targetId: id,
  })

  return NextResponse.json({ success: true })
}

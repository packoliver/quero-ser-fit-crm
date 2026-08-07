import { createAdminClient } from '@/lib/supabase/admin'
import { Json } from '@/types/database'

export interface AuditLogPayload {
  organizationId: string
  actorId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  details?: Record<string, unknown>
  ipAddress?: string | null
}

/**
 * Writes to audit_logs. Must use the service-role admin client — the table
 * intentionally has INSERT/UPDATE/DELETE revoked from the `authenticated` Postgres
 * role (see master_setup.sql), so regular users can never write or tamper with their
 * own audit trail even if they found a way to call this directly. Only trusted
 * server-side code paths (this function, or a SECURITY DEFINER function like
 * update_member_role_safe) can create entries.
 */
export async function logAuditEvent(payload: AuditLogPayload) {
  try {
    const supabase = createAdminClient()
    const db = supabase as unknown as {
      from: (table: string) => { insert: (data: unknown) => Promise<{ error: { message: string } | null }> }
    }
    const { error } = await db.from('audit_logs').insert({
      organization_id: payload.organizationId,
      actor_id: payload.actorId || null,
      action: payload.action,
      target_type: payload.targetType,
      target_id: payload.targetId || null,
      details: (payload.details || {}) as Json,
      ip_address: payload.ipAddress || null,
    })

    if (error) {
      console.error('Falha ao gravar audit_log:', error.message)
    }
  } catch (err) {
    console.error('Erro na auditoria:', err)
  }
}

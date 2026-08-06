import { createClient } from '@/lib/supabase/server'
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

export async function logAuditEvent(payload: AuditLogPayload) {
  try {
    const supabase = await createClient()
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

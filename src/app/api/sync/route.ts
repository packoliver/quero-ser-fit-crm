import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasPermission } from '@/lib/security/permissions'
import type { CustomPermissions, UserRole } from '@/types/database'

const idempotencySchema = z.string().uuid()
const operationSchema = z.enum([
  'contact.create', 'contact.update',
  'task.create', 'task.update',
  'deal.create', 'deal.update',
  'note.create', 'internal_note.create',
])
const payloadSchema = z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 32_000, 'Payload muito grande.')
const requestSchema = z.object({ operation: operationSchema, payload: payloadSchema, baseUpdatedAt: z.string().datetime().nullable().optional() })

type Context = { userId: string; organizationId: string; role: UserRole; permissions: CustomPermissions | null }

async function getContext(): Promise<Context | null> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  const { data: member } = await (supabase as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: { organization_id: string; role: UserRole; permissions: CustomPermissions | null } | null }> } } } })
    .from('organization_members').select('organization_id, role, permissions').eq('user_id', user.id).single()
  if (!member) return null
  return { userId: user.id, organizationId: member.organization_id, role: member.role, permissions: member.permissions }
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function permissionFor(operation: z.infer<typeof operationSchema>): keyof CustomPermissions {
  if (operation.startsWith('contact.')) return operation === 'contact.create' ? 'create_clients' : 'edit_clients'
  if (operation === 'task.create') return 'create_tasks'
  if (operation === 'task.update') return 'edit_tasks'
  if (operation === 'deal.create') return 'create_deals'
  if (operation === 'deal.update') return 'edit_deals'
  return 'view_client_notes'
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && z.string().uuid().safeParse(value).success ? value : null
}

export async function POST(request: NextRequest) {
  const context = await getContext()
  if (!context) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const idempotencyKey = idempotencySchema.safeParse(request.headers.get('idempotency-key'))
  if (!idempotencyKey.success) return NextResponse.json({ error: 'Idempotency-Key UUID é obrigatório.' }, { status: 400 })
  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Operação offline inválida.' }, { status: 400 })
  const { operation, payload, baseUpdatedAt } = parsed.data

  if (!hasPermission(context.role, context.permissions, permissionFor(operation))) {
    return NextResponse.json({ status: 'rejected', error: 'Sem permissão para sincronizar esta operação.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const requestHash = hashPayload({ operation, payload, baseUpdatedAt })
  const { data: existing } = await admin.from('sync_mutations').select('request_hash, status, result').eq('organization_id', context.organizationId).eq('idempotency_key', idempotencyKey.data).maybeSingle()
  if (existing) {
    if (existing.request_hash !== requestHash) return NextResponse.json({ status: 'rejected', error: 'Idempotency-Key já foi usada com outro payload.' }, { status: 409 })
    return NextResponse.json({ status: existing.status, result: existing.result })
  }

  const table = operation.split('.')[0]
  const recordId = uuid(payload.id)
  const update = operation.endsWith('.update')
  if (update && !recordId) return NextResponse.json({ status: 'rejected', error: 'ID do registro ausente.' }, { status: 400 })

  let result: unknown = null
  let status: 'applied' | 'conflict' | 'rejected' = 'applied'
  let errorMessage: string | null = null

  const tableName: Record<string, string> = { contact: 'contacts', task: 'tasks', deal: 'deals' }
  if (update && baseUpdatedAt) {
    const current = await admin.from(tableName[table] || table).select('updated_at').eq('id', recordId!).eq('organization_id', context.organizationId).maybeSingle()
    if (!current.data) {
      status = 'rejected'
      errorMessage = 'Registro não encontrado nesta organização.'
    } else if (current.data.updated_at !== baseUpdatedAt) {
      status = 'conflict'
      errorMessage = 'O registro foi alterado por outra pessoa.'
      result = current.data
    }
  }

  if (status === 'applied' && table === 'contact') {
    const values = { name: typeof payload.name === 'string' ? payload.name.trim().slice(0, 200) : '', email: typeof payload.email === 'string' ? payload.email.slice(0, 320) : null, phone: typeof payload.phone === 'string' ? payload.phone.slice(0, 40) : null, notes: typeof payload.notes === 'string' ? payload.notes.slice(0, 5000) : null }
    if (!values.name && !update) { status = 'rejected'; errorMessage = 'Nome obrigatório.' }
    else if (update) {
      const query = admin.from('contacts').update(values).eq('id', recordId!).eq('organization_id', context.organizationId)
      const response = await query.select('id, name, email, phone, notes, updated_at').maybeSingle()
      result = response.data; errorMessage = response.error?.message || null
    } else {
      const response = await admin.from('contacts').insert({ ...values, organization_id: context.organizationId, status: 'active' }).select('id, name, email, phone, notes, updated_at').single()
      result = response.data; errorMessage = response.error?.message || null
    }
  } else if (table === 'task') {
    const values = { title: typeof payload.title === 'string' ? payload.title.trim().slice(0, 240) : '', description: typeof payload.description === 'string' ? payload.description.slice(0, 5000) : null, status: typeof payload.status === 'string' ? payload.status : 'pending', priority: typeof payload.priority === 'string' ? payload.priority : 'media' }
    if (!values.title && !update) { status = 'rejected'; errorMessage = 'Título obrigatório.' }
    else if (update) { const response = await admin.from('tasks').update(values).eq('id', recordId!).eq('organization_id', context.organizationId).select('id, title, description, status, priority, updated_at').maybeSingle(); result = response.data; errorMessage = response.error?.message || null }
    else { const response = await admin.from('tasks').insert({ ...values, organization_id: context.organizationId }).select('id, title, description, status, priority, updated_at').single(); result = response.data; errorMessage = response.error?.message || null }
  } else if (table === 'deal') {
    const values = { title: typeof payload.title === 'string' ? payload.title.trim().slice(0, 240) : '', value: typeof payload.value === 'number' ? payload.value : null, stage: typeof payload.stage === 'string' ? payload.stage : 'lead', notes: typeof payload.notes === 'string' ? payload.notes.slice(0, 5000) : null }
    if (!values.title && !update) { status = 'rejected'; errorMessage = 'Título obrigatório.' }
    else if (update) { const response = await admin.from('deals').update(values).eq('id', recordId!).eq('organization_id', context.organizationId).select('id, title, value, stage, notes, updated_at').maybeSingle(); result = response.data; errorMessage = response.error?.message || null }
    else { const contactId = uuid(payload.contact_id); if (!contactId) { status = 'rejected'; errorMessage = 'Contato obrigatório.' } else { const response = await admin.from('deals').insert({ ...values, contact_id: contactId, organization_id: context.organizationId }).select('id, title, value, stage, notes, updated_at').single(); result = response.data; errorMessage = response.error?.message || null } }
  } else if (operation === 'note.create') {
    const conversationId = uuid(payload.conversationId)
    const content = typeof payload.content === 'string' ? payload.content.trim().slice(0, 5000) : ''
    if (!conversationId || !content) {
      status = 'rejected'
      errorMessage = 'Conversa e conteúdo da nota são obrigatórios.'
    } else {
      const conversation = await admin.from('conversations').select('id').eq('id', conversationId).eq('organization_id', context.organizationId).maybeSingle()
      if (!conversation.data) {
        status = 'rejected'
        errorMessage = 'Conversa não encontrada nesta organização.'
      } else {
        const response = await admin.from('internal_notes').insert({ conversation_id: conversationId, content, author_id: context.userId, organization_id: context.organizationId }).select('id, conversation_id, content, author_id, created_at').single()
        result = response.data
        errorMessage = response.error?.message || null
      }
    }
  } else {
    status = 'rejected'; errorMessage = 'Operação ainda não habilitada offline.'
  }

  if (errorMessage) {
    if (errorMessage.includes('updated_at') || errorMessage.includes('permission') || errorMessage.includes('not found')) status = 'conflict'
    else status = 'rejected'
  }

  await admin.from('sync_mutations').insert({ organization_id: context.organizationId, user_id: context.userId, idempotency_key: idempotencyKey.data, operation, request_hash: requestHash, status, result: result || (errorMessage ? { error: errorMessage } : null) })
  return NextResponse.json({ status, result, ...(errorMessage ? { error: errorMessage } : {}) }, { status: status === 'applied' ? 200 : status === 'conflict' ? 409 : 422 })
}

import { z } from 'zod'
import type { AdminClient } from '@/lib/supabase/admin'
import { AUDIT_BUCKET, ensureAuditBucket, getLatestAuditRun, readAuditObject, saveAuditRun, startAuditRun, writeAuditObject, type AuditRun } from './full-audit'
import { FORENSIC_VERSION } from './audit-forensic'

export const auditCommandSchema = z.object({ id: z.string().uuid(), action: z.enum(['update', 'resume', 'forensic']), expectedRunId: z.string().uuid().nullable() })
export type AuditCommand = z.infer<typeof auditCommandSchema> & { organizationId: string; requestedAt: string }
interface AuditWorker { controlVersion: number; updatedAt: string; state: string; waitingReason?: string; nextRetryAt?: string }
export interface AuditReceipt { id: string; action: 'update' | 'resume' | 'forensic'; state: 'processing' | 'completed' | 'ignored' | 'failed'; runId?: string; message?: string }

export async function getAuditControl(admin: AdminClient, organizationId: string, requestId?: string | null) {
  const worker = await readAuditObject<AuditWorker>(admin, `${organizationId}/worker.json`)
  const receipt = requestId ? await readAuditObject<AuditReceipt>(admin, `${organizationId}/receipts/${requestId}.json`) : null
  return { available: worker?.controlVersion === 1,
    online: worker?.controlVersion === 1 && worker.state !== 'stopped' && Date.now() - Date.parse(worker.updatedAt) < 90_000,
    state: worker?.state || 'unavailable', waitingReason: worker?.waitingReason || null, nextRetryAt: worker?.nextRetryAt || null, receipt }
}

export async function queueAuditCommand(admin: AdminClient, organizationId: string, input: z.infer<typeof auditCommandSchema>) {
  await ensureAuditBucket(admin)
  const path = `${organizationId}/requests/${input.id}.json`
  const receipt = await readAuditObject<AuditReceipt>(admin, `${organizationId}/receipts/${input.id}.json`)
  if (receipt) return receipt
  const existing = await readAuditObject<AuditCommand>(admin, path)
  if (existing) return { id: existing.id, action: existing.action, state: 'queued' }
  const run = await getLatestAuditRun(admin, organizationId)
  if ((run?.id || null) !== input.expectedRunId) throw new Error('AUDIT_CHANGED')
  if (input.action === 'resume' && !run) throw new Error('AUDIT_MISSING')
  const command: AuditCommand = { ...input, organizationId, requestedAt: new Date().toISOString() }
  // Criação sem upsert torna reenvios da mesma solicitação idempotentes.
  const { error } = await admin.storage.from(AUDIT_BUCKET).upload(path, Buffer.from(JSON.stringify(command)), {
    contentType: 'application/json', upsert: false, cacheControl: '0',
  })
  if (error && !['409', '400'].includes(String('statusCode' in error ? error.statusCode : ''))) throw new Error('Falha ao salvar solicitação.')
  if (error) {
    const saved = await readAuditObject<AuditCommand>(admin, path)
    if (!saved || saved.id !== input.id || saved.organizationId !== organizationId) throw new Error('Falha ao salvar solicitação.')
  }
  return { id: command.id, action: command.action, state: 'queued' }
}

/** Somente o executor único da VPS chama esta função, depois de salvar e parar a revisão anterior. */
export async function applyAuditCommand(admin: AdminClient, organizationId: string, requestId: string) {
  await ensureAuditBucket(admin)
  const command = await readAuditObject<AuditCommand>(admin, `${organizationId}/requests/${requestId}.json`)
  if (!command || command.organizationId !== organizationId || !auditCommandSchema.safeParse(command).success) throw new Error('COMMAND_MISSING')
  const receiptPath = `${organizationId}/receipts/${requestId}.json`
  const receipt = await readAuditObject<AuditReceipt>(admin, receiptPath)
  if (receipt?.state === 'completed' || receipt?.state === 'ignored') return receipt
  const previous = await getLatestAuditRun(admin, organizationId)
  // O ID da solicitação também identifica a nova revisão: uma resposta perdida não cria duas auditorias.
  let next = command.action !== 'resume'
    ? await readAuditObject<AuditRun>(admin, `${organizationId}/runs/${requestId}/run.json`) : null
  if ((previous?.id || null) !== command.expectedRunId && previous?.id !== next?.id) {
    const ignored: AuditReceipt = { id: requestId, action: command.action, state: 'ignored', runId: previous?.id,
      message: 'Uma revisão mais recente já inclui esta atualização.' }
    await writeAuditObject(admin, receiptPath, ignored)
    return ignored
  }
  await writeAuditObject(admin, receiptPath, { id: requestId, action: command.action, state: 'processing' })
  if (command.action !== 'resume') {
    const forensic = command.action === 'forensic' || previous?.version === FORENSIC_VERSION
    next ??= await startAuditRun(admin, organizationId, forensic ? 'media' : 'text', { id: requestId,
      ...(forensic ? { version: FORENSIC_VERSION } : {}),
      // Uma primeira revisão forense precisa conferir todo o inventário com os critérios novos.
      previous: command.action === 'forensic' ? undefined : previous || undefined })
    if (next.organizationId !== organizationId || next.id !== requestId) throw new Error('Revisão incompatível.')
    await writeAuditObject(admin, `${organizationId}/latest.json`, { id: next.id })
    if (previous && previous.id !== next.id && previous.status === 'running') {
      previous.status = 'superseded'
      await saveAuditRun(admin, previous)
    }
  } else {
    if (!previous || previous.status === 'superseded') throw new Error('AUDIT_MISSING')
    next = previous
    if (next.conversations.some(conversation => conversation.state !== 'completed')) {
      for (const conversation of next.conversations) if (conversation.state === 'failed') {
        conversation.state = 'pending'; delete conversation.error
      }
      next.status = 'running'
      await saveAuditRun(admin, next)
    }
  }
  const result: AuditReceipt = { id: requestId, action: command.action, state: 'completed', runId: next.id }
  await writeAuditObject(admin, receiptPath, result)
  return result
}

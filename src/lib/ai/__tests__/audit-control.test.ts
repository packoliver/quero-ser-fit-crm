import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { FORENSIC_VERSION } from '../audit-forensic'
import type { AdminClient } from '@/lib/supabase/admin'
import { AUDIT_VERSION } from '../audit-model'
import { startAuditRun, type AuditRun } from '../full-audit'
import { applyAuditCommand, getAuditControl, queueAuditCommand } from '../audit-control'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/auth', () => ({ getAuthenticatedUserContext: mocks.auth }))
vi.mock('@/lib/env', () => ({ getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-token' }) }))
vi.mock('../client', () => ({ requestAuditJson: vi.fn(), transcribeAuditAudio: vi.fn() }))
import { POST as userPost, GET } from '@/app/api/ai/audit/route'
import { POST as executorPost } from '@/app/api/internal/full-audit/control/route'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const id = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`
const previous: AuditRun = { id: id(0), organizationId: org, version: AUDIT_VERSION, mode: 'text', status: 'running',
  cutoff: '2026-10-01T00:00:00Z', startedAt: '2026-10-01T00:00:00Z', updatedAt: '', conversations: [
    { id: id(1), channel: 'whatsapp', state: 'completed', coverage: { messages: 12 } as never, payment: 'pendente', outcome: 'aberta' },
    { id: id(2), channel: 'instagram', state: 'completed', coverage: { messages: 20 } as never, outcome: 'ganha' },
    { id: id(3), channel: 'whatsapp', state: 'failed', error: 'old failure' },
  ] }
function fakeAdmin(count = 4) {
  const objects = new Map<string, unknown>([
    [`${org}/latest.json`, { id: previous.id }], [`${org}/runs/${previous.id}/run.json`, structuredClone(previous)],
    [`${org}/worker.json`, { controlVersion: 1, state: 'running', updatedAt: new Date().toISOString() }],
  ])
  const rows = Array.from({ length: count }, (_, n) => ({ id: id(n + 1), channel_type: n === 1 ? 'instagram' : 'whatsapp',
    last_message_at: '2026-09-30T00:00:00Z', updated_at: '2026-09-30T00:00:00Z' }))
  const changedMessages = [{ id: id(99), conversation_id: id(2) }]
  const upload = vi.fn(async (path: string, buffer: Buffer, options: { upsert: boolean }) => {
    if (!options.upsert && objects.has(path)) return { error: { statusCode: '409' } }
    objects.set(path, JSON.parse(buffer.toString())); return { error: null }
  })
  const download = vi.fn(async (path: string) => objects.has(path)
    ? { data: new Blob([JSON.stringify(objects.get(path))]), error: null }
    : { data: null, error: { statusCode: '404', message: 'Object not found' } })
  const filters: string[] = []
  const admin = { storage: { listBuckets: async () => ({ data: [{ id: 'crm-private-ai-audits', public: false }], error: null }),
    from: () => ({ upload, download }) }, from: (table: string) => {
    let cursor = '', limit = 500
    const query = { select: vi.fn(), eq: vi.fn(), lte: vi.fn(), in: vi.fn(), order: vi.fn(),
      or: vi.fn((value: string) => { filters.push(value); return query }),
      gt: vi.fn((_field: string, value: string) => { cursor = value; return query }),
      limit: vi.fn((value: number) => { limit = value; return query }),
      then: (resolve: (value: unknown) => void) => resolve({ data: (table === 'conversations' ? rows : changedMessages)
        .filter(row => row.id > cursor).slice(0, limit), error: null }) }
    for (const key of ['select', 'eq', 'lte', 'in', 'order'] as const) query[key].mockReturnValue(query)
    return query
  } } as unknown as AdminClient
  return { admin, objects, upload, download, rows, filters }
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ authenticated: true, organizationId: org, role: 'admin' }) })
describe('Atualização e retomada pelo painel', () => {
  it('nova auditoria forense inventaria tudo sem reaproveitar classificação textual e atualizações conservam o modo', async () => {
    const f = fakeAdmin(905)
    await queueAuditCommand(f.admin, org, { id: id(50), action: 'forensic', expectedRunId: previous.id })
    await applyAuditCommand(f.admin, org, id(50))
    const newRun = f.objects.get(`${org}/runs/${id(50)}/run.json`) as AuditRun
    expect(newRun.version).toBe(FORENSIC_VERSION); expect(newRun.mode).toBe('media')
    expect(newRun.conversations).toHaveLength(905); expect(newRun.conversations.every(item => item.state === 'pending')).toBe(true)
    await queueAuditCommand(f.admin, org, { id: id(51), action: 'update', expectedRunId: id(50) })
    await applyAuditCommand(f.admin, org, id(51))
    expect(f.objects.get(`${org}/runs/${id(51)}/run.json`)).toMatchObject({ version: FORENSIC_VERSION, mode: 'media' })
  })
  it('aproveita concluídas sem mudança, relê edições e mantém novas e falhas pendentes', async () => {
    const f = fakeAdmin()
    const run = await startAuditRun(f.admin, org, 'text', { id: id(50), previous })
    expect(run.conversations.map(c => c.state)).toEqual(['completed', 'pending', 'pending', 'pending'])
    expect(run.conversations[0]).toMatchObject({ resultRunId: previous.id, payment: 'pendente', coverage: { messages: 12 } })
    expect(run.conversations[2].error).toBeUndefined()
    expect(f.filters[0]).toContain('updated_at.gt.')
    expect(previous.conversations[2].state).toBe('failed')
  })
  it('inventaria mais de 500 conversas e preserva a origem ao atualizar mais de uma vez', async () => {
    const f = fakeAdmin(905)
    const inherited = structuredClone(previous); inherited.conversations[0].resultRunId = id(60)
    const run = await startAuditRun(f.admin, org, 'text', { id: id(50), previous: inherited })
    expect(run.conversations).toHaveLength(905)
    expect(run.conversations[0].resultRunId).toBe(id(60))
  })
  it('reenvio da mesma solicitação não cria duas revisões', async () => {
    const f = fakeAdmin(), command = { id: id(50), action: 'update' as const, expectedRunId: previous.id }
    await queueAuditCommand(f.admin, org, command); await queueAuditCommand(f.admin, org, command)
    const first = await applyAuditCommand(f.admin, org, command.id)
    const writes = f.upload.mock.calls.length
    const second = await applyAuditCommand(f.admin, org, command.id)
    expect(first).toEqual(second); expect(f.upload.mock.calls).toHaveLength(writes)
    expect(first.runId).toBe(command.id)
    expect(f.objects.get(`${org}/runs/${previous.id}/run.json`)).toMatchObject({ status: 'superseded' })
  })
  it('duas atualizações do mesmo corte são agrupadas sem segunda revisão', async () => {
    const f = fakeAdmin()
    for (const number of [50, 51]) await queueAuditCommand(f.admin, org, { id: id(number), action: 'update', expectedRunId: previous.id })
    await applyAuditCommand(f.admin, org, id(50))
    expect((await applyAuditCommand(f.admin, org, id(51))).state).toBe('ignored')
    expect(f.objects.has(`${org}/runs/${id(51)}/run.json`)).toBe(false)
  })
  it('retomar conserva corte, ID e resultados em vez de zerar a leitura', async () => {
    const f = fakeAdmin()
    await queueAuditCommand(f.admin, org, { id: id(50), action: 'resume', expectedRunId: previous.id })
    const result = await applyAuditCommand(f.admin, org, id(50))
    expect(result.runId).toBe(previous.id)
    const resumed = f.objects.get(`${org}/runs/${previous.id}/run.json`) as AuditRun
    expect(resumed.cutoff).toBe(previous.cutoff)
    expect(resumed.conversations.slice(0, 2)).toEqual(previous.conversations.slice(0, 2))
    expect(resumed.conversations[2]).toEqual({ id: id(3), channel: 'whatsapp', state: 'pending' })
  })
  it('um painel antigo não substitui revisão mais recente', async () => {
    const f = fakeAdmin(); f.objects.set(`${org}/latest.json`, { id: id(99) })
    f.objects.set(`${org}/runs/${id(99)}/run.json`, { ...previous, id: id(99) })
    await expect(queueAuditCommand(f.admin, org, { id: id(50), action: 'update', expectedRunId: previous.id })).rejects.toThrow('AUDIT_CHANGED')
  })
  it('bloqueia deslogado, atendente, origem externa e parâmetro inválido antes de gravar', async () => {
    const body = JSON.stringify({ id: id(50), action: 'update', expectedRunId: previous.id })
    mocks.auth.mockResolvedValueOnce({ authenticated: false }).mockResolvedValueOnce({ authenticated: true, organizationId: org, role: 'attendant' })
    expect((await userPost(new NextRequest('https://crm.test/api/ai/audit', { method: 'POST', body }))).status).toBe(401)
    expect((await userPost(new NextRequest('https://crm.test/api/ai/audit', { method: 'POST', body }))).status).toBe(403)
    expect((await userPost(new NextRequest('https://crm.test/api/ai/audit', { method: 'POST', body, headers: { origin: 'https://other.test' } }))).status).toBe(403)
    expect((await userPost(new NextRequest('https://crm.test/api/ai/audit', { method: 'POST', body: '{}' }))).status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('não habilita botões antes de atualizar o executor e enfileira usando a empresa autenticada', async () => {
    const f = fakeAdmin(); mocks.admin.mockReturnValue(f.admin)
    f.objects.delete(`${org}/worker.json`)
    const body = JSON.stringify({ id: id(50), action: 'update', expectedRunId: previous.id, organizationId: id(99) })
    expect((await userPost(new NextRequest('https://crm.test/api/ai/audit', { method: 'POST', body }))).status).toBe(503)
    f.objects.set(`${org}/worker.json`, { controlVersion: 1, state: 'idle', updatedAt: new Date().toISOString() })
    expect((await userPost(new NextRequest('https://crm.test/api/ai/audit', { method: 'POST', body }))).status).toBe(202)
    expect(f.objects.get(`${org}/requests/${id(50)}.json`)).toMatchObject({ organizationId: org })
    expect(f.objects.has(`${id(99)}/requests/${id(50)}.json`)).toBe(false)
  })
  it('executor interno rejeita chave incorreta e comando de outra empresa', async () => {
    const f = fakeAdmin(); mocks.admin.mockReturnValue(f.admin)
    await queueAuditCommand(f.admin, org, { id: id(50), action: 'update', expectedRunId: previous.id })
    const body = JSON.stringify({ organizationId: id(99), requestId: id(50) })
    expect((await executorPost(new Request('https://crm.test/api/internal/full-audit/control', { method: 'POST', body }))).status).toBe(401)
    expect((await executorPost(new Request('https://crm.test/api/internal/full-audit/control', { method: 'POST', body,
      headers: { Authorization: 'Bearer test-token' } }))).status).toBe(404)
  })
  it('evidências aproveitadas continuam acessíveis dentro da empresa', async () => {
    const f = fakeAdmin(); mocks.admin.mockReturnValue(f.admin)
    const next = { ...previous, id: id(50), conversations: [{ ...previous.conversations[0], resultRunId: previous.id }] }
    f.objects.set(`${org}/latest.json`, { id: next.id }); f.objects.set(`${org}/runs/${next.id}/run.json`, next)
    f.objects.set(`${org}/runs/${previous.id}/conversations/${id(1)}/result.json`, { conversationId: id(1), channel: 'whatsapp', cutoff: previous.cutoff,
      coverage: { messages: 12 }, chunks: [], analysis: { outcome: 'aberta', summary: 'Preservada.', findings: [] } })
    const response = await GET(new NextRequest(`https://crm.test/api/ai/audit?conversationId=${id(1)}`))
    expect(response.status).toBe(200)
    expect((await response.json()).detail.analysis.summary).toBe('Preservada.')
  })
  it('serviço parado conserva controle disponível, mas não aparece online', async () => {
    const f = fakeAdmin(); f.objects.set(`${org}/worker.json`, { controlVersion: 1, state: 'stopped', updatedAt: new Date().toISOString() })
    expect(await getAuditControl(f.admin, org)).toMatchObject({ available: true, online: false })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AdminClient } from '@/lib/supabase/admin'
import type { AuditMessage } from '../audit-model'
const mocks = vi.hoisted(() => ({ completion: vi.fn(), admin: vi.fn(), auth: vi.fn() }))
vi.mock('../client', () => ({ requestAuditJson: mocks.completion, transcribeAuditAudio: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/auth', () => ({ getAuthenticatedUserContext: mocks.auth }))
vi.mock('@/lib/env', () => ({ getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-token' }) }))
import { auditFullConversation, AuditPendingError, readAuditObject, type AuditRun } from '../full-audit'
import { POST } from '@/app/api/internal/full-audit/route'
import { GET } from '@/app/api/ai/audit/route'
import { FORENSIC_VERSION } from '../audit-forensic'
import { forensicFixture } from './forensic-fixture'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const run: AuditRun = { version: 'test', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', organizationId: org,
  cutoff: '2026-10-01T00:00:00Z', startedAt: '2026-10-01T00:00:00Z', updatedAt: '', status: 'running',
  conversations: [{ id: conversationId, channel: 'whatsapp', state: 'pending' }] }
function fakeAdmin(count = 81, lastMessageAt = '2026-09-01T00:00:00Z') {
  const objects = new Map<string, unknown>()
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const messages: AuditMessage[] = Array.from({ length: count }, (_, index) => ({ id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
    sender_type: 'contact', sender_id: null, content: 'Qual o preço?', media_url: null, media_type: null, created_at: '2026-09-01T00:00:00Z' }))
  const admin = { storage: { from: () => ({
    download: async (path: string) => objects.has(path) ? { data: new Blob([JSON.stringify(objects.get(path))]), error: null }
      : { data: null, error: { statusCode: '404', message: 'Object not found' } },
    upload: async (path: string, buffer: Buffer) => { objects.set(path, JSON.parse(buffer.toString())); return { error: null } },
  }) }, from: (table: string) => {
    const value = table === 'conversations' ? { id: conversationId, last_message_at: lastMessageAt }
      : table === 'messages' ? messages : table === 'deals' ? [{ id: 'deal', stage: 'won' }]
      : table === 'pipeline_stages' ? [{ key: 'won', is_won: true, is_lost: false }] : null
    const query = { select: vi.fn(), eq: vi.fn(), lte: vi.fn(), order: vi.fn(), limit: vi.fn(), gt: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: value, error: null }), upsert,
      then: (resolve: (value: unknown) => void) => resolve({ data: value, error: null }) }
    for (const key of ['select', 'eq', 'lte', 'order', 'limit', 'gt'] as const) query[key].mockReturnValue(query)
    return query
  } } as unknown as AdminClient
  return { admin, upsert, objects, messages }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.completion.mockResolvedValue({ status: 'ok', outcome: 'aberta', summary: 'Atendimento revisado.', outcomeReason: null, lossCategory: null, findings: [] })
})
describe('Execução retomável e acesso à auditoria', () => {
  it('retorna 429 com intervalo, preservando etapas e sem publicar indicador', async () => {
    const { admin, objects, upsert } = fakeAdmin(1)
    objects.set(`${org}/runs/${run.id}/run.json`, run); mocks.admin.mockReturnValue(admin)
    mocks.completion.mockRejectedValue(Object.assign(new Error('Gateway da auditoria retornou HTTP 429.'),
      { auditGatewayStatus: 429, retryAfterSeconds: 600, auditGatewayKind: 'image' }))
    const response = await POST(new Request('https://crm.test/api/internal/full-audit', { method: 'POST',
      headers: { Authorization: 'Bearer test-service-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: org, runId: run.id, conversationId }) }))
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('600')
    expect(upsert).not.toHaveBeenCalled(); expect(objects.get(`${org}/runs/${run.id}/run.json`)).toEqual(run)
  })
  it('salva primeira passagem e retoma segunda passagem forense sem usar ganho manual como prova', async () => {
    const { admin, upsert, objects } = fakeAdmin(1)
    const forensicRun = { ...run, version: FORENSIC_VERSION, mode: 'media' as const }
    mocks.completion.mockResolvedValueOnce({ status: 'ok', outcome: 'ganha', summary: 'Resultado antigo.', outcomeReason: null, lossCategory: null, findings: [] })
      .mockResolvedValueOnce(forensicFixture()).mockResolvedValueOnce(forensicFixture())
    await expect(auditFullConversation(admin, forensicRun, run.conversations[0], 1)).rejects.toBeInstanceOf(AuditPendingError)
    await expect(auditFullConversation(admin, forensicRun, run.conversations[0], 1)).rejects.toBeInstanceOf(AuditPendingError)
    expect(upsert).not.toHaveBeenCalled()
    expect([...objects.keys()].some(path => path.endsWith('forensic-first.json'))).toBe(true)
    const result = await auditFullConversation(admin, forensicRun, run.conversations[0], 1)
    expect(result.forensic?.status).toBe('INCONCLUSIVA'); expect(result.analysis.outcome).toBe('aberta')
    expect(result.recordedOutcome).toBe('ganha'); expect(result.quality?.secondPassAt).toBeTruthy()
    expect(mocks.completion).toHaveBeenCalledTimes(3); expect(upsert).toHaveBeenCalledTimes(1)
  })
  it('lê progresso e etapas com nonce novo e sem reutilizar cache', async () => {
    const download = vi.fn().mockResolvedValue({ data: new Blob(['{"status":"running"}']), error: null })
    const admin = { storage: { from: () => ({ download }) } } as unknown as AdminClient
    await readAuditObject(admin, 'private/run.json')
    await readAuditObject(admin, 'private/run.json')
    expect(download.mock.calls[0][1].cacheNonce).not.toBe(download.mock.calls[1][1].cacheNonce)
    expect(download.mock.calls[0][2]).toEqual({ cache: 'no-store' })
    expect(download.mock.calls[1][2]).toEqual({ cache: 'no-store' })
  })
  it('salva o lote, retoma e atualiza indicadores somente após ler a conversa completa', async () => {
    const { admin, upsert } = fakeAdmin()
    await expect(auditFullConversation(admin, run, run.conversations[0], 1)).rejects.toBeInstanceOf(AuditPendingError)
    expect(upsert).not.toHaveBeenCalled()
    await expect(auditFullConversation(admin, run, run.conversations[0], 1)).rejects.toBeInstanceOf(AuditPendingError)
    const result = await auditFullConversation(admin, run, run.conversations[0], 1)
    expect(mocks.completion).toHaveBeenCalledTimes(3)
    expect(result.coverage.messages).toBe(81)
    expect(result.analysis.outcome).toBe('ganha')
    expect(upsert).toHaveBeenCalledTimes(1)
  })
  it('preserva indicadores quando chegaram novas mensagens depois do corte', async () => {
    const { admin, upsert } = fakeAdmin(1, '2026-10-02T00:00:00Z')
    const result = await auditFullConversation(admin, run, run.conversations[0])
    expect(result.insightUpdated).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
  it('não apaga análise existente de conversa sem mensagens', async () => {
    const { admin, upsert } = fakeAdmin(0)
    await auditFullConversation(admin, run, run.conversations[0])
    expect(mocks.completion).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
  it('revisão de texto lê todo o contexto e não transcreve novos anexos', async () => {
    const { admin, messages } = fakeAdmin(151)
    messages[0].media_type = 'audio'
    messages[0].media_url = 'https://source.test/audio.ogg'
    mocks.completion.mockResolvedValue({ status: 'ok', outcome: 'aberta', summary: 'Pedido registrado, pagamento ainda não confirmado.',
      outcomeReason: null, lossCategory: null, findings: [], payment: {
        status: 'sem_indicio', method: 'nao_identificado', summary: 'Sem confirmação no texto.', evidence: [],
      } })
    const result = await auditFullConversation(admin, { ...run, mode: 'text' }, run.conversations[0])
    const batches = mocks.completion.mock.calls.map(call => call[2]).filter(input => input.messages)
    expect(batches.flatMap(input => input.messages.map((m: { id: string }) => m.id))).toEqual(messages.map(m => m.id))
    expect(mocks.completion.mock.calls.at(-1)?.[2].finalMessages.at(-1).id).toBe(messages.at(-1)?.id)
    expect(result.coverage.messages).toBe(151)
    expect(result.coverage.audioTranscribed).toBe(0)
    expect(result.media[0].interpretation.state).toBe('unavailable')
    expect(result.analysis.outcome).toBe('aberta')
    expect(result.recordedOutcome).toBe('ganha')
    expect(result.analysis.payment?.status).toBe('sem_indicio')
  })
  it('revisão de vendas rejeita resposta que omite a análise do pagamento', async () => {
    const { admin, upsert } = fakeAdmin(1)
    await expect(auditFullConversation(admin, { ...run, mode: 'text' }, run.conversations[0], 1)).rejects.toThrow('estado do pagamento')
    expect(upsert).not.toHaveBeenCalled()
  })
  it('executor rejeita token ausente, incorreto e texto multibyte sem chamar o banco', async () => {
    for (const token of ['', 'wrong-token', 'é'.repeat(18)]) {
      const response = await POST(new Request('https://crm.test/api/internal/full-audit', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      expect(response.status).toBe(401)
    }
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('API de evidências bloqueia usuário deslogado ou atendente', async () => {
    mocks.auth.mockResolvedValueOnce({ authenticated: false }).mockResolvedValueOnce({ authenticated: true, organizationId: org, role: 'agent' })
    expect((await GET(new NextRequest('https://crm.test/api/ai/audit'))).status).toBe(401)
    expect((await GET(new NextRequest('https://crm.test/api/ai/audit'))).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})

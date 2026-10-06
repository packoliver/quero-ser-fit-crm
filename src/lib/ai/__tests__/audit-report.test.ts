import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AuditRun, ConversationAudit } from '../full-audit'
const mocks = vi.hoisted(() => ({ completion: vi.fn(), auth: vi.fn(), admin: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('../client', () => ({ requestAuditJson: mocks.completion }))
vi.mock('@/lib/auth', () => ({ getAuthenticatedUserContext: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('../full-audit', () => ({ getLatestAuditRun: vi.fn(), loadAuditMessages: vi.fn(), readAuditObject: mocks.read, writeAuditObject: mocks.write }))
vi.mock('@/lib/security/rate-limit-middleware', () => ({ withRateLimit: (_category: string, handler: unknown) => handler }))
import { buildAuditReport, buildReportQuestionContext, answerAuditReport } from '../audit-report'
import { exportAuditReport } from '../audit-report-export'
import { GET, POST } from '@/app/api/ai/audit/report/route'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', conv = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const run: AuditRun = { id: runId, organizationId: org, version: 'v5', cutoff: '2026-10-01', startedAt: '', updatedAt: '2026-10-02', status: 'running',
  conversations: [{ id: conv, channel: 'whatsapp', state: 'completed' }, { id: org, channel: 'instagram', state: 'pending' }] }
const finding = { type: 'acerto' as const, confidence: 'alta' as const, description: 'Resposta clara sobre o produto.',
  evidence: [{ messageId: org, source: 'text' as const, quote: 'Produto tamanho M' }] }
const result = { runId, conversationId: conv, channel: 'whatsapp', coverage: { messages: 20, mediaUntranscribed: 2 },
  analysis: { status: 'ok', outcome: 'aberta', summary: 'Atendimento.', outcomeReason: null, lossCategory: null, findings: [finding] },
  chunks: [{ analysis: { findings: [finding] } }], media: [] } as unknown as ConversationAudit
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ authenticated: true, organizationId: org, role: 'admin' }); mocks.admin.mockReturnValue({}) })
describe('Relatório calculado e perguntas referenciadas', () => {
  it('conta cada conversa e achado uma vez, sem chamar IA para inventar números', () => {
    const report = buildAuditReport(run, [result, result])
    expect(report.reviewed).toBe(1); expect(report.messages).toBe(20); expect(report.pending).toBe(1)
    expect(report.topics[0].occurrences).toBe(1); expect(report.topics[0].conversations).toBe(1)
    expect(report.channels[0].reviewed).toBe(1)
    expect(report.forensic.summary.effective).toBe(0); expect(report.forensic.summary.notAnalyzed).toBe(2)
    expect(mocks.completion).not.toHaveBeenCalled()
  })
  it('resultado ausente gera lacuna explícita e nunca entra nos totais', () => {
    const report = buildAuditReport(run, [])
    expect(report.missingResults).toBe(1); expect(report.reviewed).toBe(0)
    expect(report.forensic.summary.complete).toBe(false)
  })
  it('contexto limita exemplos, mantém números completos e exporta limites e referências', () => {
    const report = buildAuditReport(run, [result])
    const context = buildReportQuestionContext(report, 'Quais produtos foram bem explicados?')
    expect(context.coverage.messages).toBe(20); expect(context.selectedEvidence[0].evidence[0].messageId).toBe(org)
    const exported = exportAuditReport(report)
    expect(exported).toContain('AUDITORIA FORENSE NÃO CONCLUÍDA'); expect(exported).toContain(`Mensagem ${org}`)
    expect(exported).toContain('0 + 0 + 0 + 0 + 0 = 0')
  })
  it('aceita resposta referenciada e rejeita referência inventada ou omitida no contrato', async () => {
    const report = buildAuditReport(run, [result])
    mocks.completion.mockResolvedValueOnce({ answer: 'Boa clareza [f1].', sourceIds: ['f1'] })
    expect((await answerAuditReport(report, org, 'Como melhorar?')).sources[0].conversationId).toBe(conv)
    mocks.completion.mockResolvedValueOnce({ answer: 'Erro [f999].', sourceIds: ['f999'] })
    await expect(answerAuditReport(report, org, 'Como melhorar?')).rejects.toThrow('referência')
    mocks.completion.mockResolvedValueOnce({ answer: 'Acerto [f1].', sourceIds: [] })
    await expect(answerAuditReport(report, org, 'Como melhorar?')).rejects.toThrow('referência')
  })
  it('uma pergunta ampla pode citar mais de doze evidências realmente fornecidas', async () => {
    const report = buildAuditReport(run, [result])
    report.sources = Array.from({ length: 15 }, (_, index) => ({ ...report.sources[0], id: `f${index + 1}` }))
    mocks.completion.mockResolvedValue({ answer: 'Resumo dos atendimentos.', sourceIds: report.sources.map(source => source.id) })
    expect((await answerAuditReport(report, org, 'Quais acertos e erros?')).sources).toHaveLength(15)
  })
})
describe('Autorização e privacidade do relatório', () => {
  const post = (request: NextRequest) => POST(request, undefined)
  const request = (body: unknown, origin = 'https://crm.test') => new NextRequest('https://crm.test/api/ai/audit/report', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  it('bloqueia não autenticado e atendente antes de ler informações comerciais', async () => {
    mocks.auth.mockResolvedValueOnce({ authenticated: false })
    expect((await GET()).status).toBe(401)
    mocks.auth.mockResolvedValueOnce({ authenticated: true, organizationId: org, role: 'agent' })
    expect((await post(request({}))).status).toBe(403); expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('bloqueia origem externa e referências de caminho não UUID', async () => {
    expect((await post(request({}, 'https://other.test'))).status).toBe(403)
    expect((await post(request({ runId: '../../another-org', reportId: 'a'.repeat(64), question: 'teste' }))).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('escopo vem da sessão, e um relatório ausente em outra organização não é exposto', async () => {
    mocks.read.mockResolvedValue(null)
    expect((await post(request({ runId, reportId: 'a'.repeat(64), question: 'Quais erros?', organizationId: 'another-org' }))).status).toBe(409)
    expect(mocks.read.mock.calls[0][1]).toBe(`${org}/runs/${runId}/reports/${'a'.repeat(64)}.json`)
    expect(mocks.completion).not.toHaveBeenCalled()
  })
  it('responde sobre o snapshot salvo, preserva pergunta privada e omite credenciais', async () => {
    const report = buildAuditReport(run, [result]); mocks.read.mockResolvedValue(report)
    mocks.completion.mockResolvedValue({ answer: 'A clareza é um acerto [f1].', sourceIds: ['f1'] })
    const response = await post(request({ runId, reportId: report.id, question: 'Quais acertos?' }))
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store')
    const payload = await response.json(); expect(payload.reviewed).toBe(1); expect(payload.sources[0].conversationId).toBe(conv)
    expect(mocks.write.mock.calls[0][1]).toMatch(new RegExp(`^${org}/runs/${runId}/questions/`))
    expect(JSON.stringify(payload)).not.toMatch(/SUPABASE|Authorization|apiKey/)
  })
})

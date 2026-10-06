import { describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '@/lib/supabase/admin'
import { buildAuditBatches, calculateAuditCoverage, validateAuditAnalysis, validateTextSalesAnalysis, type AuditMessage } from '../audit-model'
import { ensureAuditBucket, loadAuditMessages, readAuditObject, summarizeAuditRun, type AuditRun } from '../full-audit'

const id = '00000000-0000-4000-8000-000000000001'
function message(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { id, sender_type: 'contact', sender_id: null, content: 'Qual o preço?', media_url: null,
    media_type: null, created_at: '2026-09-01T12:00:00Z', ...overrides }
}
const analysis = { status: 'atencao', outcome: 'aberta', summary: 'Cliente perguntou o preço.', outcomeReason: null,
  lossCategory: null, findings: [{ type: 'pendencia', description: 'Pergunta do cliente.', confidence: 'alta', evidence: [{ messageId: id, quote: 'Qual o preço?' }] }] }

describe('Auditoria completa e verificável', () => {
  it('retenta falha temporária do armazenamento com leituras sem cache', async () => {
    const download = vi.fn().mockResolvedValueOnce({ error: { statusCode: '502', message: 'Bad Gateway' } })
      .mockResolvedValueOnce({ data: new Blob(['{"ok":true}']), error: null })
    const admin = { storage: { from: () => ({ download }) } } as unknown as AdminClient
    expect(await readAuditObject(admin, 'private/result.json')).toEqual({ ok: true })
    expect(download).toHaveBeenCalledTimes(2)
    expect(download.mock.calls[0][1].cacheNonce).not.toBe(download.mock.calls[1][1].cacheNonce)
    expect(download.mock.calls[1][2]).toEqual({ cache: 'no-store' })
  })
  it('não retenta autorização negada nem registro ausente', async () => {
    for (const statusCode of ['401', '404']) {
      const download = vi.fn().mockResolvedValue({ error: { statusCode, message: statusCode === '404' ? 'Object not found' : 'Denied' } })
      const admin = { storage: { from: () => ({ download }) } } as unknown as AdminClient
      if (statusCode === '404') expect(await readAuditObject(admin, 'private/result.json')).toBeNull()
      else await expect(readAuditObject(admin, 'private/result.json')).rejects.toThrow('Denied')
      expect(download).toHaveBeenCalledTimes(1)
    }
  })
  it('envia todas as mensagens, incluindo as anteriores ao antigo limite de 40', () => {
    const messages = Array.from({ length: 181 }, (_, index) => message({ id: String(index), content: `Texto ${index}` }))
    const batches = buildAuditBatches(messages)
    expect(batches).toHaveLength(3)
    expect(batches.flat().map(item => item.id)).toEqual(messages.map(item => item.id))
  })
  it('preserva todo o conteúdo de uma mensagem longa e pares Unicode', () => {
    const content = 'Texto completo 🙂'.repeat(2000)
    const batches = buildAuditBatches([message({ content })], 4000)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat().map(item => item.content).join('')).toBe(content)
    expect(batches.flat().every(item => item.id === id)).toBe(true)
  })
  it('não transmite URLs de anexos com possíveis tokens na auditoria textual', () => {
    const batch = buildAuditBatches([message({ media_url: 'https://example.test/file?token=test-only' })])
    expect(JSON.stringify(batch)).not.toContain('token=')
  })
  it('aceita citações verificáveis e rejeita texto inventado ou ID de outra conversa', () => {
    expect(validateAuditAnalysis(analysis, [message()]).findings).toHaveLength(1)
    expect(() => validateAuditAnalysis({ ...analysis, findings: [{ ...analysis.findings[0], evidence: [{ messageId: id, quote: 'O cliente comprou.' }] }] }, [message()])).toThrow('evidência')
    expect(() => validateAuditAnalysis(analysis, [message({ id: '00000000-0000-4000-8000-000000000002' })])).toThrow('evidência')
  })
  it('registra separadamente as limitações de mídia, sem afirmar que o áudio foi ouvido', () => {
    const coverage = calculateAuditCoverage([message(), message({ id: 'audio', content: '', media_type: 'audio' })])
    expect(coverage.messages).toBe(2)
    expect(coverage.textMessages).toBe(1)
    expect(coverage.mediaUntranscribed).toBe(1)
  })
  it('não aceita relato do cliente como confirmação de pagamento pela loja', () => {
    const raw = { ...analysis, findings: [], payment: { status: 'confirmado_pela_loja', method: 'pix',
      summary: 'Pagamento confirmado.', evidence: [{ messageId: id, source: 'text', quote: 'Já fiz o Pix.' }] } }
    expect(() => validateAuditAnalysis(raw, [message({ content: 'Já fiz o Pix.' })])).toThrow('atendente')
    expect(validateAuditAnalysis({ ...raw, payment: { ...raw.payment, status: 'relatado_pelo_cliente' } },
      [message({ content: 'Já fiz o Pix.' })]).payment?.status).toBe('relatado_pelo_cliente')
  })
  it('exige citação real para pagamento e aceita confirmação textual do atendente', () => {
    const raw = { ...analysis, findings: [], payment: { status: 'confirmado_pela_loja', method: 'pix',
      summary: 'Atendente confirmou recebimento.', evidence: [{ messageId: id, source: 'text', quote: 'Recebemos seu Pix.' }] } }
    expect(validateAuditAnalysis(raw, [message({ sender_type: 'user', content: 'Recebemos seu Pix.' })]).payment?.status).toBe('confirmado_pela_loja')
    expect(() => validateAuditAnalysis(raw, [message({ sender_type: 'user', content: 'Essa é nossa chave Pix.' })])).toThrow('evidência')
    expect(() => validateAuditAnalysis({ ...raw, payment: { ...raw.payment, evidence: [] } }, [message()])).toThrow('sem evidência')
  })
  it('não transforma silêncio ou envio de preço em venda perdida', () => {
    const sources = [message({ content: 'O short custa R$ 40.' })]
    const raw = { ...analysis, findings: [], outcome: 'perdida', outcomeReason: 'Cliente parou de responder.',
      lossCategory: 'cliente_sem_retorno', outcomeEvidence: [{ messageId: id, source: 'text', quote: 'O short custa R$ 40.' }] }
    expect(validateTextSalesAnalysis(validateAuditAnalysis(raw, sources), sources)).toMatchObject({ outcome: 'aberta', outcomeReason: null, lossCategory: null })
  })
  it('aceita desistência explícita e não confunde negação do cancelamento com perda', () => {
    for (const [text, expected] of [['Desisti, obrigada.', 'perdida'], ['O pedido não foi cancelado.', 'aberta']] as const) {
      const sources = [message({ content: text })]
      const raw = { ...analysis, findings: [], outcome: 'perdida', outcomeEvidence: [{ messageId: id, source: 'text', quote: text }] }
      expect(validateTextSalesAnalysis(validateAuditAnalysis(raw, sources), sources).outcome).toBe(expected)
    }
  })
  it('chave Pix não comprova recebimento, mesmo quando a IA atribui confirmação', () => {
    for (const [text, paid] of [['Nossa chave Pix é esta.', false], ['Ainda não recebemos seu Pix.', false], ['Recebemos seu Pix.', true]] as const) {
      const sources = [message({ sender_type: 'user', content: text })]
      const evidence = [{ messageId: id, source: 'text', quote: text }]
      const raw = { ...analysis, findings: [], outcome: 'ganha', outcomeEvidence: evidence,
        payment: { status: 'confirmado_pela_loja', method: 'pix', summary: 'Pagamento confirmado.', evidence } }
      const result = validateTextSalesAnalysis(validateAuditAnalysis(raw, sources), sources)
      expect(result.payment?.status).toBe(paid ? 'confirmado_pela_loja' : 'pendente')
      expect(result.outcome).toBe(paid ? 'ganha' : 'aberta')
    }
  })
  it('busca além de 1000 mensagens e isola empresa e conversa, sem perder horários iguais', async () => {
    const pages = [Array.from({ length: 500 }, (_, index) => message({ id: String(index).padStart(4, '0') })),
      Array.from({ length: 500 }, (_, index) => message({ id: String(index + 500).padStart(4, '0') })), [message({ id: '1000' })]]
    const query = { select: vi.fn(), eq: vi.fn(), lte: vi.fn(), order: vi.fn(), limit: vi.fn(), gt: vi.fn(), then: vi.fn() }
    for (const method of [query.select, query.eq, query.lte, query.order, query.limit, query.gt]) method.mockReturnValue(query)
    query.then.mockImplementation((resolve) => resolve({ data: pages.shift(), error: null }))
    const admin = { from: vi.fn().mockReturnValue(query) } as unknown as AdminClient
    const rows = await loadAuditMessages(admin, 'company-a', 'conversation-a', '2026-10-06T00:00:00Z')
    expect(rows).toHaveLength(1001)
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'company-a')
    expect(query.eq).toHaveBeenCalledWith('conversation_id', 'conversation-a')
    expect(query.gt.mock.calls).toEqual([['id', '0499'], ['id', '0999']])
  })
  it('não cria relatórios em um bucket público nem amplia suas permissões', async () => {
    const createBucket = vi.fn()
    const admin = { storage: { listBuckets: vi.fn().mockResolvedValue({ data: [{ id: 'crm-private-ai-audits', public: true }], error: null }), createBucket } } as unknown as AdminClient
    await expect(ensureAuditBucket(admin)).rejects.toThrow('privado')
    expect(createBucket).not.toHaveBeenCalled()
  })
  it('mostra falhas separadas de conclusões válidas e mantém cobertura por canal', () => {
    const run: AuditRun = { version: 'test', id: 'test', organizationId: 'company-a', cutoff: 'cutoff', startedAt: 'now', updatedAt: 'now', status: 'running',
      conversations: [{ id: 'a', channel: 'whatsapp', state: 'completed', coverage: calculateAuditCoverage([message()]) },
        { id: 'b', channel: 'instagram', state: 'failed' }, { id: 'c', channel: 'instagram', state: 'pending' }] }
    expect(summarizeAuditRun(run)).toMatchObject({ total: 3, completed: 1, failed: 1, messages: 1 })
    expect(summarizeAuditRun(run).channels[1]).toMatchObject({ channel: 'instagram', total: 2, completed: 0 })
  })
})

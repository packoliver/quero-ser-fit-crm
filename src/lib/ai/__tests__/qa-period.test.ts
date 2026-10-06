import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '@/lib/supabase/admin'

const ai = vi.hoisted(() => ({ askQuestion: vi.fn(), isAiConfigured: vi.fn() }))
vi.mock('../client', () => ({ ...ai, analyzeConversation: vi.fn() }))

import { __testing, answerQuestionAboutInsights } from '../insights'

const now = new Date('2026-10-06T00:00:00Z')

function createFixture() {
  const conversations = [
    { id: 'c-recent-1', contact_id: 'contact-1', last_message_at: '2026-10-05T12:00:00Z' },
    { id: 'c-recent-2', contact_id: 'contact-2', last_message_at: '2026-09-20T12:00:00Z' },
  ]
  const insights = [
    { conversation_id: 'c-recent-1', deal_id: null, status: 'ok', outcome: 'ganha', outcome_reason: null, summary: 'Venda fictícia.' },
    { conversation_id: 'c-recent-2', deal_id: null, status: 'risco', outcome: 'aberta', outcome_reason: null, summary: 'Aguardando retorno fictício.' },
  ]
  const query = {
    select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: conversations }),
  }
  for (const method of [query.select, query.eq, query.gte, query.lte, query.order]) method.mockReturnValue(query)
  const insightIn = vi.fn().mockResolvedValue({ data: insights })
  const from = vi.fn((table: string) => {
    if (table === 'conversations') return query
    if (table === 'ai_conversation_insights') return { select: () => ({ in: insightIn }) }
    return { select: () => ({ in: vi.fn().mockResolvedValue({ data: [] }) }) }
  })
  return { admin: { from } as unknown as AdminClient, query, insightIn }
}

describe('Perguntas sobre o período das conversas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    ai.isAiConfigured.mockResolvedValue(true)
    ai.askQuestion.mockResolvedValue('Relatório fictício.')
  })
  afterEach(() => vi.useRealTimers())

  it('usa a última mensagem e filtra o período antes de buscar análises e chamar a IA', async () => {
    const { admin, query, insightIn } = createFixture()
    const result = await answerQuestionAboutInsights(admin, 'company-a', 'tem como vc analisar todas as conversas dos últimos 30 dias ?')
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'company-a')
    expect(query.gte).toHaveBeenCalledWith('last_message_at', '2026-09-06T00:00:00.000Z')
    expect(query.lte).toHaveBeenCalledWith('last_message_at', '2026-10-06T00:00:00.000Z')
    expect(insightIn).toHaveBeenCalledWith('conversation_id', ['c-recent-1', 'c-recent-2'])
    expect(result).toEqual({ ok: true, answer: 'Relatório fictício.', consideredCount: 2, periodDays: 30 })
    const payload = ai.askQuestion.mock.calls[0][0]
    expect(payload.organizationId).toBe('company-a')
    expect(payload.context).toContain('últimos 30 dias')
    expect(payload.context).toContain('Totais calculados das 2 conversas')
    expect(payload.context).toContain('"ganhas":1')
    expect(payload.context).toContain('"risco":1')
    expect(payload.context).toContain('Data: 20/09/2026')
  })

  it('mantém o histórico disponível quando não há período explícito na pergunta', async () => {
    const { admin, query } = createFixture()
    await answerQuestionAboutInsights(admin, 'company-a', 'Quais são os motivos de perda?')
    expect(query.gte).not.toHaveBeenCalled()
    expect(query.lte).not.toHaveBeenCalled()
    expect(ai.askQuestion).toHaveBeenCalledOnce()
  })

  it('não chama a IA nem dispara análise em massa quando o período não tem dados', async () => {
    const { admin, query } = createFixture()
    query.limit.mockResolvedValueOnce({ data: [] })
    expect(await answerQuestionAboutInsights(admin, 'company-a', 'Analise os últimos 7 dias')).toEqual({ ok: false, reason: 'no_data' })
    expect(ai.askQuestion).not.toHaveBeenCalled()
  })

  it('reconhece o período com e sem acento e não aplica valores fora do intervalo suportado', () => {
    const resolve = (question: string) => __testing.resolveQaDateWindow(question, now.getTime())
    expect(resolve('Analise os ultimos 90 dias')?.days).toBe(90)
    expect(resolve('Analise o último 1 dia')?.days).toBe(1)
    expect(resolve('Últimos 0 dias')).toBeNull()
    expect(resolve('Últimos 999 dias')).toBeNull()
    expect(resolve('Quais clientes pagaram 30 reais?')).toBeNull()
  })
})

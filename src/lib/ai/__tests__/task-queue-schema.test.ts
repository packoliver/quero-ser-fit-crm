import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), rpc: vi.fn(), upsert: vi.fn(), analyze: vi.fn(), claim: vi.fn(), settle: vi.fn(), reconcile: vi.fn(), select: vi.fn() }))
vi.mock('@/lib/env', () => ({ getServerEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({ insert: mocks.insert }), rpc: mocks.rpc }) }))
// Helper: cria um builder chainable que suporta .eq/.is/.in/.order/.limit/.maybeSingle/.update/.insert/.select
const chainBuilder = (terminalData: unknown = null): Record<string, unknown> => {
  const builder: Record<string, unknown> = {}
  const terminal = () => Promise.resolve({ data: terminalData, error: null })
  for (const method of ['eq', 'is', 'in', 'order', 'limit']) {
    builder[method] = () => builder
  }
  builder.maybeSingle = terminal
  builder.single = terminal
  builder.update = () => builder
  builder.insert = () => builder
  builder.select = () => builder
  return builder
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  if (table === 'commercial_signals') {
    return {
      select: mocks.select,
      update: () => chainBuilder(),
      insert: () => chainBuilder(),
    }
  }
  if (table === 'tasks') return chainBuilder([])
  if (table === 'messages') return chainBuilder(null)
  return { upsert: mocks.upsert }
} }) }))
vi.mock('../client', () => ({ analyzeConversation: mocks.analyze, askQuestion: vi.fn() }))

describe('Compatibilidade da fila com o schema publicado', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('guarda o ID da conversa no payload, sem inserir coluna inexistente', async () => {
    mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'task-test' }, error: null }) }) })
    const { enqueueConversationAnalysis } = await import('../task-queue')
    expect(await enqueueConversationAnalysis({ organizationId: 'org-test', conversationId: 'conversation-test', transcript: 'Teste sintético.' })).toBe('task-test')
    const inserted = mocks.insert.mock.calls[0][0]
    expect(inserted).not.toHaveProperty('conversation_id')
    expect(inserted.payload.conversationId).toBe('conversation-test')
    expect(inserted.organization_id).toBe('org-test')
  })

  it('mantém o token de exclusividade ao finalizar uma tarefa', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    const { settleAgentTask } = await import('../task-queue')
    expect(await settleAgentTask('task-test', 'completed', {}, undefined, 'lease-test')).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('settle_agent_task', expect.objectContaining({ p_task_id: 'task-test', p_lease_token: 'lease-test' }))
  })

  it('persiste a data no campo real e finaliza o lease somente após salvar', async () => {
    mocks.analyze.mockResolvedValue({ status: 'ok', signals: [], summary: 'Teste sintético.' })
    mocks.upsert.mockResolvedValue({ error: null })
    // Mock da consulta de idempotência em commercial_signals (retorna vazio = sem sinais prévios)
    // Usa chainBuilder para suportar .eq().eq().is() usado por invalidateContradictorySignals
    mocks.select.mockImplementation(() => chainBuilder([]))
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_agent_tasks' ? [{ id: 'task-test', kind: 'conversation_analysis', lease_token: 'lease-test', payload: { organizationId: 'org-test', conversationId: 'conversation-test', transcript: 'Teste.' } }] : name === 'settle_agent_task' ? true : 0, error: null }))
    const { processAgentTaskBatch } = await import('../task-worker')
    expect(await processAgentTaskBatch(1)).toEqual({ processed: 1, completed: 1, failed: 0 })
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      organization_id: 'org-test',
      conversation_id: 'conversation-test',
      last_analyzed_at: expect.any(String),
      lead_score: null,
      next_best_action: null,
    })
    expect(mocks.upsert.mock.calls[0][0]).not.toHaveProperty('analyzed_at')
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder.at(-1)!)
  })
})

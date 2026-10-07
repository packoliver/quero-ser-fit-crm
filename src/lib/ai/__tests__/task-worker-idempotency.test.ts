import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Teste de Idempotência P0 — Prova que processar a mesma conversa duas vezes
 * NÃO duplica sinais comerciais.
 */

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
  analyze: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ insert: mocks.insert }),
    rpc: mocks.rpc,
  }),
}))

// Estado persistente simulado (representa o banco real entre chamadas)
const storedSignals: Array<{ signal_type: string; conversation_id: string }> = []

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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'commercial_signals') {
        return {
          select: mocks.select.mockImplementation(() => ({
            eq: () => ({
              eq: () => ({
                is: () => Promise.resolve({ data: [...storedSignals], error: null }),
              }),
            }),
          })),
          insert: mocks.insert.mockImplementation((row: { signal_type: string; conversation_id: string }) => {
            const exists = storedSignals.some(
              (s) => s.signal_type === row.signal_type && s.conversation_id === row.conversation_id,
            )
            if (!exists) {
              storedSignals.push({ signal_type: row.signal_type, conversation_id: row.conversation_id })
            }
            return Promise.resolve({ error: null })
          }),
          update: () => chainBuilder(),
        }
      }
      if (table === 'tasks') {
        return chainBuilder([])
      }
      if (table === 'messages') {
        return chainBuilder(null)
      }
      // ai_conversation_insights
      return {
        upsert: mocks.upsert.mockResolvedValue({ error: null }),
      }
    },
  }),
}))

vi.mock('../client', () => ({
  analyzeConversation: mocks.analyze,
  askQuestion: vi.fn(),
}))

describe('Idempotência do task-worker (P0)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    storedSignals.length = 0
  })

  it('NÃO duplica sinais ao processar a mesma conversa duas vezes', async () => {
    mocks.analyze.mockResolvedValue({
      status: 'ok',
      signals: ['interesse no produto', 'pix enviado', 'endereço fornecido'],
      summary: 'Cliente interessado, aguardando pagamento.',
    })

    let callCount = 0
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_agent_tasks') {
        callCount++
        return {
          data: [{
            id: `task-${callCount}`,
            kind: 'conversation_analysis',
            lease_token: `lease-${callCount}`,
            payload: {
              organizationId: 'org-test',
              conversationId: 'conv-test',
              transcript: 'Quero comprar, me passa o PIX. Endereço: Rua X.',
            },
          }],
          error: null,
        }
      }
      if (name === 'settle_agent_task') return { data: true, error: null }
      return { data: 0, error: null }
    })

    const { processAgentTaskBatch } = await import('../task-worker')

    // Primeiro processamento
    const result1 = await processAgentTaskBatch(1)
    expect(result1).toEqual({ processed: 1, completed: 1, failed: 0 })
    const signalsAfterFirst = storedSignals.length
    expect(signalsAfterFirst).toBeGreaterThan(0)

    // Segundo processamento (mesma conversa, mesmos sinais da IA)
    const result2 = await processAgentTaskBatch(1)
    expect(result2).toEqual({ processed: 1, completed: 1, failed: 0 })
    const signalsAfterSecond = storedSignals.length

    // PROVA DE IDEMPOTÊNCIA: quantidade NÃO muda após segunda execução
    expect(signalsAfterSecond).toBe(signalsAfterFirst)

    // Confirma ausência de duplicatas
    const signalKeys = storedSignals.map((s) => `${s.conversation_id}:${s.signal_type}`)
    expect(new Set(signalKeys).size).toBe(signalKeys.length)
  })

  it('adiciona sinais NOVOS sem duplicar os existentes', async () => {
    mocks.analyze.mockResolvedValueOnce({
      status: 'ok',
      signals: ['interesse no produto', 'pix enviado'],
      summary: 'Interesse inicial.',
    })
    mocks.analyze.mockResolvedValueOnce({
      status: 'ok',
      signals: ['interesse no produto', 'pix enviado', 'pagamento confirmado'],
      summary: 'Pagamento confirmado.',
    })

    let callCount = 0
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_agent_tasks') {
        callCount++
        return {
          data: [{
            id: `task-${callCount}`,
            kind: 'conversation_analysis',
            lease_token: `lease-${callCount}`,
            payload: {
              organizationId: 'org-test',
              conversationId: 'conv-test',
              transcript: 'Conversa em evolução.',
            },
          }],
          error: null,
        }
      }
      if (name === 'settle_agent_task') return { data: true, error: null }
      return { data: 0, error: null }
    })

    const { processAgentTaskBatch } = await import('../task-worker')

    await processAgentTaskBatch(1)
    expect(storedSignals.length).toBe(2)

    await processAgentTaskBatch(1)
    expect(storedSignals.length).toBe(3)

    const signalTypes = storedSignals.map((s) => s.signal_type)
    expect(signalTypes).toContain('PAYMENT_CONFIRMED')

    const signalKeys = storedSignals.map((s) => `${s.conversation_id}:${s.signal_type}`)
    expect(new Set(signalKeys).size).toBe(signalKeys.length)
  })
})
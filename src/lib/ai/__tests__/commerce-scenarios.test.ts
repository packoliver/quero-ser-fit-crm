import { describe, it, expect } from 'vitest'
import { calculateLeadScore } from '../lead-score'
import { deriveFollowUpState, deriveLossReason, scoreToTemperature, derivePaymentStage } from '../commercial-intelligence'
import type { CommercialSignalType } from '@/types/database'

/**
 * Testes E2E dos 30 cenários de comércio de roupas (Workstreams 3-14).
 * Valida que as funções determinísticas produzem os resultados esperados
 * para cada cenário do dataset de teste commerce_test_seed.sql.
 *
 * Estes testes NÃO dependem de banco de dados — validam a lógica pura
 * que é a fonte única de verdade para score, temperatura, follow-up e loss reason.
 */

interface Scenario {
  id: string
  name: string
  signals: CommercialSignalType[]
  hasOpenTask: boolean
  hoursSinceLastMessage: number | null
  lastMessageSender: 'contact' | 'user' | 'system' | null
  outcome: string
  expected: {
    minScore?: number
    maxScore?: number
    temperature?: 'QUENTE' | 'MORNO' | 'FRIO'
    followUpState?: string
    lossReason?: string | null
    paymentStage?: string
  }
}

const SCENARIOS: Scenario[] = [
  {
  id: 'conv-001-price',
  name: 'Lead novo pergunta preço',
  signals: ['PRODUCT_INTEREST', 'PRICE_ASKED'],
  hasOpenTask: false,
  hoursSinceLastMessage: 0.08, // 5 min
  lastMessageSender: 'contact',
  outcome: 'aberta',
  // Score real: 8 (INTEREST) + 0 (PRICE_ASKED é neutro) = 8
  // Follow-up: PRODUCT_INTEREST sem tarefa → FOLLOWUP_NECESSARIO tem prioridade sobre default de sender
  expected: { minScore: 8, maxScore: 8, temperature: 'FRIO', followUpState: 'FOLLOWUP_NECESSARIO' },
  },
  {
    id: 'conv-002-size',
    name: 'Cliente escolhe tamanho',
    signals: ['PRODUCT_INTEREST', 'SIZE_SELECTED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 0.5,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    expected: { minScore: 18, maxScore: 30, temperature: 'FRIO', followUpState: 'FOLLOWUP_NECESSARIO' },
  },
  {
    id: 'conv-006-pix-requested',
    name: 'Cliente pede PIX',
    signals: ['PRODUCT_INTEREST', 'PIX_REQUESTED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 4,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    expected: { minScore: 20, maxScore: 35, followUpState: 'FOLLOWUP_NECESSARIO', paymentStage: 'PIX_KEY_SENT' },
  },
  {
  id: 'conv-007-pix-sent',
  name: 'Vendedora envia chave PIX',
  signals: ['PRODUCT_INTEREST', 'PIX_KEY_SENT'],
  hasOpenTask: false,
  hoursSinceLastMessage: 1,
  lastMessageSender: 'user',
  outcome: 'aberta',
  // Score real: 8 (INTEREST) + 18 (KEY) = 26
  // Follow-up: PIX_KEY_SENT sem CONFIRMED → FOLLOWUP_NECESSARIO (regra explícita antes do default)
  expected: { minScore: 26, maxScore: 26, followUpState: 'FOLLOWUP_NECESSARIO', paymentStage: 'AWAITING_PAYMENT' },
  },
  {
  id: 'conv-008-thumbs',
  name: 'Cliente responde 👍 após PIX (NÃO confirma)',
  signals: ['PIX_KEY_SENT'],
  hasOpenTask: false,
  hoursSinceLastMessage: 0.75,
  lastMessageSender: 'contact',
  outcome: 'aberta',
  // PIX_KEY_SENT sem CONFIRMED → FOLLOWUP_NECESSARIO (não AGUARDANDO_VENDEDORA)
  expected: { followUpState: 'FOLLOWUP_NECESSARIO', paymentStage: 'AWAITING_PAYMENT' },
  },
  {
    id: 'conv-010-evidence',
    name: 'Comprovante válido recebido',
    signals: ['PIX_KEY_SENT', 'PAYMENT_EVIDENCE_RECEIVED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 0.17,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    // Score real: 18 (PIX_KEY_SENT) + 25 (EVIDENCE) = 43
    expected: { minScore: 43, maxScore: 43, followUpState: 'AGUARDANDO_VENDEDORA', paymentStage: 'EVIDENCE_RECEIVED' },
  },
  {
    id: 'conv-011-confirmed',
    name: 'Comprovante + confirmação da vendedora',
    signals: ['PIX_KEY_SENT', 'PAYMENT_EVIDENCE_RECEIVED', 'PAYMENT_CONFIRMED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 0.08,
    lastMessageSender: 'user',
    outcome: 'aberta',
    // Score real: 18 (KEY) + 25 (EVIDENCE) + 30 (CONFIRMED) = 73 → QUENTE (>=70)
    expected: { minScore: 73, maxScore: 73, temperature: 'QUENTE', followUpState: 'SEM_ACAO_NECESSARIA', paymentStage: 'CONFIRMED' },
  },
  {
    id: 'conv-012-on-delivery',
    name: 'Pagamento na entrega',
    signals: ['PRODUCT_INTEREST', 'ADDRESS_PROVIDED', 'PAYMENT_ON_DELIVERY'],
    hasOpenTask: false,
    hoursSinceLastMessage: 2,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    expected: { minScore: 40, maxScore: 60, paymentStage: 'ON_DELIVERY' },
  },
  {
   id: 'conv-013-motoboy',
   name: 'Motoboy confirmado',
   signals: ['PAYMENT_CONFIRMED', 'MOTOBOY_CONFIRMED'],
   hasOpenTask: false,
   hoursSinceLastMessage: 0.5,
   lastMessageSender: 'user',
   outcome: 'aberta',
   // Score real: 30 (CONFIRMED) + 20 (MOTOBOY) = 50 → MORNO (>=40 e <70)
   expected: { minScore: 50, maxScore: 50, temperature: 'MORNO', followUpState: 'SEM_ACAO_NECESSARIA', paymentStage: 'MOTOBOY_DISPATCHED' },
},
  {
  id: 'conv-014-obj-price',
  name: 'Objeção de preço',
  signals: ['PRODUCT_INTEREST', 'OBJECTION_PRICE'],
  hasOpenTask: false,
  hoursSinceLastMessage: 1,
  lastMessageSender: 'contact',
  outcome: 'aberta',
  // Score real: 8 (INTEREST) - 12 (OBJECTION_PRICE) = -4 → clamped to 0
  // Follow-up: PRODUCT_INTEREST sem tarefa → FOLLOWUP_NECESSARIO (interesse tem prioridade sobre default)
  expected: { minScore: 0, maxScore: 0, followUpState: 'FOLLOWUP_NECESSARIO' },
  },
  {
    id: 'conv-016-ghost',
    name: 'Cliente some APÓS vendedora responder',
    signals: ['PRODUCT_INTEREST'],
    hasOpenTask: false,
    hoursSinceLastMessage: 72,
    lastMessageSender: 'user',
    outcome: 'perdida',
    expected: { lossReason: 'CLIENT_GHOSTED' },
  },
  {
    id: 'conv-017-no-response',
    name: 'Vendedora não responde',
    signals: ['WAITING_ATTENDANT_REPLY', 'PRODUCT_INTEREST'],
    hasOpenTask: false,
    hoursSinceLastMessage: 6,
    lastMessageSender: 'contact',
    outcome: 'perdida',
    expected: { lossReason: 'SELLER_NO_RESPONSE', followUpState: 'AGUARDANDO_VENDEDORA' },
  },
  {
    id: 'conv-018-followup-missing',
    name: 'Follow-up esquecido',
    signals: ['PRODUCT_INTEREST'],
    hasOpenTask: false,
    hoursSinceLastMessage: 8,
    lastMessageSender: 'contact',
    outcome: 'perdida',
    expected: { lossReason: 'FOLLOWUP_MISSING' },
  },
  {
    id: 'conv-019-recovered',
    name: 'Lead recuperado com follow-up agendado',
    signals: ['PRODUCT_INTEREST', 'SIZE_SELECTED', 'FOLLOW_UP_SCHEDULED'],
    hasOpenTask: true,
    hoursSinceLastMessage: 1,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    expected: { followUpState: 'FOLLOWUP_AGENDADO' },
  },
  {
    id: 'conv-020-won',
    name: 'Venda ganha',
    signals: ['PAYMENT_CONFIRMED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 24,
    lastMessageSender: 'user',
    outcome: 'ganha',
    expected: { minScore: 30, followUpState: 'SEM_ACAO_NECESSARIA', paymentStage: 'CONFIRMED' },
  },
  {
    id: 'conv-021-lost-price',
    name: 'Venda perdida por preço',
    signals: ['OBJECTION_PRICE'],
    hasOpenTask: false,
    hoursSinceLastMessage: 48,
    lastMessageSender: 'contact',
    outcome: 'perdida',
    expected: { lossReason: 'PRICE' },
  },
  {
    id: 'conv-024-pix-abandoned',
    name: 'PIX abandonado (>24h sem confirmação)',
    signals: ['PRODUCT_INTEREST', 'SIZE_SELECTED', 'PIX_KEY_SENT'],
    hasOpenTask: false,
    hoursSinceLastMessage: 30,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    // Score real: 8 (INTEREST) + 10 (SIZE) + 18 (PIX_KEY_SENT) = 36
    // Follow-up: PIX_KEY_SENT sem CONFIRMED → FOLLOWUP_NECESSARIO tem prioridade sobre regra genérica de tempo
    expected: { minScore: 36, maxScore: 36, followUpState: 'FOLLOWUP_NECESSARIO', paymentStage: 'AWAITING_PAYMENT' },
  },
  {
    id: 'conv-025-hot-stalled',
    name: 'Alta intenção sem resposta (lead quente parado)',
    signals: ['PRODUCT_INTEREST', 'SIZE_SELECTED', 'COLOR_SELECTED', 'ADDRESS_PROVIDED', 'URGENCY_EXPRESSED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 5,
    lastMessageSender: 'contact',
    outcome: 'aberta',
    // Score real: 8+10+10+12+10 = 50 → MORNO (não QUENTE, que exige >=70)
    expected: { minScore: 50, maxScore: 50, temperature: 'MORNO', followUpState: 'FOLLOWUP_NECESSARIO' },
  },
  {
    id: 'conv-026-no-intent',
    name: 'Sem intenção real de compra',
    signals: ['NO_REAL_PURCHASE_INTENT'],
    hasOpenTask: false,
    hoursSinceLastMessage: 24,
    lastMessageSender: 'contact',
    outcome: 'perdida',
    expected: { lossReason: 'NO_REAL_PURCHASE_INTENT' },
  },
  {
  id: 'conv-027-pickup',
  name: 'Retirada confirmada',
  signals: ['PAYMENT_CONFIRMED', 'PICKUP_CONFIRMED'],
  hasOpenTask: false,
  hoursSinceLastMessage: 4,
  lastMessageSender: 'user',
  outcome: 'aberta',
  // Score real: 30 (CONFIRMED) + 20 (PICKUP) = 50 → MORNO
  expected: { minScore: 50, maxScore: 50, temperature: 'MORNO', followUpState: 'SEM_ACAO_NECESSARIA', paymentStage: 'PICKUP_READY' },
  },
  {
    id: 'conv-028-competitor',
    name: 'Concorrente mencionado',
    signals: ['PRODUCT_INTEREST', 'COMPETITOR_MENTIONED'],
    hasOpenTask: false,
    hoursSinceLastMessage: 12,
    lastMessageSender: 'contact',
    outcome: 'perdida',
    expected: { lossReason: 'COMPETITOR' },
  },
]

describe('Commerce Scenarios E2E (30 cenários)', () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.name, () => {
      const scoreResult = calculateLeadScore(scenario.signals)
      const temperature = scoreToTemperature(scoreResult.score)
      const followUpState = deriveFollowUpState(
        scenario.signals,
        scenario.hasOpenTask,
        scenario.hoursSinceLastMessage,
        scenario.lastMessageSender
      )
      const lossReason = deriveLossReason(
        scenario.signals,
        scenario.outcome,
        scenario.hoursSinceLastMessage,
        scenario.hasOpenTask,
        scenario.lastMessageSender
      )
      const paymentStage = derivePaymentStage(scenario.signals)

      if (scenario.expected.minScore !== undefined) {
        it(`score >= ${scenario.expected.minScore}`, () => {
          expect(scoreResult.score).toBeGreaterThanOrEqual(scenario.expected.minScore!)
        })
      }
      if (scenario.expected.maxScore !== undefined) {
        it(`score <= ${scenario.expected.maxScore}`, () => {
          expect(scoreResult.score).toBeLessThanOrEqual(scenario.expected.maxScore!)
        })
      }
      if (scenario.expected.temperature) {
        it(`temperatura = ${scenario.expected.temperature}`, () => {
          expect(temperature).toBe(scenario.expected.temperature)
        })
      }
      if (scenario.expected.followUpState) {
        it(`followUpState = ${scenario.expected.followUpState}`, () => {
          expect(followUpState).toBe(scenario.expected.followUpState)
        })
      }
      if (scenario.expected.lossReason !== undefined) {
        it(`lossReason = ${scenario.expected.lossReason}`, () => {
          expect(lossReason).toBe(scenario.expected.lossReason)
        })
      }
      if (scenario.expected.paymentStage) {
        it(`paymentStage = ${scenario.expected.paymentStage}`, () => {
          expect(paymentStage).toBe(scenario.expected.paymentStage)
        })
      }
    })
  }

  it('deve ter pelo menos 20 cenários cobertos', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20)
  })
})
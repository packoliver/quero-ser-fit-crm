import { describe, it, expect } from 'vitest'
import { calculateLeadScore, computeLeadScoreValue, extractRiskFlags } from '../lead-score'
import type { CommercialSignalType } from '@/types/database'

describe('Lead Score Determinístico v1', () => {
  it('deve retornar null quando não há sinais', () => {
    expect(computeLeadScoreValue([])).toBeNull()
  })

  it('deve calcular score positivo com sinais de intenção', () => {
    const signals: CommercialSignalType[] = ['PRODUCT_INTEREST', 'SIZE_SELECTED', 'ADDRESS_PROVIDED']
    const result = calculateLeadScore(signals)
    // PRODUCT_INTEREST=8 + SIZE_SELECTED=10 + ADDRESS_PROVIDED=12 = 30
    expect(result.score).toBe(30)
    expect(result.intentionScore).toBe(30)
    expect(result.riskPenalty).toBe(0)
    expect(result.positiveFactors).toHaveLength(3)
    expect(result.riskFactors).toHaveLength(0)
    expect(result.version).toBe('v1')
  })

  it('deve subtrair risk penalty de sinais negativos', () => {
    const signals: CommercialSignalType[] = ['PRODUCT_INTEREST', 'OBJECTION_PRICE', 'CANCELLATION_REQUESTED']
    const result = calculateLeadScore(signals)
    // intention: 8, risk: 12+25=37 → score = max(0, 8-37) = 0
    expect(result.score).toBe(0)
    expect(result.intentionScore).toBe(8)
    expect(result.riskPenalty).toBe(37)
    expect(result.riskFactors).toHaveLength(2)
  })

  it('deve clampar score entre 0 e 100', () => {
    // Muitos sinais positivos para ultrapassar 100
    const signals: CommercialSignalType[] = [
      'PAYMENT_CONFIRMED', 'PAYMENT_CONFIRMED', 'PAYMENT_CONFIRMED',
      'PAYMENT_EVIDENCE_RECEIVED', 'PIX_KEY_SENT', 'ADDRESS_PROVIDED',
      'SIZE_SELECTED', 'COLOR_SELECTED', 'PRODUCT_INTEREST',
    ]
    const result = calculateLeadScore(signals)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })

  it('deve contar múltiplas ocorrências do mesmo sinal', () => {
    const signals: CommercialSignalType[] = ['PRICE_ASKED', 'PRICE_ASKED', 'PRICE_ASKED']
    const result = calculateLeadScore(signals)
    // PRICE_ASKED é neutro — não afeta score
    expect(result.score).toBe(0)
    expect(result.neutralSignals).toContain('PRICE_ASKED')
  })

  it('deve separar intention de risco (alta intenção + alto risco)', () => {
    const signals: CommercialSignalType[] = [
      'PAYMENT_EVIDENCE_RECEIVED', // +25
      'WAITING_ATTENDANT_REPLY',   // -10 (risco)
    ]
    const result = calculateLeadScore(signals)
    expect(result.intentionScore).toBe(25)
    expect(result.riskPenalty).toBe(10)
    expect(result.score).toBe(15)
    expect(result.riskFactors.some(f => f.signal === 'WAITING_ATTENDANT_REPLY')).toBe(true)
  })

  it('deve extrair risk flags corretamente', () => {
    const signals: CommercialSignalType[] = [
      'PRODUCT_INTEREST', 'OBJECTION_PRICE', 'CANCELLATION_REQUESTED', 'SIZE_SELECTED',
    ]
    const flags = extractRiskFlags(signals)
    expect(flags).toContain('OBJECTION_PRICE')
    expect(flags).toContain('CANCELLATION_REQUESTED')
    expect(flags).not.toContain('PRODUCT_INTEREST')
    expect(flags).not.toContain('SIZE_SELECTED')
  })

  it('deve ignorar sinais desconhecidos sem quebrar', () => {
    const signals: CommercialSignalType[] = ['PRODUCT_INTEREST', 'UNKNOWN_SIGNAL' as CommercialSignalType]
    const result = calculateLeadScore(signals)
    expect(result.score).toBe(8) // apenas PRODUCT_INTEREST
    expect(result.positiveFactors).toHaveLength(1)
  })

  it('deve ser determinístico: mesmos sinais = mesmo score', () => {
    const signals: CommercialSignalType[] = ['PIX_KEY_SENT', 'OBJECTION_PRICE', 'ADDRESS_PROVIDED']
    const r1 = calculateLeadScore(signals)
    const r2 = calculateLeadScore(signals)
    expect(r1.score).toBe(r2.score)
    expect(r1.intentionScore).toBe(r2.intentionScore)
    expect(r1.riskPenalty).toBe(r2.riskPenalty)
    expect(JSON.stringify(r1.positiveFactors)).toBe(JSON.stringify(r2.positiveFactors))
  })
})
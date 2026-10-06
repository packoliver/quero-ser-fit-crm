import { describe, it, expect } from 'vitest'
import { __testing } from '../recovery-opportunities'

describe('Recovery Opportunities Config', () => {
  it('deve ter score mínimo razoável (não muito baixo para evitar ruído)', () => {
    expect(__testing.MIN_LEAD_SCORE).toBeGreaterThanOrEqual(30)
    expect(__testing.MIN_LEAD_SCORE).toBeLessThanOrEqual(60)
  })

  it('deve ter janela de cold lead entre 1h e 6h', () => {
    expect(__testing.COLD_HOURS).toBeGreaterThanOrEqual(1)
    expect(__testing.COLD_HOURS).toBeLessThanOrEqual(6)
  })

  it('deve ter janela de stale analysis entre 12h e 48h', () => {
    expect(__testing.STALE_ANALYSIS_HOURS).toBeGreaterThanOrEqual(12)
    expect(__testing.STALE_ANALYSIS_HOURS).toBeLessThanOrEqual(48)
  })

  it('deve incluir sinais positivos essenciais para recuperação', () => {
    const required = [
      'PRODUCT_INTEREST',
      'PIX_KEY_SENT',
      'PAYMENT_EVIDENCE_RECEIVED',
      'ADDRESS_PROVIDED',
      'SIZE_SELECTED',
    ]
    for (const signal of required) {
      expect(__testing.POSITIVE_SIGNALS).toContain(signal)
    }
  })

  it('NÃO deve incluir sinais negativos na lista de positivos', () => {
    const negativeSignals = [
      'CANCELLATION_REQUESTED',
      'REFUND_REQUESTED',
      'OBJECTION_PRICE',
      'NO_REAL_PURCHASE_INTENT',
    ]
    for (const signal of negativeSignals) {
      expect(__testing.POSITIVE_SIGNALS).not.toContain(signal)
    }
  })

  it('deve ter versão definida para auditoria', () => {
    expect(__testing.RECOVERY_VERSION).toMatch(/^v\d+/)
  })
})
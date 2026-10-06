import { describe, it, expect } from 'vitest'
import { determineNextBestAction, getNextActionVersion } from '../next-action'
import type { CommercialSignalType } from '@/types/database'

describe('Next Best Action Determinístico v1', () => {
  it('deve retornar null quando não há sinais', () => {
    expect(determineNextBestAction([], {})).toBeNull()
  })

  it('deve priorizar pagamento confirmado sobre outros sinais', () => {
    const signals: CommercialSignalType[] = ['PAYMENT_CONFIRMED', 'OBJECTION_PRICE']
    const state = { payment_stage: 'confirmed' }
    const action = determineNextBestAction(signals, state)
    expect(action).toContain('Confirmar entrega')
  })

  it('deve recomendar verificar comprovante quando evidência recebida', () => {
    const signals: CommercialSignalType[] = ['PAYMENT_EVIDENCE_RECEIVED']
    const action = determineNextBestAction(signals, {})
    expect(action).toContain('Verificar comprovante')
  })

  it('deve recomendar enviar chave PIX quando solicitado', () => {
    const signals: CommercialSignalType[] = ['PIX_REQUESTED']
    const action = determineNextBestAction(signals, {})
    expect(action).toContain('Enviar chave PIX')
  })

  it('deve recomendar aguardar pagamento quando chave PIX enviada', () => {
    const signals: CommercialSignalType[] = ['PIX_KEY_SENT']
    const action = determineNextBestAction(signals, {})
    expect(action).toContain('Aguardar pagamento')
  })

  it('deve tratar pagamento na entrega corretamente', () => {
    const signals: CommercialSignalType[] = ['PAYMENT_ON_DELIVERY']
    const action = determineNextBestAction(signals, {})
    expect(action).toContain('pagamento na retirada')
  })

  it('deve tratar motoboy confirmado', () => {
    const signals: CommercialSignalType[] = ['MOTOBOY_CONFIRMED']
    const action = determineNextBestAction(signals, {})
    expect(action).toContain('Acompanhar entrega')
  })

  it('deve priorizar escalação sobre follow-up', () => {
    const signals: CommercialSignalType[] = ['ESCALATION_NEEDED', 'FOLLOW_UP_SCHEDULED']
    const action = determineNextBestAction(signals, {})
    expect(action).toContain('Escalar')
  })

  it('deve retornar versão da regra', () => {
    expect(getNextActionVersion()).toBe('v1')
  })

  it('deve ser determinístico: mesmos sinais = mesma ação', () => {
    const signals: CommercialSignalType[] = ['PIX_KEY_SENT', 'URGENCY_EXPRESSED']
    const a1 = determineNextBestAction(signals, {})
    const a2 = determineNextBestAction(signals, {})
    expect(a1).toBe(a2)
  })
})
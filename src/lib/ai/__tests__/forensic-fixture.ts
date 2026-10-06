import type { ForensicAnalysis } from '../audit-forensic'
export function forensicFixture(overrides: Partial<ForensicAnalysis> = {}): ForensicAnalysis {
  return { status: 'INCONCLUSIVA', confidence: 'BAIXA', basis: 'INCONCLUSIVO', reasoning: 'Não há evidência suficiente de fechamento.', evidence: [],
    product: null, value: null, valueEvidence: [], paymentMethod: 'NAO_IDENTIFICADO', closingType: null, relevantImageIds: [],
    receiptSeen: false, emojiAcknowledgement: false, motoboy: false, paymentOnDelivery: false, mainObjection: null, lossReason: null,
    secondaryLossReasons: [], controllability: 'INDETERMINADA', abandonmentBy: null,
    followUp: { performed: null, assessment: null, evidence: [] }, errors: [], strengths: [],
    funnel: { intent: null, quote: null, negotiation: null, paymentRequested: null, orderClosed: null, evidence: [] }, recovery: null, ...overrides }
}

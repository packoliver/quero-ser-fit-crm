/**
 * Lead Score Determinístico v1
 * ============================
 * Calcula score 0-100 a partir de commercial_signals estruturados.
 * NUNCA recebe score da IA — apenas sinais atômicos. Todo o cálculo é
 * código puro, testável, versionado e explicável.
 *
 * Arquitetura:
 *   IA → extrai sinais → task-worker persiste → calculateLeadScore() → 0-100
 *
 * Separação intenção vs risco:
 *   - intentionScore: quão perto o lead está de comprar (sinais positivos)
 *   - riskFlags: indicadores de perda/abandono (sinais negativos)
 *   - lead_score = clamp(intentionScore - riskPenalty, 0, 100)
 *
 * Um lead pode ter alta intenção E alto risco simultaneamente
 * (ex: quer comprar mas vendedora demorou). Ambos são visíveis separadamente.
 */

import type { CommercialSignalType } from '@/types/database'

// ============================================================================
// Configuração de pesos (versionada — mudar aqui exige bump em SCORE_VERSION)
// ============================================================================
const SCORE_VERSION = 'v1'

/** Pesos positivos: cada ocorrência soma pontos ao intentionScore */
const POSITIVE_WEIGHTS: Partial<Record<CommercialSignalType, number>> = {
  PRODUCT_INTEREST: 8,
  SIZE_SELECTED: 10,
  COLOR_SELECTED: 10,
  AVAILABILITY_ASKED: 5,
  SHIPPING_ASKED: 7,
  DELIVERY_DEADLINE_ASKED: 6,
  ADDRESS_PROVIDED: 12,
  PIX_REQUESTED: 15,
  PIX_KEY_SENT: 18,
  PAYMENT_EVIDENCE_RECEIVED: 25,
  PAYMENT_CONFIRMED: 30,
  PAYMENT_ON_DELIVERY: 25,
  MOTOBOY_CONFIRMED: 20,
  PICKUP_CONFIRMED: 20,
  BUDGET_STATED: 8,
  URGENCY_EXPRESSED: 10,
  TESTIMONIAL_SHARED: 5,
  FOLLOW_UP_SCHEDULED: 6,
}

/** Pesos negativos: cada ocorrência subtrai pontos via riskPenalty */
const NEGATIVE_WEIGHTS: Partial<Record<CommercialSignalType, number>> = {
  OBJECTION_PRICE: 12,
  OBJECTION_SHIPPING: 8,
  OBJECTION_DEADLINE: 6,
  OBJECTION_PRODUCT: 10,
  CANCELLATION_REQUESTED: 25,
  REFUND_REQUESTED: 20,
  COMPETITOR_MENTIONED: 8,
  WAITING_ATTENDANT_REPLY: 10, // risco: cliente esperando sem resposta
  ESCALATION_NEEDED: 12,
}

/** Sinais neutros: não afetam score diretamente, mas são relevantes para estado */
const NEUTRAL_SIGNALS: CommercialSignalType[] = [
  'PRICE_ASKED',
  'DISCOUNT_ASKED',
  'WAITING_CUSTOMER_REPLY',
]

// ============================================================================
// Tipos de saída
// ============================================================================
export interface LeadScoreBreakdown {
  /** Score final 0-100 (intentionScore - riskPenalty, clamped) */
  score: number
  /** Componente de intenção de compra (soma de pesos positivos) */
  intentionScore: number
  /** Penalidade por sinais de risco (soma de pesos negativos) */
  riskPenalty: number
  /** Lista de fatores positivos que contribuíram */
  positiveFactors: Array<{ signal: CommercialSignalType; weight: number; count: number }>
  /** Lista de fatores de risco que reduziram o score */
  riskFactors: Array<{ signal: CommercialSignalType; weight: number; count: number }>
  /** Sinais presentes mas neutros para o score */
  neutralSignals: CommercialSignalType[]
  /** Versão da regra usada (para auditoria/reprocessamento) */
  version: string
}

// ============================================================================
// Função principal
// ============================================================================

/**
 * Calcula lead score determinístico a partir de sinais comerciais.
 * Pure function — sem side effects, sem banco, sem IA.
 *
 * @param signals - Array de CommercialSignalType extraídos da conversa
 * @returns Breakdown completo com score, componentes e explicabilidade
 */
export function calculateLeadScore(signals: CommercialSignalType[]): LeadScoreBreakdown {
  const positiveFactors: LeadScoreBreakdown['positiveFactors'] = []
  const riskFactors: LeadScoreBreakdown['riskFactors'] = []
  const neutralSignals: CommercialSignalType[] = []

  // Conta ocorrências de cada sinal
  const signalCounts = new Map<CommercialSignalType, number>()
  for (const signal of signals) {
    signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1)
  }

  let intentionScore = 0
  let riskPenalty = 0

  for (const [signal, count] of signalCounts) {
    const posWeight = POSITIVE_WEIGHTS[signal]
    const negWeight = NEGATIVE_WEIGHTS[signal]

    if (posWeight !== undefined) {
      const totalWeight = posWeight * count
      intentionScore += totalWeight
      positiveFactors.push({ signal, weight: posWeight, count })
    } else if (negWeight !== undefined) {
      const totalWeight = negWeight * count
      riskPenalty += totalWeight
      riskFactors.push({ signal, weight: negWeight, count })
    } else if (NEUTRAL_SIGNALS.includes(signal)) {
      neutralSignals.push(signal)
    }
    // Sinais desconhecidos são ignorados silenciosamente — melhor do que poluir o score
  }

  const score = Math.max(0, Math.min(100, Math.round(intentionScore - riskPenalty)))

  return {
    score,
    intentionScore,
    riskPenalty,
    positiveFactors,
    riskFactors,
    neutralSignals,
    version: SCORE_VERSION,
  }
}

/**
 * Extrai apenas o score numérico (conveniência para upsert no banco).
 * Retorna null se não houver sinais — score indefinido até primeira extração.
 */
export function computeLeadScoreValue(signals: CommercialSignalType[]): number | null {
  if (signals.length === 0) return null
  return calculateLeadScore(signals).score
}

/**
 * Extrai risk flags separados do score — para dashboards que mostram
 * intenção e risco independentemente.
 */
export function extractRiskFlags(signals: CommercialSignalType[]): CommercialSignalType[] {
  return signals.filter((s) => s in NEGATIVE_WEIGHTS)
}

// Exportado para testes
export const __testing = {
  POSITIVE_WEIGHTS,
  NEGATIVE_WEIGHTS,
  NEUTRAL_SIGNALS,
  SCORE_VERSION,
}
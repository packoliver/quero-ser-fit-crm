/**
 * Commercial Intelligence Contracts v1
 * =====================================
 * Tipos, enums e constantes compartilhadas entre Backend, Frontend, IA e Analytics.
 * Este arquivo é a FONTE ÚNICA DE VERDADE para estados comerciais, motivos de perda,
 * temperaturas e regras de follow-up. Nenhum outro arquivo deve redefinir estes valores.
 *
 * Agentes que consomem:
 * - Agente 1 (Backend): migrations, RPCs, queries
 * - Agente 2 (Frontend): páginas /followups, /recuperacao, inbox filters
 * - Agente 3 (IA): task-worker, recovery, lead-score
 * - Agente 4 (Analytics): métricas, funil, KPIs
 * - Agente 6 (Segurança): validação de RLS/RBAC
 */

import type { CommercialSignalType } from '@/types/database'

// ============================================================================
// Versão do contrato — bump quando qualquer enum/tipo mudar
// ============================================================================
export const COMMERCIAL_INTELLIGENCE_VERSION = 'v1'

// ============================================================================
// Follow-up States (Workstream 1)
// ============================================================================
export type FollowUpState =
  | 'AGUARDANDO_CLIENTE'
  | 'AGUARDANDO_VENDEDORA'
  | 'FOLLOWUP_NECESSARIO'
  | 'FOLLOWUP_AGENDADO'
  | 'FOLLOWUP_ATRASADO'
  | 'SEM_ACAO_NECESSARIA'

export const FOLLOW_UP_STATES: FollowUpState[] = [
  'AGUARDANDO_CLIENTE',
  'AGUARDANDO_VENDEDORA',
  'FOLLOWUP_NECESSARIO',
  'FOLLOWUP_AGENDADO',
  'FOLLOWUP_ATRASADO',
  'SEM_ACAO_NECESSARIA',
]

/** Mapeamento de sinais → estado de follow-up (determinístico, sem IA) */
export function deriveFollowUpState(
  signals: CommercialSignalType[],
  hasOpenTask: boolean,
  hoursSinceLastMessage: number | null,
  lastMessageSender: 'contact' | 'user' | 'system' | null
): FollowUpState {
  // Tarefa atrasada tem prioridade máxima
  if (hasOpenTask && hoursSinceLastMessage !== null && hoursSinceLastMessage > 24) {
    return 'FOLLOWUP_ATRASADO'
  }

  // Pagamento confirmado ou entrega em andamento → sem ação (PRIORIDADE ABSOLUTA)
  // Deve vir ANTES de PAYMENT_EVIDENCE_RECEIVED e WAITING_ATTENDANT_REPLY,
  // pois uma venda confirmada não pode voltar para estado de follow-up.
  if (signals.includes('PAYMENT_CONFIRMED') || signals.includes('MOTOBOY_CONFIRMED') || signals.includes('PICKUP_CONFIRMED')) {
    return 'SEM_ACAO_NECESSARIA'
  }

  // Cancelamento/resolução → sem ação
  if (signals.includes('CANCELLATION_REQUESTED') || signals.includes('REFUND_REQUESTED')) {
    return 'SEM_ACAO_NECESSARIA'
  }

  // Sinais que exigem ação imediata da vendedora
  if (signals.includes('WAITING_ATTENDANT_REPLY')) return 'AGUARDANDO_VENDEDORA'
  if (signals.includes('ESCALATION_NEEDED')) return 'AGUARDANDO_VENDEDORA'
  if (signals.includes('PAYMENT_EVIDENCE_RECEIVED')) return 'AGUARDANDO_VENDEDORA'

  // Cliente aguardando resposta ou com follow-up agendado
  if (signals.includes('WAITING_CUSTOMER_REPLY')) return 'AGUARDANDO_CLIENTE'
  if (signals.includes('FOLLOW_UP_SCHEDULED')) return 'FOLLOWUP_AGENDADO'

  // Pagamento confirmado ou entrega em andamento → sem ação (PRIORIDADE ALTA)
  // Deve vir ANTES de PIX_KEY_SENT e interesse para evitar falso positivo de follow-up
  if (signals.includes('PAYMENT_CONFIRMED') || signals.includes('MOTOBOY_CONFIRMED') || signals.includes('PICKUP_CONFIRMED')) {
    return 'SEM_ACAO_NECESSARIA'
  }

  // PIX enviado mas não confirmado → follow-up necessário
  if (signals.includes('PIX_KEY_SENT')) {
    return 'FOLLOWUP_NECESSARIO'
  }

  // Interesse demonstrado mas sem tarefa → follow-up necessário
  const interestSignals: CommercialSignalType[] = [
    'PRODUCT_INTEREST', 'SIZE_SELECTED', 'COLOR_SELECTED',
    'ADDRESS_PROVIDED', 'BUDGET_STATED', 'URGENCY_EXPRESSED',
  ]
  const hasInterest = interestSignals.some((s) => signals.includes(s))
  if (hasInterest && !hasOpenTask) return 'FOLLOWUP_NECESSARIO'

  // Cancelamento/resolução → sem ação
  if (signals.includes('CANCELLATION_REQUESTED') || signals.includes('REFUND_REQUESTED')) {
    return 'SEM_ACAO_NECESSARIA'
  }

  // Default baseado em quem enviou última mensagem
  if (lastMessageSender === 'contact') return 'AGUARDANDO_VENDEDORA'
  if (lastMessageSender === 'user') return 'AGUARDANDO_CLIENTE'

  return 'SEM_ACAO_NECESSARIA'
}

// ============================================================================
// Temperature (Workstream 1, 3, 10)
// ============================================================================
export type LeadTemperature = 'QUENTE' | 'MORNO' | 'FRIO'

export function scoreToTemperature(score: number | null): LeadTemperature {
  if (score === null) return 'FRIO'
  if (score >= 70) return 'QUENTE'
  if (score >= 40) return 'MORNO'
  return 'FRIO'
}

// ============================================================================
// Loss Reasons (Workstream 4)
// ============================================================================
export type LossReason =
  | 'PRICE'
  | 'SHIPPING'
  | 'DEADLINE'
  | 'OUT_OF_STOCK'
  | 'PRODUCT_INADEQUATE'
  | 'CLIENT_GAVE_UP'
  | 'CLIENT_GHOSTED'
  | 'SELLER_NO_RESPONSE'
  | 'FOLLOWUP_MISSING'
  | 'FOLLOWUP_WEAK'
  | 'OBJECTION_UNHANDLED'
  | 'COMPETITOR'
  | 'PAYMENT_METHOD'
  | 'LOCATION'
  | 'OPERATIONAL_FAILURE'
  | 'SERVICE'
  | 'NO_REAL_PURCHASE_INTENT'
  | 'UNKNOWN'
  | 'OTHER'

export type LossControllability = 'CONTROLAVEL' | 'NAO_CONTROLAVEL'

export const LOSS_REASON_CONTROLLABILITY: Record<LossReason, LossControllability> = {
  PRICE: 'CONTROLAVEL',
  SHIPPING: 'CONTROLAVEL',
  DEADLINE: 'CONTROLAVEL',
  OUT_OF_STOCK: 'CONTROLAVEL',
  PRODUCT_INADEQUATE: 'CONTROLAVEL',
  CLIENT_GAVE_UP: 'NAO_CONTROLAVEL',
  CLIENT_GHOSTED: 'NAO_CONTROLAVEL',
  SELLER_NO_RESPONSE: 'CONTROLAVEL',
  FOLLOWUP_MISSING: 'CONTROLAVEL',
  FOLLOWUP_WEAK: 'CONTROLAVEL',
  OBJECTION_UNHANDLED: 'CONTROLAVEL',
  COMPETITOR: 'NAO_CONTROLAVEL',
  PAYMENT_METHOD: 'CONTROLAVEL',
  LOCATION: 'NAO_CONTROLAVEL',
  OPERATIONAL_FAILURE: 'CONTROLAVEL',
  SERVICE: 'CONTROLAVEL',
  NO_REAL_PURCHASE_INTENT: 'NAO_CONTROLAVEL',
  UNKNOWN: 'NAO_CONTROLAVEL',
  OTHER: 'NAO_CONTROLAVEL',
}

/** Deriva motivo de perda a partir de sinais + estado comercial.
 *  IMPORTANTE: silêncio do cliente NÃO vira CLIENT_GHOSTED automaticamente
 *  se a vendedora deveria ter feito follow-up (nesse caso é SELLER_NO_RESPONSE
 *  ou FOLLOWUP_MISSING). */
export function deriveLossReason(
  signals: CommercialSignalType[],
  outcome: string,
  hoursSinceLastMessage: number | null,
  hasOpenTask: boolean,
  lastMessageSender: 'contact' | 'user' | 'system' | null
): LossReason | null {
  if (outcome !== 'perdida') return null

  // Objeções explícitas
  if (signals.includes('OBJECTION_PRICE')) return 'PRICE'
  if (signals.includes('OBJECTION_SHIPPING')) return 'SHIPPING'
  if (signals.includes('OBJECTION_DEADLINE')) return 'DEADLINE'
  if (signals.includes('OBJECTION_PRODUCT')) return 'PRODUCT_INADEQUATE'

  // Cancelamento/reembolso
  if (signals.includes('CANCELLATION_REQUESTED')) return 'CLIENT_GAVE_UP'
  if (signals.includes('REFUND_REQUESTED')) return 'CLIENT_GAVE_UP'

  // Concorrente
  if (signals.includes('COMPETITOR_MENTIONED')) return 'COMPETITOR'

  // Sem intenção real
  if (signals.includes('NO_REAL_PURCHASE_INTENT')) return 'NO_REAL_PURCHASE_INTENT'

  // Falha operacional
  if (signals.includes('ESCALATION_NEEDED')) return 'OPERATIONAL_FAILURE'

  // Vendedora não respondeu quando deveria
  if (signals.includes('WAITING_ATTENDANT_REPLY')) return 'SELLER_NO_RESPONSE'

  // Follow-up faltando
  if (!hasOpenTask && lastMessageSender === 'contact' && (hoursSinceLastMessage ?? 0) > 4) {
    return 'FOLLOWUP_MISSING'
  }

  // Cliente sumiu APÓS vendedora ter respondido (ghosting real)
  if (lastMessageSender === 'user' && (hoursSinceLastMessage ?? 0) > 48) {
    return 'CLIENT_GHOSTED'
  }

  return 'UNKNOWN'
}

// ============================================================================
// Recovery Priority (Workstream 3)
// ============================================================================
export type RecoveryPriority = 'ALTA' | 'MEDIA' | 'BAIXA'

export function classifyRecoveryPriority(
  score: number | null,
  temperature: LeadTemperature,
  hoursSinceLastMessage: number | null
): RecoveryPriority {
  if (temperature === 'QUENTE' && (score ?? 0) >= 70) return 'ALTA'
  if (temperature === 'MORNO' || (score ?? 0) >= 50) return 'MEDIA'
  return 'BAIXA'
}

// ============================================================================
// Payment Funnel Stages (Workstream 9)
// ============================================================================
export type PaymentStage =
  | 'NONE'
  | 'PIX_REQUESTED'
  | 'PIX_KEY_SENT'
  | 'AWAITING_PAYMENT'
  | 'EVIDENCE_RECEIVED'
  | 'CONFIRMED'
  | 'ON_DELIVERY'
  | 'MOTOBOY_DISPATCHED'
  | 'PICKUP_READY'

export function derivePaymentStage(signals: CommercialSignalType[]): PaymentStage {
  if (signals.includes('PICKUP_CONFIRMED')) return 'PICKUP_READY'
  if (signals.includes('MOTOBOY_CONFIRMED')) return 'MOTOBOY_DISPATCHED'
  if (signals.includes('PAYMENT_ON_DELIVERY')) return 'ON_DELIVERY'
  if (signals.includes('PAYMENT_CONFIRMED')) return 'CONFIRMED'
  if (signals.includes('PAYMENT_EVIDENCE_RECEIVED')) return 'EVIDENCE_RECEIVED'
  if (signals.includes('PIX_KEY_SENT')) return 'AWAITING_PAYMENT'
  if (signals.includes('PIX_REQUESTED')) return 'PIX_KEY_SENT'
  // Se há interesse mas nada de pagamento ainda
  return 'NONE'
}

// ============================================================================
// Inbox Smart Filters (Workstream 2)
// ============================================================================
export type InboxSmartFilter =
  | 'ALL'
  | 'UNREAD'
  | 'WAITING_SELLER'
  | 'WAITING_CLIENT'
  | 'HOT'
  | 'WARM'
  | 'FOLLOW_UP'
  | 'PAYMENT'
  | 'EVIDENCE'
  | 'DELIVERY'
  | 'RECOVERY'
  | 'RISK'

// ============================================================================
// Exported for testing
// ============================================================================
export const __testing = {
  FOLLOW_UP_STATES,
  LOSS_REASON_CONTROLLABILITY,
  COMMERCIAL_INTELLIGENCE_VERSION,
}
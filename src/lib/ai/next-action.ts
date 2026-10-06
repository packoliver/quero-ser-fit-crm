/**
 * Next Best Action Determinístico v1
 * ====================================
 * Deriva a próxima ação recomendada a partir de commercial_state + sinais.
 * NUNCA recebe recomendação da IA — apenas sinais e estado agregado.
 * Todo o cálculo é código puro, testável, versionado e explicável.
 *
 * Arquitetura:
 * IA → extrai sinais → task-worker persiste → deriveCommercialState()
 *   → determineNextBestAction() → string estruturada para ui_conversation_insights.next_best_action
 *
 * Formato de saída: texto legível por humanos (campo TEXT no banco).
 * Futuramente pode evoluir para JSON estruturado, mas P0 usa string
 * para compatibilidade com o schema atual da migration.
 */

import type { CommercialSignalType } from '@/types/database'

// ============================================================================
// Configuração (versionada)
// ============================================================================
const ACTION_VERSION = 'v1'

// ============================================================================
// Tipos internos
// ============================================================================
interface ActionRule {
  /** Condição: retorna true se esta regra deve ser aplicada */
  condition: (signals: CommercialSignalType[], state: Record<string, unknown>) => boolean
  /** Texto da ação recomendada */
  action: string
  /** Prioridade (maior = mais urgente). Regras são avaliadas em ordem decrescente. */
  priority: number
}

// ============================================================================
// Regras de Next Best Action (ordenadas por prioridade decrescente)
// A primeira regra cuja condição for verdadeira vence.
// ============================================================================
const ACTION_RULES: ActionRule[] = [
  // --- Pagamento confirmado / entrega ---
  {
    condition: (_s, state) => state.payment_stage === 'confirmed',
    action: 'Confirmar entrega ou retirada ao cliente',
    priority: 100,
  },
  {
    condition: (signals) => signals.includes('MOTOBOY_CONFIRMED') || signals.includes('PICKUP_CONFIRMED'),
    action: 'Acompanhar entrega/retirada e confirmar recebimento',
    priority: 95,
  },
  {
    condition: (signals) => signals.includes('PAYMENT_ON_DELIVERY'),
    action: 'Confirmar endereço e agendar entrega com pagamento na retirada',
    priority: 90,
  },

  // --- Evidência de pagamento pendente de confirmação ---
  {
    condition: (signals) => signals.includes('PAYMENT_EVIDENCE_RECEIVED'),
    action: 'Verificar comprovante e confirmar pagamento ao cliente',
    priority: 85,
  },

  // --- PIX enviado, aguardando pagamento ---
  {
    condition: (signals) => signals.includes('PIX_KEY_SENT'),
    action: 'Aguardar pagamento ou enviar lembrete amigável após 30 min',
    priority: 80,
  },

  // --- PIX solicitado mas chave não enviada ---
  {
    condition: (signals) => signals.includes('PIX_REQUESTED'),
    action: 'Enviar chave PIX e orientar sobre prazo de pagamento',
    priority: 75,
  },

  // --- Objeções ativas ---
  {
    condition: (signals) => signals.includes('OBJECTION_PRICE'),
    action: 'Apresentar alternativa de preço, parcelamento ou desconto condicional',
    priority: 70,
  },
  {
    condition: (signals) => signals.includes('OBJECTION_SHIPPING'),
    action: 'Oferecer opção de frete alternativo ou retirada presencial',
    priority: 65,
  },
  {
    condition: (signals) => signals.includes('OBJECTION_DEADLINE'),
    action: 'Negociar prazo ou oferecer entrega expressa',
    priority: 60,
  },
  {
    condition: (signals) => signals.includes('OBJECTION_PRODUCT'),
    action: 'Sugerir produto alternativo ou esclarecer dúvidas técnicas',
    priority: 55,
  },

  // --- Risco de cancelamento ---
  {
    condition: (signals) => signals.includes('CANCELLATION_REQUESTED'),
    action: 'Entender motivo do cancelamento e oferecer retenção',
    priority: 72,
  },
  {
    condition: (signals) => signals.includes('REFUND_REQUESTED'),
    action: 'Processar reembolso ou oferecer troca conforme política',
    priority: 68,
  },

  // --- Escalação necessária ---
  {
    condition: (signals) => signals.includes('ESCALATION_NEEDED'),
    action: 'Escalar para gerente ou supervisor imediatamente',
    priority: 92,
  },

  // --- Follow-up agendado ---
  {
    condition: (signals) => signals.includes('FOLLOW_UP_SCHEDULED'),
    action: 'Executar follow-up conforme agendamento',
    priority: 50,
  },

  // --- Aguardando resposta ---
  {
    condition: (signals) => signals.includes('WAITING_ATTENDANT_REPLY'),
    action: 'Responder ao cliente — tempo de espera crítico',
    priority: 88,
  },
  {
    condition: (signals) => signals.includes('WAITING_CUSTOMER_REPLY'),
    action: 'Aguardar retorno do cliente; considerar lembrete após 2h',
    priority: 40,
  },

  // --- Interesse inicial / qualificação ---
  {
    condition: (signals) => signals.includes('PRODUCT_INTEREST') && !signals.includes('PRICE_ASKED'),
    action: 'Apresentar detalhes do produto e perguntar sobre preferência',
    priority: 35,
  },
  {
    condition: (signals) => signals.includes('PRICE_ASKED') || signals.includes('DISCOUNT_ASKED'),
    action: 'Informar preço e condições; verificar interesse em fechar',
    priority: 45,
  },
  {
    condition: (signals) => signals.includes('SIZE_SELECTED') || signals.includes('COLOR_SELECTED'),
    action: 'Confirmar disponibilidade do item selecionado e avançar para pagamento',
    priority: 50,
  },
  {
    condition: (signals) => signals.includes('AVAILABILITY_ASKED'),
    action: 'Confirmar estoque e informar prazo de reposição se necessário',
    priority: 42,
  },
  {
    condition: (signals) => signals.includes('SHIPPING_ASKED') || signals.includes('DELIVERY_DEADLINE_ASKED'),
    action: 'Informar opções de frete e prazo de entrega',
    priority: 43,
  },
  {
    condition: (signals) => signals.includes('ADDRESS_PROVIDED'),
    action: 'Validar endereço e calcular frete para avançar no fechamento',
    priority: 48,
  },
  {
    condition: (signals) => signals.includes('BUDGET_STATED'),
    action: 'Ajustar proposta ao orçamento informado',
    priority: 46,
  },
  {
    condition: (signals) => signals.includes('URGENCY_EXPRESSED'),
    action: 'Priorizar atendimento e acelerar processo de fechamento',
    priority: 52,
  },
]

// ============================================================================
// Função principal
// ============================================================================

/**
 * Determina a próxima melhor ação baseada em sinais e estado comercial.
 * Pure function — sem side effects, sem banco, sem IA.
 *
 * @param signals - Array de CommercialSignalType extraídos da conversa
 * @param commercialState - Estado derivado por deriveCommercialState()
 * @returns Texto da ação recomendada ou null se nenhuma regra aplicar
 */
export function determineNextBestAction(
  signals: CommercialSignalType[],
  commercialState: Record<string, unknown>
): string | null {
  // Avalia regras em ordem de prioridade decrescente
  const sortedRules = [...ACTION_RULES].sort((a, b) => b.priority - a.priority)

  for (const rule of sortedRules) {
    if (rule.condition(signals, commercialState)) {
      return rule.action
    }
  }

  return null
}

/** Retorna a versão da regra (para auditoria/reprocessamento) */
export function getNextActionVersion(): string {
  return ACTION_VERSION
}

// Exportado para testes
export const __testing = {
  ACTION_RULES,
  ACTION_VERSION,
}
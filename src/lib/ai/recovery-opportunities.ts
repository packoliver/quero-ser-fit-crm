/**
 * P3 — Recuperação de Oportunidades Esquecidas
 * =============================================
 * Identifica conversas com sinais positivos mas sem follow-up recente,
 * tarefas atrasadas ou leads quentes parados.
 *
 * Entradas: ai_conversation_insights, tasks, conversations, commercial_signals
 * Saída: lista priorizada de oportunidades perdidas/atrasadas
 *
 * Regras de elegibilidade (todas em código puro, testáveis):
 * 1. Lead score >= 40 (intenção real de compra)
 * 2. Conversa aberta (não fechada/arquivada)
 * 3. Sem tarefa aberta para esta conversa
 * 4. Última mensagem do cliente há mais de 2h OU last_analyzed_at > 24h
 * 5. Pelo menos um sinal positivo ativo (não invalidado)
 *
 * Priorização:
 * - Score mais alto primeiro
 * - Empate: conversa mais antiga sem resposta sobe
 */

import type { AdminClient } from '@/lib/supabase/admin'
import type { CommercialSignalType } from '@/types/database'
import {
  scoreToTemperature,
  classifyRecoveryPriority,
  type RecoveryPriority,
  type LeadTemperature,
} from './commercial-intelligence'

// ============================================================================
// Configuração (versionada — mudar regras exige bump)
// ============================================================================
export const RECOVERY_VERSION = 'v1'

/** Score mínimo para considerar uma oportunidade recuperável */
const MIN_LEAD_SCORE = 40

/** Horas sem resposta do cliente para considerar "esfriando" */
const COLD_HOURS = 2

/** Horas desde última análise sem nova ação para considerar "parado" */
const STALE_ANALYSIS_HOURS = 24

/** Sinais que indicam intenção real de compra (pelo menos um necessário) */
const POSITIVE_SIGNALS: CommercialSignalType[] = [
  'PRODUCT_INTEREST',
  'SIZE_SELECTED',
  'COLOR_SELECTED',
  'AVAILABILITY_ASKED',
  'SHIPPING_ASKED',
  'DELIVERY_DEADLINE_ASKED',
  'ADDRESS_PROVIDED',
  'PIX_REQUESTED',
  'PIX_KEY_SENT',
  'PAYMENT_EVIDENCE_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_ON_DELIVERY',
  'MOTOBOY_CONFIRMED',
  'PICKUP_CONFIRMED',
  'BUDGET_STATED',
  'URGENCY_EXPRESSED',
]

// ============================================================================
// Tipos de saída
// ============================================================================
export interface RecoveryOpportunity {
  conversationId: string
  contactName: string
  contactPhone: string | null
  channelType: string
  leadScore: number
  temperature: LeadTemperature
  priority: RecoveryPriority
  lastMessageAt: string | null
  lastAnalyzedAt: string | null
  nextBestAction: string | null
  summary: string | null
  /** Razão pela qual esta conversa foi identificada como oportunidade perdida */
  reason: 'cold_lead' | 'stale_analysis' | 'no_follow_up_task'
  /** Horas desde a última mensagem do cliente (aproximado) */
  hoursSinceLastMessage: number | null
  /** Deal associado, se existir */
  dealTitle: string | null
  dealValue: number | null
}

interface RawInsightRow {
  id: string
  conversation_id: string
  lead_score: number | null
  last_analyzed_at: string | null
  next_best_action: string | null
  summary: string | null
  commercial_state: Record<string, unknown> | null
  conversations: {
    last_message_at: string | null
    channel_type: string
    status: string
    contacts: { name: string; phone: string | null } | null
  } | null
}

interface RawTaskRow {
  conversation_id: string
  status: string
}

interface RawSignalRow {
  conversation_id: string
  signal_type: CommercialSignalType
}

// ============================================================================
// Função principal
// ============================================================================

/**
 * Carrega oportunidades de recuperação para uma organização.
 * Usa admin client (bypass RLS) pois é chamada apenas por rotas autenticadas
 * de admin/manager.
 */
export async function loadRecoveryOpportunities(
  admin: AdminClient,
  organizationId: string,
  asOf: Date = new Date()
): Promise<RecoveryOpportunity[]> {
  // 1. Busca insights com score >= threshold e conversa aberta
  const { data: insights, error: insightsError } = await admin
    .from('ai_conversation_insights')
    .select(`
      id,
      conversation_id,
      lead_score,
      last_analyzed_at,
      next_best_action,
      summary,
      commercial_state,
      conversations!inner(last_message_at, channel_type, status, contacts(name, phone))
    `)
    .eq('organization_id', organizationId)
    .gte('lead_score', MIN_LEAD_SCORE)
    .in('conversations.status', ['open', 'assigned'])
    .order('lead_score', { ascending: false })
    .limit(200)

  if (insightsError) {
    throw new Error(`Falha ao carregar insights para recuperação: ${insightsError.message}`)
  }

  const rawInsights = (insights ?? []) as unknown as RawInsightRow[]
  if (rawInsights.length === 0) return []

  const conversationIds = rawInsights.map((r) => r.conversation_id)

  // 2. Busca tarefas abertas para estas conversas (para excluir as já com follow-up)
  const { data: tasks } = await admin
    .from('tasks')
    .select('conversation_id, status')
    .eq('organization_id', organizationId)
    .in('conversation_id', conversationIds)
    .in('status', ['pending', 'in_progress'])

  const openTaskConversationIds = new Set(
    ((tasks ?? []) as unknown as RawTaskRow[])
      .filter((t) => t.status === 'pending' || t.status === 'in_progress')
      .map((t) => t.conversation_id)
  )

  // 3. Busca sinais positivos ativos para estas conversas
  const { data: signals } = await admin
    .from('commercial_signals')
    .select('conversation_id, signal_type')
    .eq('organization_id', organizationId)
    .in('conversation_id', conversationIds)
    .is('invalidated_at', null)
    .in('signal_type', POSITIVE_SIGNALS)

  const positiveSignalConversationIds = new Set(
    ((signals ?? []) as unknown as RawSignalRow[]).map((s) => s.conversation_id)
  )

  // 4. Filtra e classifica oportunidades
  const opportunities: RecoveryOpportunity[] = []

  for (const row of rawInsights) {
    // Já tem tarefa aberta → não é oportunidade esquecida
    if (openTaskConversationIds.has(row.conversation_id)) continue

    // Sem sinal positivo ativo → pode ser falso positivo do score
    if (!positiveSignalConversationIds.has(row.conversation_id)) continue

    const lastMessageAt = row.conversations?.last_message_at ?? null
    const lastAnalyzedAt = row.last_analyzed_at ?? null

    const hoursSinceLastMessage = lastMessageAt
      ? Math.floor((asOf.getTime() - new Date(lastMessageAt).getTime()) / 3_600_000)
      : null

    const hoursSinceAnalysis = lastAnalyzedAt
      ? Math.floor((asOf.getTime() - new Date(lastAnalyzedAt).getTime()) / 3_600_000)
      : null

    // Determina a razão da oportunidade
    let reason: RecoveryOpportunity['reason'] | null = null

    if (hoursSinceLastMessage !== null && hoursSinceLastMessage >= COLD_HOURS) {
      reason = 'cold_lead'
    } else if (hoursSinceAnalysis !== null && hoursSinceAnalysis >= STALE_ANALYSIS_HOURS) {
      reason = 'stale_analysis'
    } else if (!openTaskConversationIds.has(row.conversation_id)) {
      // Tem score alto, sinal positivo, mas nenhuma tarefa criada
      reason = 'no_follow_up_task'
    }

    if (!reason) continue

    const leadScore = row.lead_score ?? 0
    const temperature = scoreToTemperature(leadScore)
    const priority = classifyRecoveryPriority(leadScore, temperature, hoursSinceLastMessage)

    opportunities.push({
      conversationId: row.conversation_id,
      contactName: row.conversations?.contacts?.name || 'Contato sem nome',
      contactPhone: row.conversations?.contacts?.phone ?? null,
      channelType: row.conversations?.channel_type ?? '',
      leadScore,
      temperature,
      priority,
      lastMessageAt,
      lastAnalyzedAt,
      nextBestAction: row.next_best_action,
      summary: row.summary,
      reason,
      hoursSinceLastMessage,
      dealTitle: null, // Preenchido abaixo se houver deal
      dealValue: null,
    })
  }

  // 5. Enriquece com dados de deals (batch)
  const oppConversationIds = opportunities.map((o) => o.conversationId)
  if (oppConversationIds.length > 0) {
    const { data: deals } = await admin
      .from('deals')
      .select('conversation_id, title, value')
      .eq('organization_id', organizationId)
      .in('conversation_id', oppConversationIds)

    const dealByConversation = new Map<
      string,
      { title: string; value: number | null }
    >()
    for (const deal of (deals ?? []) as Array<{
      conversation_id: string
      title: string
      value: number | null
    }>) {
      dealByConversation.set(deal.conversation_id, {
        title: deal.title,
        value: deal.value,
      })
    }

    for (const opp of opportunities) {
      const deal = dealByConversation.get(opp.conversationId)
      if (deal) {
        opp.dealTitle = deal.title
        opp.dealValue = deal.value
      }
    }
  }

  // 6. Ordenação final: prioridade ALTA > MEDIA > BAIXA, depois score desc, depois horas sem resposta desc
  const priorityOrder: Record<RecoveryPriority, number> = { ALTA: 3, MEDIA: 2, BAIXA: 1 }
  opportunities.sort((a, b) => {
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority]
    if (pDiff !== 0) return pDiff
    if (b.leadScore !== a.leadScore) return b.leadScore - a.leadScore
    const aHours = a.hoursSinceLastMessage ?? 0
    const bHours = b.hoursSinceLastMessage ?? 0
    return bHours - aHours
  })

  return opportunities
}

// Exportado para testes
export const __testing = {
  MIN_LEAD_SCORE,
  COLD_HOURS,
  STALE_ANALYSIS_HOURS,
  POSITIVE_SIGNALS,
  RECOVERY_VERSION,
}
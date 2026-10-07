/**
 * Central de Métricas Determinísticas v1
 * ========================================
 * Fonte única de verdade para todos os KPIs do CRM Inteligente.
 * Nenhuma métrica deve ser calculada em componentes React ou rotas ad-hoc.
 *
 * Arquitetura:
 *   Métrica = { name, description, numerator, denominator, dateField, filters }
 *   Cálculo = SQL puro ou função determinística sobre dados persistidos
 *   LLM NUNCA conta — apenas interpreta resultados já calculados
 *
 * Agentes que consomem:
 * - Agente 4 (Analytics): /analytics, /relatorios, drill-down
 * - Agente 7 (Revisor): validação de consistência entre páginas
 * - Workstream 12 (Perguntas Gerenciais): Q&A usa estas fórmulas
 */

import type { AdminClient } from '@/lib/supabase/admin'

// ============================================================================
// Tipos
// ============================================================================
export interface MetricDefinition {
  /** Identificador único da métrica (usado em URLs, cache, logs) */
  id: string
  /** Nome legível */
  name: string
  /** Descrição curta para tooltips e documentação */
  description: string
  /** Campo de data principal para filtro temporal */
  dateField: string
  /** Tabela(s) envolvida(s) */
  tables: string[]
}

export interface MetricValue {
  metricId: string
  value: number
  /** Denominador quando a métrica é uma razão/percentual */
  denominator?: number
  /** Valor formatado para exibição (ex: "R$ 1.234", "67%", "12") */
  formatted: string
  /** Período da medição */
  periodStart: string
  periodEnd: string
}

export interface PeriodFilter {
  start: string // ISO date
  end: string   // ISO date
}

export interface ComparisonResult {
  current: MetricValue
  previous: MetricValue
  delta: number       // diferença absoluta
  deltaPercent: number // variação percentual
  trend: 'up' | 'down' | 'flat'
}

// ============================================================================
// Definições de Métricas
// ============================================================================
export const METRICS: Record<string, MetricDefinition> = {
  conversations_total: {
    id: 'conversations_total',
    name: 'Conversas',
    description: 'Total de conversas no período',
    dateField: 'created_at',
    tables: ['conversations'],
  },
  leads_total: {
    id: 'leads_total',
    name: 'Leads',
    description: 'Contatos únicos com pelo menos uma conversa',
    dateField: 'conversations.created_at',
    tables: ['conversations', 'contacts'],
  },
  leads_hot: {
    id: 'leads_hot',
    name: 'Leads Quentes',
    description: 'Conversas com lead_score >= 70',
    dateField: 'ai_conversation_insights.last_analyzed_at',
    tables: ['ai_conversation_insights'],
  },
  deals_won: {
    id: 'deals_won',
    name: 'Vendas Ganhas',
    description: 'Negociações marcadas como ganhas',
    dateField: 'closed_at',
    tables: ['deals'],
  },
  deals_lost: {
    id: 'deals_lost',
    name: 'Vendas Perdidas',
    description: 'Negociações marcadas como perdidas',
    dateField: 'closed_at',
    tables: ['deals'],
  },
  conversion_rate: {
    id: 'conversion_rate',
    name: 'Taxa de Conversão',
    description: 'Ganhas / (Ganhas + Perdidas)',
    dateField: 'deals.closed_at',
    tables: ['deals'],
  },
  revenue: {
    id: 'revenue',
    name: 'Valor Vendido',
    description: 'Soma do valor das negociações ganhas',
    dateField: 'deals.closed_at',
    tables: ['deals'],
  },
  avg_ticket: {
    id: 'avg_ticket',
    name: 'Ticket Médio',
    description: 'Valor médio das vendas ganhas',
    dateField: 'deals.closed_at',
    tables: ['deals'],
  },
  follow_ups_overdue: {
    id: 'follow_ups_overdue',
    name: 'Follow-ups Atrasados',
    description: 'Conversas com FOLLOWUP_ATRASADO',
    dateField: 'ai_conversation_insights.last_analyzed_at',
    tables: ['ai_conversation_insights'],
  },
  recovery_opportunities: {
    id: 'recovery_opportunities',
    name: 'Oportunidades Recuperáveis',
    description: 'Leads quentes/mornos sem follow-up recente',
    dateField: 'ai_conversation_insights.last_analyzed_at',
    tables: ['ai_conversation_insights', 'commercial_signals'],
  },
  pix_requested: {
    id: 'pix_requested',
    name: 'PIX Solicitados',
    description: 'Conversas onde foi solicitada chave PIX',
    dateField: 'commercial_signals.created_at',
    tables: ['commercial_signals'],
  },
  payment_confirmed: {
    id: 'payment_confirmed',
    name: 'Pagamentos Confirmados',
    description: 'Conversas com pagamento confirmado',
    dateField: 'commercial_signals.created_at',
    tables: ['commercial_signals'],
  },
  abandonment_rate: {
    id: 'abandonment_rate',
    name: 'Taxa de Abandono',
    description: 'CLIENT_GHOSTED + CLIENT_GAVE_UP / total de insights',
    dateField: 'ai_conversation_insights.last_analyzed_at',
    tables: ['ai_conversation_insights'],
  },
}

// ============================================================================
// Funções de cálculo (SQL puro via admin client)
// ============================================================================

/**
 * Calcula uma métrica para um período específico.
 * Usa admin client (bypass RLS) — chamada apenas por rotas server-side autenticadas.
 */
export async function calculateMetric(
  admin: AdminClient,
  organizationId: string,
  metricId: string,
  period: PeriodFilter
): Promise<MetricValue> {
  const def = METRICS[metricId]
  if (!def) throw new Error(`Métrica desconhecida: ${metricId}`)

  let value = 0
  let denominator: number | undefined

  switch (metricId) {
    case 'conversations_total': {
      const { count } = await admin
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('created_at', period.start)
        .lte('created_at', period.end)
      value = count ?? 0
      break
    }

    case 'leads_total': {
      // Contatos únicos com pelo menos uma conversa no período
      const { data: convContactIds } = await admin
        .from('conversations')
        .select('contact_id')
        .eq('organization_id', organizationId)
        .gte('created_at', period.start)
        .lte('created_at', period.end)
      const uniqueContactIds = [...new Set((convContactIds ?? []).map((c: { contact_id: string }) => c.contact_id).filter(Boolean))]
      value = uniqueContactIds.length
      break
    }

    case 'leads_hot': {
      const { count } = await admin
        .from('ai_conversation_insights')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('lead_score', 70)
        .gte('last_analyzed_at', period.start)
        .lte('last_analyzed_at', period.end)
      value = count ?? 0
      break
    }

    case 'deals_won': {
      // Pipeline stages customizáveis: busca stages com is_won = true
      const { data: wonStages } = await admin
        .from('pipeline_stages')
        .select('key')
        .eq('organization_id', organizationId)
        .eq('is_won', true)
      const wonKeys = (wonStages ?? []).map((s: { key: string }) => s.key)
      if (wonKeys.length === 0) { value = 0; break }
      const { count } = await admin
        .from('deals')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('stage', wonKeys)
        .gte('closed_at', period.start)
        .lte('closed_at', period.end)
      value = count ?? 0
      break
    }

    case 'deals_lost': {
      const { data: lostStages } = await admin
        .from('pipeline_stages')
        .select('key')
        .eq('organization_id', organizationId)
        .eq('is_lost', true)
      const lostKeys = (lostStages ?? []).map((s: { key: string }) => s.key)
      if (lostKeys.length === 0) { value = 0; break }
      const { count } = await admin
        .from('deals')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('stage', lostKeys)
        .gte('closed_at', period.start)
        .lte('closed_at', period.end)
      value = count ?? 0
      break
    }

    case 'conversion_rate': {
      const won = await calculateMetric(admin, organizationId, 'deals_won', period)
      const lost = await calculateMetric(admin, organizationId, 'deals_lost', period)
      denominator = won.value + lost.value
      value = denominator > 0 ? Math.round((won.value / denominator) * 100) : 0
      break
    }

    case 'revenue': {
      const { data: wonStages } = await admin
        .from('pipeline_stages')
        .select('key')
        .eq('organization_id', organizationId)
        .eq('is_won', true)
      const wonKeys = (wonStages ?? []).map((s: { key: string }) => s.key)
      if (wonKeys.length === 0) { value = 0; break }
      const { data: deals } = await admin
        .from('deals')
        .select('value')
        .eq('organization_id', organizationId)
        .in('stage', wonKeys)
        .gte('closed_at', period.start)
        .lte('closed_at', period.end)
      value = (deals ?? []).reduce((sum: number, d: { value: number | null }) => sum + (d.value ?? 0), 0)
      break
    }

    case 'avg_ticket': {
      const rev = await calculateMetric(admin, organizationId, 'revenue', period)
      const won = await calculateMetric(admin, organizationId, 'deals_won', period)
      denominator = won.value
      value = won.value > 0 ? Math.round(rev.value / won.value) : 0
      break
    }

    case 'follow_ups_overdue': {
      const { count } = await admin
        .from('ai_conversation_insights')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('follow_up_state', 'FOLLOWUP_ATRASADO')
        .gte('last_analyzed_at', period.start)
        .lte('last_analyzed_at', period.end)
      value = count ?? 0
      break
    }

    case 'recovery_opportunities': {
      const { count } = await admin
        .from('ai_conversation_insights')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('lead_score', 40)
        .in('follow_up_state', ['FOLLOWUP_NECESSARIO', 'FOLLOWUP_ATRASADO', 'AGUARDANDO_VENDEDORA'])
        .gte('last_analyzed_at', period.start)
        .lte('last_analyzed_at', period.end)
      value = count ?? 0
      break
    }

    case 'pix_requested': {
      const { count } = await admin
        .from('commercial_signals')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('signal_type', 'PIX_REQUESTED')
        .is('invalidated_at', null)
        .gte('created_at', period.start)
        .lte('created_at', period.end)
      value = count ?? 0
      break
    }

    case 'payment_confirmed': {
      const { count } = await admin
        .from('commercial_signals')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('signal_type', 'PAYMENT_CONFIRMED')
        .is('invalidated_at', null)
        .gte('created_at', period.start)
        .lte('created_at', period.end)
      value = count ?? 0
      break
    }

    case 'abandonment_rate': {
      const { count: total } = await admin
        .from('ai_conversation_insights')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('last_analyzed_at', period.start)
        .lte('last_analyzed_at', period.end)
      denominator = total ?? 0
      if (denominator === 0) { value = 0; break }
      const { count: abandoned } = await admin
        .from('ai_conversation_insights')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('loss_reason', ['CLIENT_GHOSTED', 'CLIENT_GAVE_UP'])
        .gte('last_analyzed_at', period.start)
        .lte('last_analyzed_at', period.end)
      value = Math.round(((abandoned ?? 0) / denominator) * 100)
      break
    }

    default:
      throw new Error(`Cálculo não implementado para métrica: ${metricId}`)
  }

  return {
    metricId,
    value,
    denominator,
    formatted: formatMetricValue(metricId, value, denominator),
    periodStart: period.start,
    periodEnd: period.end,
  }
}

/**
 * Compara uma métrica entre dois períodos (atual vs anterior).
 */
export async function compareMetric(
  admin: AdminClient,
  organizationId: string,
  metricId: string,
  currentPeriod: PeriodFilter,
  previousPeriod: PeriodFilter
): Promise<ComparisonResult> {
  const [current, previous] = await Promise.all([
    calculateMetric(admin, organizationId, metricId, currentPeriod),
    calculateMetric(admin, organizationId, metricId, previousPeriod),
  ])

  const delta = current.value - previous.value
  const deltaPercent = previous.value !== 0
    ? Math.round((delta / previous.value) * 100)
    : delta > 0 ? 100 : 0

  return {
    current,
    previous,
    delta,
    deltaPercent,
    trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  }
}

// ============================================================================
// Formatação
// ============================================================================
function formatMetricValue(metricId: string, value: number, denominator?: number): string {
  if (metricId === 'revenue' || metricId === 'avg_ticket') {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }
  if (metricId === 'conversion_rate' || metricId === 'abandonment_rate') {
    return `${value}%`
  }
  return value.toLocaleString('pt-BR')
}

// ============================================================================
// Utilitários de período
// ============================================================================
export function buildPeriod(days: number, asOf: Date = new Date()): PeriodFilter {
// Constrói datas em UTC puro para evitar drift de fuso horário em testes/CI.
// Usar setUTCHours/setUTCDate garante que 00:00:00.000Z seja sempre respeitado.
const end = new Date(Date.UTC(
asOf.getUTCFullYear(),
asOf.getUTCMonth(),
asOf.getUTCDate(),
23, 59, 59, 999
))
const startDate = new Date(Date.UTC(
asOf.getUTCFullYear(),
asOf.getUTCMonth(),
asOf.getUTCDate()
))
startDate.setUTCDate(startDate.getUTCDate() - days + 1)
return { start: startDate.toISOString(), end: end.toISOString() }
}

export function buildPreviousPeriod(current: PeriodFilter): PeriodFilter {
  const startMs = new Date(current.start).getTime()
  const endMs = new Date(current.end).getTime()
  const duration = endMs - startMs
  // O fim do período anterior deve ser exatamente 1ms antes do início do período atual
  // para garantir continuidade sem sobreposição e manter o formato 23:59:59.999
  const previousEndMs = startMs - 1
  const previousStartMs = previousEndMs - duration
  return {
    start: new Date(previousStartMs).toISOString(),
    end: new Date(previousEndMs).toISOString(),
  }
}

// Exportado para testes
export const __testing = {
  METRICS,
  buildPeriod,
  buildPreviousPeriod,
}
/**
 * Funil de Vendas Determinístico v1
 * ===================================
 * Calcula conversões entre etapas do funil comercial usando dados persistidos.
 * NUNCA usa LLM para contagem — apenas SQL/código puro.
 *
 * Etapas do funil (derivadas de commercial_signals + ai_conversation_insights):
 * 1. CONVERSAS → total de conversas no período
 * 2. INTERESSE → conversas com PRODUCT_INTEREST ou PRICE_ASKED
 * 3. PRODUTO IDENTIFICADO → conversas com SIZE_SELECTED ou COLOR_SELECTED
 * 4. PREÇO → conversas com DISCOUNT_ASKED ou BUDGET_STATED
 * 5. NEGOCIAÇÃO → conversas com OBJECTION_* ativa
 * 6. ALTA INTENÇÃO → lead_score >= 70
 * 7. PAGAMENTO SOLICITADO → PIX_REQUESTED
 * 8. AGUARDANDO PAGAMENTO → PIX_KEY_SENT sem PAYMENT_CONFIRMED
 * 9. VENDA → PAYMENT_CONFIRMED ou stage is_won=true
 *
 * Cada etapa é um subconjunto da anterior (funil real).
 * Taxa de conversão = etapa_atual / etapa_anterior * 100
 */
import type { AdminClient } from '@/lib/supabase/admin'
import type { PeriodFilter } from './metrics'

export interface FunnelStage {
  id: string
  label: string
  count: number
  conversionFromPrevious: number | null // null para primeira etapa
  dropoff: number | null // quantidade perdida em relação à etapa anterior
}

export interface FunnelResult {
  stages: FunnelStage[]
  overallConversion: number // conversas → vendas
  periodStart: string
  periodEnd: string
}

const FUNNEL_STAGE_DEFINITIONS = [
  { id: 'conversations', label: 'Conversas' },
  { id: 'interest', label: 'Interesse' },
  { id: 'product_identified', label: 'Produto Identificado' },
  { id: 'price', label: 'Preço' },
  { id: 'negotiation', label: 'Negociação' },
  { id: 'high_intent', label: 'Alta Intenção' },
  { id: 'payment_requested', label: 'Pagamento Solicitado' },
  { id: 'awaiting_payment', label: 'Aguardando Pagamento' },
  { id: 'sale', label: 'Venda' },
] as const

/**
 * Calcula o funil completo para um período.
 * Usa admin client (bypass RLS) — chamada apenas server-side.
 */
export async function calculateFunnel(
  admin: AdminClient,
  organizationId: string,
  period: PeriodFilter
): Promise<FunnelResult> {
  // Busca todos os insights do período com sinais e score
  const { data: insights, error } = await admin
    .from('ai_conversation_insights')
    .select('conversation_id, signals, lead_score, payment_stage')
    .eq('organization_id', organizationId)
    .gte('last_analyzed_at', period.start)
    .lte('last_analyzed_at', period.end)

  if (error) throw new Error(`Falha ao calcular funil: ${error.message}`)

  const rows = (insights ?? []) as Array<{
    conversation_id: string
    signals: unknown
    lead_score: number | null
    payment_stage: string | null
  }>

  // Normaliza sinais para array de strings
  const parseSignals = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string')
    return []
  }

  // Classifica cada conversa nas etapas do funil (uma conversa pode estar em múltiplas etapas)
  const stageCounts: Record<string, Set<string>> = {}
  for (const def of FUNNEL_STAGE_DEFINITIONS) {
    stageCounts[def.id] = new Set()
  }

  for (const row of rows) {
    const signals = parseSignals(row.signals)
    const cid = row.conversation_id

    // Etapa 1: Conversas (todas que têm insight no período)
    stageCounts.conversations.add(cid)

    // Etapa 2: Interesse
    if (signals.includes('PRODUCT_INTEREST') || signals.includes('PRICE_ASKED')) {
      stageCounts.interest.add(cid)
    }

    // Etapa 3: Produto Identificado
    if (signals.includes('SIZE_SELECTED') || signals.includes('COLOR_SELECTED')) {
      stageCounts.product_identified.add(cid)
    }

    // Etapa 4: Preço
    if (signals.includes('DISCOUNT_ASKED') || signals.includes('BUDGET_STATED')) {
      stageCounts.price.add(cid)
    }

    // Etapa 5: Negociação (tem objeção ativa)
    if (signals.some(s => s.startsWith('OBJECTION_'))) {
      stageCounts.negotiation.add(cid)
    }

    // Etapa 6: Alta Intenção
    if ((row.lead_score ?? 0) >= 70) {
      stageCounts.high_intent.add(cid)
    }

    // Etapa 7: Pagamento Solicitado
    if (signals.includes('PIX_REQUESTED') || row.payment_stage === 'PIX_KEY_SENT') {
      stageCounts.payment_requested.add(cid)
    }

    // Etapa 8: Aguardando Pagamento
    if (signals.includes('PIX_KEY_SENT') && !signals.includes('PAYMENT_CONFIRMED')) {
      stageCounts.awaiting_payment.add(cid)
    }

    // Etapa 9: Venda
    if (signals.includes('PAYMENT_CONFIRMED') || row.payment_stage === 'CONFIRMED') {
      stageCounts.sale.add(cid)
    }
  }

  // Constrói resultado com taxas de conversão
  const stages: FunnelStage[] = FUNNEL_STAGE_DEFINITIONS.map((def, idx) => {
    const count = stageCounts[def.id].size
    const prevCount = idx > 0 ? stageCounts[FUNNEL_STAGE_DEFINITIONS[idx - 1].id].size : null
    const conversion = prevCount !== null && prevCount > 0
      ? Math.round((count / prevCount) * 100)
      : null
    const dropoff = prevCount !== null ? prevCount - count : null

    return {
      id: def.id,
      label: def.label,
      count,
      conversionFromPrevious: conversion,
      dropoff,
    }
  })

  const totalConversations = stageCounts.conversations.size
  const totalSales = stageCounts.sale.size
  const overallConversion = totalConversations > 0
    ? Math.round((totalSales / totalConversations) * 100)
    : 0

  return {
    stages,
    overallConversion,
    periodStart: period.start,
    periodEnd: period.end,
  }
}

// Exportado para testes
export const __testing = { FUNNEL_STAGE_DEFINITIONS }
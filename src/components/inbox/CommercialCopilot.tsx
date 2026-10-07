'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Target,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageSquare,
  TrendingUp,
  Package,
  CreditCard,
  UserCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/Badge'
import { BottomSheet } from '@/components/ui/BottomSheet'

type InsightRow = Database['public']['Tables']['ai_conversation_insights']['Row']

interface CommercialCopilotProps {
  conversationId: string
}

interface CommercialStateShape {
  product_interest?: string
  size_selected?: string
  color_selected?: string
  has_price_objection?: boolean
  payment_stage?: string
  has_payment_on_delivery?: boolean
  has_motoboy?: boolean
  pending_reply?: string
  cancellation_risk?: boolean
}

function getTemperature(score: number | null): { label: string; color: string; icon: typeof TrendingUp; badgeVariant: 'rose' | 'amber' | 'slate' | 'teal' } {
  if (score === null) return { label: 'Indefinido', color: 'text-slate-400', icon: TrendingUp, badgeVariant: 'slate' }
  if (score >= 70) return { label: 'Quente', color: 'text-red-500', icon: Zap, badgeVariant: 'rose' }
  if (score >= 40) return { label: 'Morno', color: 'text-amber-500', icon: TrendingUp, badgeVariant: 'amber' }
  return { label: 'Frio', color: 'text-blue-400', icon: Clock, badgeVariant: 'teal' }
}

function getPaymentStage(state: CommercialStateShape): string {
  if (state.payment_stage === 'confirmed') return 'Pagamento Confirmado'
  if (state.payment_stage === 'pix_sent') return 'Chave PIX Enviada'
  if (state.payment_stage === 'pix_requested') return 'PIX Solicitado'
  if (state.has_payment_on_delivery) return 'Pagamento na Entrega'
  if (state.has_motoboy) return 'Motoboy Confirmado'
  return 'Aguardando Definição'
}

export function CommercialCopilot({ conversationId }: CommercialCopilotProps) {
  const [insight, setInsight] = useState<InsightRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  // Track if a new analysis arrived while collapsed
  const [hasUpdate, setHasUpdate] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function load() {
      const { data } = await supabase
        .from('ai_conversation_insights')
        .select('*')
        .eq('conversation_id', conversationId)
        .maybeSingle()

      if (!cancelled) {
        setInsight(data)
        setLoading(false)
      }
    }

    load()

    const channel = supabase
      .channel(`copilot-${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_conversation_insights', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (!cancelled) {
            setInsight(payload.new as InsightRow)
            // If panel is collapsed, show subtle update indicator
            if (!expanded) {
              setHasUpdate(true)
            }
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversationId, expanded])

  const handleOpenDetails = useCallback(() => {
    setExpanded(true)
    setHasUpdate(false)
  }, [])

  const handleCloseDetails = useCallback(() => {
    setExpanded(false)
  }, [])

  if (loading) {
    return (
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0d1525]">
        <div className="h-8 animate-pulse rounded bg-slate-800/60 w-2/3" />
      </div>
    )
  }

  if (!insight) {
    return (
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0d1525] flex items-center gap-2 text-xs text-slate-500">
        <Sparkles className="w-3.5 h-3.5 opacity-50" />
        <span>Análise comercial pendente</span>
      </div>
    )
  }

  const commercialState = (insight.commercial_state as CommercialStateShape | null) ?? {}
  const temperature = getTemperature(insight.lead_score)
  const TempIcon = temperature.icon
  const paymentStage = getPaymentStage(commercialState)
  const hasRisk = Boolean(commercialState.cancellation_risk)

  // Compact summary line content
  const summaryLabel = temperature.label
  const summaryDetail = paymentStage

  return (
    <>
      {/* ── Compact Bar (always visible) ── */}
      <div className="px-3 py-2 border-b border-slate-800 bg-[#0d1525] flex items-center gap-2 min-h-[40px]">
        <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />

        <span className="text-xs font-semibold text-slate-300 shrink-0">IA</span>

        <Badge variant={temperature.badgeVariant} icon={<TempIcon className="w-3 h-3" />}>
          {summaryLabel}
        </Badge>

        <span className="text-[11px] text-slate-500 truncate hidden sm:inline">
          · {summaryDetail}
        </span>

        {hasRisk && (
          <Badge variant="rose" icon={<AlertTriangle className="w-3 h-3" />}>
            Risco
          </Badge>
        )}

        {hasUpdate && !expanded && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" title="Análise atualizada" />
        )}

        <button
          type="button"
          onClick={handleOpenDetails}
          aria-expanded={expanded}
          className="ml-auto flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded px-1.5 py-0.5"
        >
          <span>Ver análise</span>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* ── Desktop: Inline Expandable Panel ── */}
      {expanded && (
        <div className="hidden sm:block border-b border-slate-800 bg-[#0f1729]">
          <AnalysisDetails
            insight={insight}
            commercialState={commercialState}
            temperature={temperature}
            paymentStage={paymentStage}
            hasRisk={hasRisk}
            onClose={handleCloseDetails}
          />
        </div>
      )}

      {/* ── Mobile: Bottom Sheet ── */}
      <BottomSheet
        isOpen={expanded}
        onClose={handleCloseDetails}
        title="Análise da IA"
        description={insight.summary ? 'Resumo comercial da conversa' : undefined}
      >
        <div className="sm:hidden">
          <AnalysisDetails
            insight={insight}
            commercialState={commercialState}
            temperature={temperature}
            paymentStage={paymentStage}
            hasRisk={hasRisk}
            onClose={handleCloseDetails}
            isMobile
          />
        </div>
      </BottomSheet>
    </>
  )
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Shared details content — used in both desktop inline panel and mobile sheet.
 * No additional data fetching; consumes the same insight prop.
 * ────────────────────────────────────────────────────────────────────────────── */

function AnalysisDetails({
  insight,
  commercialState,
  temperature,
  paymentStage,
  hasRisk,
  onClose,
  isMobile = false,
}: {
  insight: InsightRow
  commercialState: CommercialStateShape
  temperature: ReturnType<typeof getTemperature>
  paymentStage: string
  hasRisk: boolean
  onClose: () => void
  isMobile?: boolean
}) {
  const TempIcon = temperature.icon

  return (
    <div className={`flex flex-col ${isMobile ? 'gap-4 pb-4' : 'gap-3 p-4'}`}>
      {/* Header row with close button (desktop only — mobile uses sheet handle) */}
      {!isMobile && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 font-semibold ${temperature.color}`}>
              <TempIcon className="w-4 h-4" />
              <span>{temperature.label}</span>
            </div>
            {insight.lead_score !== null && (
              <span className="text-xs text-slate-500 font-mono">Score {insight.lead_score}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded p-1"
            aria-label="Fechar análise"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Mobile header with score */}
      {isMobile && (
        <div className="flex items-center gap-3 px-1">
          <div className={`flex items-center gap-1.5 font-semibold ${temperature.color}`}>
            <TempIcon className="w-4 h-4" />
            <span>{temperature.label}</span>
          </div>
          {insight.lead_score !== null && (
            <span className="text-xs text-slate-500 font-mono">Score {insight.lead_score}</span>
          )}
          {hasRisk && (
            <Badge variant="rose" icon={<AlertTriangle className="w-3 h-3" />}>
              Risco de Cancelamento
            </Badge>
          )}
        </div>
      )}

      {/* Risk badge (desktop) */}
      {!isMobile && hasRisk && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-rose-400 bg-rose-950/30 border border-rose-900/40 px-2.5 py-1.5 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Risco de Cancelamento</span>
        </div>
      )}

      {/* Next Best Action */}
      {insight.next_best_action && (
        <div className="flex gap-2.5 p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/30 text-emerald-200">
          <Target className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-500">Próxima Ação</span>
            <span className="text-sm leading-snug">{insight.next_best_action}</span>
          </div>
        </div>
      )}

      {/* Signals Grid */}
      <div className={`grid gap-x-4 gap-y-2 text-xs ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} text-slate-400`}>
        {commercialState.product_interest && (
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-slate-500" />
            <span className="truncate text-slate-300">{commercialState.product_interest}</span>
          </div>
        )}
        {commercialState.size_selected && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Tam: <span className="text-slate-300">{commercialState.size_selected}</span></span>
          </div>
        )}
        {commercialState.color_selected && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Cor: <span className="text-slate-300">{commercialState.color_selected}</span></span>
          </div>
        )}
        {commercialState.has_price_objection && (
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Objeção de Preço</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
          <span className="truncate text-slate-300">{paymentStage}</span>
        </div>
        {commercialState.pending_reply && (
          <div className={`flex items-center gap-1.5 ${commercialState.pending_reply === 'attendant' ? 'text-orange-400 font-medium' : ''}`}>
            <UserCheck className="w-3.5 h-3.5" />
            <span>{commercialState.pending_reply === 'attendant' ? 'Aguardando Vendedora' : 'Aguardando Cliente'}</span>
          </div>
        )}
      </div>

      {/* Summary */}
      {insight.summary && (
        <div className={`border-t border-slate-800 ${isMobile ? 'pt-3' : 'pt-2'}`}>
          <div className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{insight.summary}</span>
          </div>
        </div>
      )}

      {/* Last analyzed timestamp */}
      {insight.last_analyzed_at && (
        <div className="text-[10px] text-slate-600 text-right">
          Última análise: {new Date(insight.last_analyzed_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}
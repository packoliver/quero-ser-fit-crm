'use client'

import { useEffect, useState } from 'react'
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
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

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

function getTemperature(score: number | null): { label: string; color: string; icon: typeof TrendingUp } {
  if (score === null) return { label: 'Indefinido', color: 'text-slate-400', icon: TrendingUp }
  if (score >= 70) return { label: 'Quente', color: 'text-red-500', icon: Zap }
  if (score >= 40) return { label: 'Morno', color: 'text-amber-500', icon: TrendingUp }
  return { label: 'Frio', color: 'text-blue-400', icon: Clock }
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
          if (!cancelled) setInsight(payload.new as InsightRow)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  if (loading) {
    return (
      <div className="p-4 space-y-3 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3" />
        <div className="h-20 bg-slate-100 rounded" />
        <div className="h-16 bg-slate-100 rounded" />
      </div>
    )
  }

  if (!insight) {
    return (
      <div className="p-4 text-center text-sm text-slate-500">
        <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-50" />
        Análise comercial pendente
      </div>
    )
  }

  const commercialState = (insight.commercial_state as CommercialStateShape | null) ?? {}
  const temperature = getTemperature(insight.lead_score)
  const TempIcon = temperature.icon
  const paymentStage = getPaymentStage(commercialState)
  const hasRisk = Boolean(commercialState.cancellation_risk)

  return (
    <div className="flex flex-col gap-3 p-4 text-sm border-b border-slate-100 bg-white">
      {/* Header: Score + Temperatura */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 font-semibold ${temperature.color}`}>
            <TempIcon className="w-4 h-4" />
            <span>{temperature.label}</span>
          </div>
          {insight.lead_score !== null && (
            <span className="text-xs text-slate-500 font-mono">Score {insight.lead_score}</span>
          )}
        </div>
        {hasRisk && (
          <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
            <AlertTriangle className="w-3 h-3" /> Risco
          </span>
        )}
      </div>

      {/* Next Best Action */}
      {insight.next_best_action && (
        <div className="flex gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-900">
          <Target className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700">Próxima Ação</span>
            <span className="leading-snug">{insight.next_best_action}</span>
          </div>
        </div>
      )}

      {/* Grid de Sinais */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
        {commercialState.product_interest && (
          <div className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-slate-400" />
            <span className="truncate">{commercialState.product_interest}</span>
          </div>
        )}
        {commercialState.size_selected && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Tam: {commercialState.size_selected}</span>
          </div>
        )}
        {commercialState.color_selected && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Cor: {commercialState.color_selected}</span>
          </div>
        )}
        {commercialState.has_price_objection && (
          <div className="flex items-center gap-1.5 text-amber-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Objeção de Preço</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate">{paymentStage}</span>
        </div>
        {commercialState.pending_reply && (
          <div className={`flex items-center gap-1.5 ${commercialState.pending_reply === 'attendant' ? 'text-orange-600 font-medium' : ''}`}>
            <UserCheck className="w-3.5 h-3.5" />
            <span>{commercialState.pending_reply === 'attendant' ? 'Aguardando Vendedora' : 'Aguardando Cliente'}</span>
          </div>
        )}
      </div>

      {/* Resumo */}
      {insight.summary && (
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-start gap-2 text-xs text-slate-500 leading-relaxed">
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="line-clamp-3">{insight.summary}</span>
          </div>
        </div>
      )}
    </div>
  )
}
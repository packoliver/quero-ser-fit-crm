'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  Calendar,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ComparisonResult, MetricValue } from '@/lib/analytics/metrics'

type PeriodDays = 7 | 15 | 30 | 90

interface MetricsResponse {
  period: { start: string; end: string }
  comparisonPeriod: { start: string; end: string } | null
  metrics: Record<string, MetricValue | ComparisonResult>
}

const PERIOD_OPTIONS: { value: PeriodDays; label: string }[] = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 15, label: 'Últimos 15 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
]

/** Métricas em ordem de exibição com labels e descrições */
const METRIC_DISPLAY: Array<{
  id: string
  label: string
  description: string
  category: 'vendas' | 'leads' | 'operacional' | 'pagamentos'
}> = [
  { id: 'revenue', label: 'Valor Vendido', description: 'Soma das vendas ganhas', category: 'vendas' },
  { id: 'deals_won', label: 'Vendas Ganhas', description: 'Negociações fechadas com sucesso', category: 'vendas' },
  { id: 'deals_lost', label: 'Vendas Perdidas', description: 'Negociações encerradas sem sucesso', category: 'vendas' },
  { id: 'conversion_rate', label: 'Taxa de Conversão', description: 'Ganhas / (Ganhas + Perdidas)', category: 'vendas' },
  { id: 'avg_ticket', label: 'Ticket Médio', description: 'Valor médio por venda', category: 'vendas' },
  { id: 'leads_hot', label: 'Leads Quentes', description: 'Score >= 70', category: 'leads' },
  { id: 'conversations_total', label: 'Conversas', description: 'Total no período', category: 'leads' },
  { id: 'recovery_opportunities', label: 'Oportunidades Recuperáveis', description: 'Leads parados com intenção', category: 'leads' },
  { id: 'follow_ups_overdue', label: 'Follow-ups Atrasados', description: 'Ações pendentes vencidas', category: 'operacional' },
  { id: 'abandonment_rate', label: 'Taxa de Abandono', description: 'Clientes que sumiram', category: 'operacional' },
  { id: 'pix_requested', label: 'PIX Solicitados', description: 'Chaves PIX enviadas', category: 'pagamentos' },
  { id: 'payment_confirmed', label: 'Pagamentos Confirmados', description: 'PIX confirmados', category: 'pagamentos' },
]

function isComparison(v: MetricValue | ComparisonResult): v is ComparisonResult {
  return 'current' in v && 'previous' in v
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp className="w-3 h-3 text-emerald-400" />
  if (trend === 'down') return <TrendingDown className="w-3 h-3 text-rose-400" />
  return <Minus className="w-3 h-3 text-slate-500" />
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/analytics?days=${period}&compare=true`,
        { cache: 'no-store' }
      )
      const json = (await response.json()) as MetricsResponse & { error?: string }
      if (!response.ok || json.error) {
        setError(json.error || 'Não foi possível carregar as métricas.')
        return
      }
      setData(json)
    } catch {
      setError('Erro de conexão ao carregar analytics.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    const timer = setTimeout(() => { void fetchMetrics() }, 0)
    return () => clearTimeout(timer)
  }, [fetchMetrics])

  const categories = useMemo(() => {
    const cats = new Map<string, typeof METRIC_DISPLAY>()
    for (const m of METRIC_DISPLAY) {
      if (!cats.has(m.category)) cats.set(m.category, [])
      cats.get(m.category)!.push(m)
    }
    return cats
  }, [])

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-teal-400" />
            Analytics Executivo
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Métricas determinísticas calculadas via SQL — nunca por IA. Comparação automática com o período anterior.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(period)}
            onChange={(e) => setPeriod(Number(e.target.value) as PeriodDays)}
            options={PERIOD_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            className="w-auto"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void fetchMetrics()}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !data && !error && (
        <EmptyState
          icon={<BarChart3 className="w-5 h-5" />}
          title="Sem dados para o período"
          description="As métricas aparecem aqui assim que houver conversas e negociações analisadas."
        />
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
          <span className="ml-2 text-sm text-slate-400">Calculando métricas…</span>
        </div>
      )}

      {data && (
        <div className="space-y-8">
          {Array.from(categories.entries()).map(([category, metrics]) => (
            <div key={category} className="space-y-3">
              <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider capitalize">
                {category === 'vendas' ? 'Vendas & Receita' : category === 'leads' ? 'Leads & Oportunidades' : category === 'operacional' ? 'Operacional' : 'Pagamentos'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {metrics.map((m) => {
                  const raw = data.metrics[m.id]
                  if (!raw) return null

                  const isComp = isComparison(raw)
                  const current = isComp ? raw.current : raw
                  const trend = isComp ? raw.trend : 'flat'
                  const deltaPercent = isComp ? raw.deltaPercent : 0

                  return (
                    <Card key={m.id} className="relative overflow-hidden">
                      <CardBody className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] text-slate-400 uppercase tracking-wide leading-tight">
                            {m.label}
                          </p>
                          {isComp && (
                            <div className="flex items-center gap-1 text-[10px]">
                              <TrendIcon trend={trend} />
                              <span
                                className={
                                  trend === 'up'
                                    ? 'text-emerald-400'
                                    : trend === 'down'
                                      ? 'text-rose-400'
                                      : 'text-slate-500'
                                }
                              >
                                {deltaPercent > 0 ? '+' : ''}
                                {deltaPercent}%
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-2xl font-bold text-slate-100">{current.formatted}</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{m.description}</p>
                      </CardBody>
                    </Card>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Período info */}
          <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-2 border-t border-slate-800">
            <Calendar className="w-3 h-3" />
            <span>
              Período atual: {new Date(data.period.start).toLocaleDateString('pt-BR')} →{' '}
              {new Date(data.period.end).toLocaleDateString('pt-BR')}
            </span>
            {data.comparisonPeriod && (
              <>
                <ArrowRight className="w-3 h-3" />
                <span>
                  Comparado com: {new Date(data.comparisonPeriod.start).toLocaleDateString('pt-BR')} →{' '}
                  {new Date(data.comparisonPeriod.end).toLocaleDateString('pt-BR')}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
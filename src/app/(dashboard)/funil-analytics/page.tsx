'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, AlertTriangle, TrendingDown, Loader2, ArrowRight } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'

type PeriodDays = 7 | 15 | 30 | 90

interface FunnelStage {
  id: string
  label: string
  count: number
  conversionFromPrevious: number | null
  dropoff: number | null
}

interface FunnelResult {
  stages: FunnelStage[]
  overallConversion: number
  periodStart: string
  periodEnd: string
}

const PERIOD_OPTIONS: { value: PeriodDays; label: string }[] = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 15, label: 'Últimos 15 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
]

export default function FunilAnalyticsPage() {
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [data, setData] = useState<FunnelResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchFunnel = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/analytics/funnel?days=${period}`, { cache: 'no-store' })
      const json = (await response.json()) as FunnelResult & { error?: string }
      if (!response.ok || json.error) {
        setError(json.error || 'Não foi possível carregar o funil.')
        return
      }
      setData(json)
    } catch {
      setError('Erro de conexão ao carregar funil.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    const timer = setTimeout(() => { void fetchFunnel() }, 0)
    return () => clearTimeout(timer)
  }, [fetchFunnel])

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-indigo-400" />
            Funil de Conversão
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Análise determinística das taxas de conversão entre etapas comerciais. Dados via SQL — nunca por IA.
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
            onClick={() => void fetchFunnel()}
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
          icon={<TrendingDown className="w-5 h-5" />}
          title="Sem dados para o período"
          description="O funil aparece aqui assim que houver conversas analisadas pela IA."
        />
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="ml-2 text-sm text-slate-400">Calculando funil…</span>
        </div>
      )}

      {data && data.stages.length > 0 && (
        <>
          {/* Overall Conversion Banner */}
          <Card className="border-indigo-800/40 bg-indigo-950/20">
            <CardBody className="flex items-center justify-between py-4">
              <div>
                <p className="text-[11px] text-indigo-300 uppercase tracking-wide">Conversão Geral (Conversas → Vendas)</p>
                <p className="text-3xl font-bold text-indigo-100 mt-1">{data.overallConversion}%</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-400">Período</p>
                <p className="text-xs text-slate-300">
                  {new Date(data.periodStart).toLocaleDateString('pt-BR')} → {new Date(data.periodEnd).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </CardBody>
          </Card>

          {/* Funnel Stages */}
          <div className="space-y-2">
            {data.stages.map((stage, idx) => {
              const barWidth = data.stages[0].count > 0
                ? Math.max(8, (stage.count / data.stages[0].count) * 100)
                : 8
              const conversionColor =
                stage.conversionFromPrevious === null ? 'text-slate-500' :
                stage.conversionFromPrevious >= 70 ? 'text-emerald-400' :
                stage.conversionFromPrevious >= 40 ? 'text-amber-400' :
                'text-rose-400'

              return (
                <div key={stage.id} className="relative">
                  <Card className="overflow-hidden">
                    <CardBody className="py-3 px-4">
                      <div className="flex items-center justify-between gap-3 relative z-10">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-xs font-bold text-slate-300 w-6 shrink-0 text-center">{idx + 1}</span>
                          <span className="text-sm font-semibold text-slate-100 truncate">{stage.label}</span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-lg font-bold text-slate-100 tabular-nums">{stage.count}</span>
                          {stage.conversionFromPrevious !== null && (
                            <div className="flex items-center gap-1 min-w-[60px] justify-end">
                              <ArrowRight className="w-3 h-3 text-slate-600" />
                              <span className={`text-xs font-semibold tabular-nums ${conversionColor}`}>
                                {stage.conversionFromPrevious}%
                              </span>
                            </div>
                          )}
                          {stage.dropoff !== null && stage.dropoff > 0 && (
                            <Badge variant="slate" className="text-[10px]">
                              -{stage.dropoff}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Visual bar */}
                      <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500/60 rounded-full transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </CardBody>
                  </Card>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
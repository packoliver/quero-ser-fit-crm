'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Users, Loader2, BarChart3, MessageSquare, CheckCircle2, XCircle, Clock, Target } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'

interface SellerPerformance {
  sellerId: string
  sellerName: string
  conversations: number
  leads: number
  hotLeads: number
  wonDeals: number
  lostDeals: number
  conversionRate: number
  avgResponseTimeMinutes: number | null
  followUpsOverdue: number
  abandonedLeads: number
  recoveredOpportunities: number
  objectionsHandled: number
  pixRequested: number
  paymentsConfirmed: number
  revenue: number
}

interface AiInsight {
  type: 'strength' | 'weakness' | 'pattern' | 'action'
  text: string
  evidence?: string
}

type PeriodDays = 7 | 15 | 30 | 90

const PERIOD_OPTIONS: { value: PeriodDays; label: string }[] = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 15, label: 'Últimos 15 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
]

export default function PerformancePage() {
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [sellers, setSellers] = useState<SellerPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSeller, setSelectedSeller] = useState<string>('all')

  const fetchPerformance = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typed = supabase as any
      
      const { data: userData } = await typed.auth.getUser()
      if (!userData?.user) { setError('Não autenticado.'); setLoading(false); return }
      
      const { data: member } = await typed.from('organization_members')
        .select('organization_id')
        .eq('user_id', userData.user.id)
        .limit(1)
        .maybeSingle()
      
      if (!member) { setError('Organização não encontrada.'); setLoading(false); return }

      // Busca membros da equipe
      const { data: members } = await typed.from('organization_members')
        .select('user_id, profiles(full_name)')
        .eq('organization_id', member.organization_id)
      
      const sellerIds = (members || []).map((m: { user_id: string }) => m.user_id)
      if (sellerIds.length === 0) { setSellers([]); setLoading(false); return }

      // Para cada vendedor, calcula métricas determinísticas
      const performances: SellerPerformance[] = []
      
      for (const m of (members || []) as Array<{ user_id: string; profiles: { full_name: string } | null }>) {
        const sellerId = m.user_id
        const sellerName = m.profiles?.full_name || 'Vendedor(a)'
        
        // Conversas atribuídas
        const { count: conversations } = await typed.from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', member.organization_id)
          .eq('current_assignee_id', sellerId)
        
        // Leads quentes (insights com score >= 70)
        const { count: hotLeads } = await typed.from('ai_conversation_insights')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', member.organization_id)
          .gte('lead_score', 70)
          .in('conversation_id', 
            (await typed.from('conversations')
              .select('id')
              .eq('organization_id', member.organization_id)
              .eq('current_assignee_id', sellerId)
            ).data?.map((c: { id: string }) => c.id) || []
          )

        // Deals ganhas/perdidas
        const { data: wonStages } = await typed.from('pipeline_stages')
          .select('key').eq('organization_id', member.organization_id).eq('is_won', true)
        const { data: lostStages } = await typed.from('pipeline_stages')
          .select('key').eq('organization_id', member.organization_id).eq('is_lost', true)
        
        const wonKeys = (wonStages || []).map((s: { key: string }) => s.key)
        const lostKeys = (lostStages || []).map((s: { key: string }) => s.key)
        
        const { count: wonDeals } = wonKeys.length > 0 
          ? await typed.from('deals').select('*', { count: 'exact', head: true })
              .eq('organization_id', member.organization_id)
              .eq('assigned_to_id', sellerId)
              .in('stage', wonKeys)
          : { count: 0 }
          
        const { count: lostDeals } = lostKeys.length > 0
          ? await typed.from('deals').select('*', { count: 'exact', head: true })
              .eq('organization_id', member.organization_id)
              .eq('assigned_to_id', sellerId)
              .in('stage', lostKeys)
          : { count: 0 }

        // Receita
        const { data: dealsRevenue } = wonKeys.length > 0
          ? await typed.from('deals').select('value')
              .eq('organization_id', member.organization_id)
              .eq('assigned_to_id', sellerId)
              .in('stage', wonKeys)
          : { data: [] }
        
        const revenue = (dealsRevenue || []).reduce((sum: number, d: { value: number | null }) => sum + (d.value || 0), 0)

        // Follow-ups atrasados
        const { count: followUpsOverdue } = await typed.from('ai_conversation_insights')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', member.organization_id)
          .eq('follow_up_state', 'FOLLOWUP_ATRASADO')
          .in('conversation_id',
            (await typed.from('conversations')
              .select('id')
              .eq('organization_id', member.organization_id)
              .eq('current_assignee_id', sellerId)
            ).data?.map((c: { id: string }) => c.id) || []
          )

        // PIX solicitados
        const convIds = (await typed.from('conversations')
          .select('id')
          .eq('organization_id', member.organization_id)
          .eq('current_assignee_id', sellerId)
        ).data?.map((c: { id: string }) => c.id) || []

        const { count: pixRequested } = convIds.length > 0
          ? await typed.from('commercial_signals').select('*', { count: 'exact', head: true })
              .eq('organization_id', member.organization_id)
              .eq('signal_type', 'PIX_REQUESTED')
              .is('invalidated_at', null)
              .in('conversation_id', convIds)
          : { count: 0 }

        const { count: paymentsConfirmed } = convIds.length > 0
          ? await typed.from('commercial_signals').select('*', { count: 'exact', head: true })
              .eq('organization_id', member.organization_id)
              .eq('signal_type', 'PAYMENT_CONFIRMED')
              .is('invalidated_at', null)
              .in('conversation_id', convIds)
          : { count: 0 }

        const totalDeals = (wonDeals || 0) + (lostDeals || 0)
        const conversionRate = totalDeals > 0 ? Math.round(((wonDeals || 0) / totalDeals) * 100) : 0

        performances.push({
          sellerId,
          sellerName,
          conversations: conversations || 0,
          leads: conversations || 0, // Simplificação: conversa = lead
          hotLeads: hotLeads || 0,
          wonDeals: wonDeals || 0,
          lostDeals: lostDeals || 0,
          conversionRate,
          avgResponseTimeMinutes: null, // Requer cálculo mais complexo de timestamps
          followUpsOverdue: followUpsOverdue || 0,
          abandonedLeads: 0, // Derivado de loss_reason em futura iteração
          recoveredOpportunities: 0, // Derivado de recovery tasks
          objectionsHandled: 0, // Derivado de OBJECTION_* signals
          pixRequested: pixRequested || 0,
          paymentsConfirmed: paymentsConfirmed || 0,
          revenue,
        })
      }

      setSellers(performances.sort((a, b) => b.revenue - a.revenue))
    } catch (err) {
      console.error('[Performance]', err)
      setError('Erro ao carregar performance da equipe.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void fetchPerformance() }, 0)
    return () => clearTimeout(timer)
  }, [fetchPerformance])

  const filteredSellers = useMemo(() => {
    if (selectedSeller === 'all') return sellers
    return sellers.filter(s => s.sellerId === selectedSeller)
  }, [sellers, selectedSeller])

  // Gera insights determinísticos baseados em regras (não LLM para contagem)
  const generateInsights = (seller: SellerPerformance): AiInsight[] => {
    const insights: AiInsight[] = []
    
    // Acertos
    if (seller.conversionRate >= 40) {
      insights.push({ type: 'strength', text: `Taxa de conversão excelente (${seller.conversionRate}%)`, evidence: `${seller.wonDeals} vendas fechadas de ${seller.wonDeals + seller.lostDeals} negociações` })
    }
    if (seller.paymentsConfirmed > seller.pixRequested * 0.6 && seller.pixRequested > 0) {
      insights.push({ type: 'strength', text: 'Alta taxa de confirmação de PIX', evidence: `${seller.paymentsConfirmed} confirmados de ${seller.pixRequested} solicitados` })
    }
    if (seller.followUpsOverdue === 0 && seller.conversations > 5) {
      insights.push({ type: 'strength', text: 'Disciplina exemplar em follow-ups', evidence: 'Zero follow-ups atrasados no período' })
    }

    // Pontos de atenção
    if (seller.followUpsOverdue > 3) {
      insights.push({ type: 'weakness', text: `${seller.followUpsOverdue} follow-ups atrasados exigem ação imediata`, evidence: 'Leads podem esfriar sem retorno rápido' })
    }
    if (seller.conversionRate < 15 && seller.conversations > 10) {
      insights.push({ type: 'weakness', text: 'Taxa de conversão abaixo da média', evidence: `Apenas ${seller.conversionRate}% das negociações estão fechando` })
    }
    if (seller.pixRequested > 5 && seller.paymentsConfirmed < seller.pixRequested * 0.3) {
      insights.push({ type: 'weakness', text: 'Abandono alto após envio do PIX', evidence: `Apenas ${Math.round((seller.paymentsConfirmed / seller.pixRequested) * 100)}% dos PIX enviados foram pagos` })
    }

    // Ações recomendadas
    if (seller.hotLeads > 2 && seller.followUpsOverdue > 0) {
      insights.push({ type: 'action', text: 'Priorizar leads quentes com follow-up pendente', evidence: `${seller.hotLeads} leads quentes precisam de atenção agora` })
    }
    if (seller.lostDeals > seller.wonDeals && seller.lostDeals > 3) {
      insights.push({ type: 'action', text: 'Revisar objeções mais frequentes nas perdas', evidence: `${seller.lostDeals} negócios perdidos vs ${seller.wonDeals} ganhos` })
    }

    return insights.slice(0, 8) // Limita a 8 insights por vendedor
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-violet-400" />
            Performance da Equipe
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Métricas individuais e coaching baseado em dados reais. Contagens via SQL, interpretação via regras determinísticas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(period)}
            onChange={(e) => setPeriod(Number(e.target.value) as PeriodDays)}
            options={PERIOD_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))}
            className="w-auto"
          />
          <Button variant="secondary" size="sm" onClick={() => void fetchPerformance()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {!loading && sellers.length === 0 && !error && (
        <EmptyState icon={<Users className="w-5 h-5" />} title="Sem dados de performance" description="As métricas aparecem quando houver conversas e deals atribuídas à equipe." />
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <span className="ml-2 text-sm text-slate-400">Calculando performance…</span>
        </div>
      )}

      {!loading && filteredSellers.length > 0 && (
        <div className="space-y-6">
          {/* Filtro por vendedor */}
          {sellers.length > 1 && (
            <Select
              value={selectedSeller}
              onChange={(e) => setSelectedSeller(e.target.value)}
              options={[{ value: 'all', label: 'Todos os vendedores' }, ...sellers.map(s => ({ value: s.sellerId, label: s.sellerName }))]}
              className="w-full sm:w-auto"
            />
          )}

          {filteredSellers.map((seller) => {
            const insights = generateInsights(seller)
            const strengths = insights.filter(i => i.type === 'strength')
            const weaknesses = insights.filter(i => i.type === 'weakness')
            const actions = insights.filter(i => i.type === 'action')

            return (
              <Card key={seller.sellerId} className="overflow-hidden">
                <CardHeader className="bg-slate-900/50 border-b border-slate-800 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-300 font-bold">
                        {seller.sellerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-100">{seller.sellerName}</h2>
                        <p className="text-[10px] text-slate-500">{seller.conversations} conversas · R$ {seller.revenue.toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                    <Badge variant={seller.conversionRate >= 30 ? 'emerald' : seller.conversionRate >= 15 ? 'amber' : 'rose'}>
                      {seller.conversionRate}% conversão
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardBody className="p-0">
                  {/* Grid de Métricas */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 divide-x divide-y divide-slate-800 border-b border-slate-800">
                    {[
                      { label: 'Leads Quentes', value: seller.hotLeads, icon: Target, color: 'text-rose-400' },
                      { label: 'Vendas', value: seller.wonDeals, icon: CheckCircle2, color: 'text-emerald-400' },
                      { label: 'Perdas', value: seller.lostDeals, icon: XCircle, color: 'text-rose-400' },
                      { label: 'Follow-ups Atrasados', value: seller.followUpsOverdue, icon: Clock, color: seller.followUpsOverdue > 0 ? 'text-rose-400' : 'text-slate-500' },
                      { label: 'PIX Solicitados', value: seller.pixRequested, icon: TrendingUp, color: 'text-amber-400' },
                      { label: 'Pagamentos Confirmados', value: seller.paymentsConfirmed, icon: CheckCircle2, color: 'text-emerald-400' },
                    ].map((metric, idx) => (
                      <div key={idx} className="p-3 flex flex-col items-center justify-center text-center gap-1">
                        <metric.icon className={`w-4 h-4 ${metric.color}`} />
                        <span className="text-lg font-bold text-slate-100 tabular-nums">{metric.value}</span>
                        <span className="text-[9px] text-slate-500 uppercase tracking-wide leading-tight">{metric.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Coaching Insights */}
                  <div className="p-4 space-y-3 bg-slate-950/30">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" />
                      Coaching Baseado em Dados
                    </h3>
                    
                    <div className="grid md:grid-cols-3 gap-3">
                      {strengths.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Pontos Fortes</p>
                          {strengths.map((s, i) => (
                            <div key={i} className="text-xs text-slate-300 bg-emerald-950/20 border border-emerald-900/30 p-2 rounded-lg">
                              <p className="font-medium">{s.text}</p>
                              {s.evidence && <p className="text-[10px] text-emerald-500/80 mt-0.5">{s.evidence}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {weaknesses.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-rose-400 font-semibold flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Atenção</p>
                          {weaknesses.map((w, i) => (
                            <div key={i} className="text-xs text-slate-300 bg-rose-950/20 border border-rose-900/30 p-2 rounded-lg">
                              <p className="font-medium">{w.text}</p>
                              {w.evidence && <p className="text-[10px] text-rose-500/80 mt-0.5">{w.evidence}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {actions.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-amber-400 font-semibold flex items-center gap-1"><Target className="w-3 h-3" /> Ações Recomendadas</p>
                          {actions.map((a, i) => (
                            <div key={i} className="text-xs text-slate-300 bg-amber-950/20 border border-amber-900/30 p-2 rounded-lg">
                              <p className="font-medium">{a.text}</p>
                              {a.evidence && <p className="text-[10px] text-amber-500/80 mt-0.5">{a.evidence}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {insights.length === 0 && (
                        <p className="text-xs text-slate-500 col-span-3 italic">Dados insuficientes para gerar insights neste período.</p>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
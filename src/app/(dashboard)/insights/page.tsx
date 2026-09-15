'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Lock } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/components/layout/CurrentUserProvider'

interface InsightRow {
  id: string
  conversationId: string
  dealId: string | null
  status: 'ok' | 'atencao' | 'risco'
  signals: string[]
  summary: string | null
  outcome: 'aberta' | 'ganha' | 'perdida'
  outcomeReason: string | null
  lastAnalyzedAt: string | null
  contactName: string
  contactPhone: string | null
  dealTitle: string | null
  dealValue: number | null
  sellerName: string | null
}

type PeriodFilter = 'all' | '7' | '30' | '90'

const STATUS_BADGE: Record<InsightRow['status'], { variant: 'emerald' | 'amber' | 'rose'; label: string }> = {
  ok: { variant: 'emerald', label: 'Ok' },
  atencao: { variant: 'amber', label: 'Atenção' },
  risco: { variant: 'rose', label: 'Risco' },
}

function formatCurrency(value: number | null): string | null {
  if (value === null) return null
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'agora mesmo'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days}d`
}

export default function InsightsPage() {
  const { role } = useCurrentUser()
  const allowed = role === 'admin' || role === 'manager'

  const [rows, setRows] = useState<InsightRow[]>([])
  // Instante de referência pro filtro de período — fixado junto com cada busca (ver
  // fetchInsights), não recalculado a cada render (isso quebraria a pureza do useMemo
  // que filtra por período logo abaixo).
  const [asOf, setAsOf] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [seller, setSeller] = useState<string>('all')

  const fetchInsights = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const typed = supabase as unknown as {
        auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
        from: (table: string) => {
          select: (columns: string) => {
            eq: (
              column: string,
              value: string
            ) => {
              limit: (n: number) => { maybeSingle: () => Promise<{ data: { organization_id: string } | null }> }
              order: (column: string, opts: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
            }
            in: (column: string, values: string[]) => Promise<{ data: unknown[] | null }>
          }
        }
      }

      const { data: userData } = await typed.auth.getUser()
      if (!userData.user) {
        setError('Não autenticado.')
        setLoading(false)
        return
      }

      const { data: member } = await typed
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userData.user.id)
        .limit(1)
        .maybeSingle()

      if (!member) {
        setError('Organização não encontrada.')
        setLoading(false)
        return
      }

      const { data: insightRows, error: insightError } = await typed
        .from('ai_conversation_insights')
        .select(
          'id, conversation_id, deal_id, status, signals, summary, outcome, outcome_reason, last_analyzed_at, conversations!inner(contact_id, contacts!inner(name, phone))'
        )
        .eq('organization_id', member.organization_id)
        .order('last_analyzed_at', { ascending: false })

      if (insightError) {
        setError('Não foi possível carregar os insights.')
        setLoading(false)
        return
      }

      type RawInsightRow = {
        id: string
        conversation_id: string
        deal_id: string | null
        status: InsightRow['status']
        signals: unknown
        summary: string | null
        outcome: InsightRow['outcome']
        outcome_reason: string | null
        last_analyzed_at: string | null
        conversations: { contact_id: string; contacts: { name: string; phone: string | null } } | null
      }
      const raw = (insightRows || []) as unknown as RawInsightRow[]

      const dealIds = [...new Set(raw.map((r) => r.deal_id).filter((id): id is string => !!id))]
      let dealsById: Record<string, { title: string; value: number | null; assigned_to_id: string | null }> = {}
      let sellerNameById: Record<string, string> = {}

      if (dealIds.length > 0) {
        const { data: deals } = await typed.from('deals').select('id, title, value, assigned_to_id').in('id', dealIds)
        const dealRows = (deals || []) as { id: string; title: string; value: number | null; assigned_to_id: string | null }[]
        dealsById = Object.fromEntries(dealRows.map((d) => [d.id, d]))

        const sellerIds = [...new Set(dealRows.map((d) => d.assigned_to_id).filter((id): id is string => !!id))]
        if (sellerIds.length > 0) {
          const { data: profiles } = await typed.from('profiles').select('id, full_name').in('id', sellerIds)
          const profileRows = (profiles || []) as { id: string; full_name: string }[]
          sellerNameById = Object.fromEntries(profileRows.map((p) => [p.id, p.full_name]))
        }
      }

      const mapped: InsightRow[] = raw
        .filter((r) => r.conversations?.contacts)
        .map((r) => {
          const deal = r.deal_id ? dealsById[r.deal_id] : undefined
          return {
            id: r.id,
            conversationId: r.conversation_id,
            dealId: r.deal_id,
            status: r.status,
            signals: Array.isArray(r.signals) ? (r.signals as string[]) : [],
            summary: r.summary,
            outcome: r.outcome,
            outcomeReason: r.outcome_reason,
            lastAnalyzedAt: r.last_analyzed_at,
            contactName: r.conversations!.contacts.name,
            contactPhone: r.conversations!.contacts.phone,
            dealTitle: deal?.title ?? null,
            dealValue: deal?.value ?? null,
            sellerName: deal?.assigned_to_id ? sellerNameById[deal.assigned_to_id] ?? null : null,
          }
        })

      setRows(mapped)
      setAsOf(Date.now())
    } catch {
      setError('Erro de conexão ao carregar insights.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // setTimeout(0): mesmo truque usado em horario-atendimento/page.tsx pra chamar uma
    // função que faz setState logo de cara (aqui, fetchInsights/setLoading) sem cair no
    // aviso "setState direto dentro de um efeito" do react-hooks — adiar pra próxima
    // volta do loop de eventos não muda nada pro usuário, só destrava o lint.
    const timer = setTimeout(() => {
      if (allowed) void fetchInsights()
      else setLoading(false)
    }, 0)
    return () => clearTimeout(timer)
  }, [allowed, fetchInsights])

  const sellers = useMemo(() => [...new Set(rows.map((r) => r.sellerName).filter((s): s is string => !!s))].sort(), [rows])

  const filtered = useMemo(() => {
    // asOf (e não Date.now() direto aqui dentro) porque useMemo precisa ser puro: mesmo
    // input tem que dar o mesmo resultado. asOf é fixado no momento da busca (ver
    // setAsOf junto de setRows lá em cima) — filtrar por período não precisa de um
    // relógio batendo em tempo real, só de um instante de referência estável.
    const periodMs = period === 'all' ? null : Number(period) * 24 * 60 * 60 * 1000
    return rows.filter((r) => {
      if (seller !== 'all' && r.sellerName !== seller) return false
      if (periodMs !== null) {
        if (!r.lastAnalyzedAt) return false
        if (asOf - new Date(r.lastAnalyzedAt).getTime() > periodMs) return false
      }
      return true
    })
  }, [rows, seller, period, asOf])

  const attention = filtered.filter((r) => r.outcome === 'aberta' && (r.status === 'risco' || r.status === 'atencao'))
  const won = filtered.filter((r) => r.outcome === 'ganha')
  const lost = filtered.filter((r) => r.outcome === 'perdida')

  const topLossReasons = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of lost) {
      if (!r.outcomeReason) continue
      counts.set(r.outcomeReason, (counts.get(r.outcomeReason) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [lost])

  if (!allowed) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <EmptyState
          icon={<Lock className="w-5 h-5" />}
          title="Sem acesso"
          description="Insights de IA mostram desempenho por vendedor(a) — disponível só para administradores e gerentes."
        />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            Insights
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Análise automática por IA das conversas: o que precisa de atenção agora, e o que fechou (ou não) e por quê.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void fetchInsights()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <EmptyState
          icon={<Sparkles className="w-5 h-5" />}
          title="Nenhuma conversa analisada ainda"
          description="As análises aparecem aqui automaticamente conforme as conversas acontecem. Se isto continuar vazio por muito tempo, confirme com quem administra o CRM se a chave da IA (GEMINI_API_KEY) já foi configurada no servidor."
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3">
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
              className="w-auto"
              options={[
                { value: 'all', label: 'Todo o período' },
                { value: '7', label: 'Últimos 7 dias' },
                { value: '30', label: 'Últimos 30 dias' },
                { value: '90', label: 'Últimos 90 dias' },
              ]}
            />
            {sellers.length > 0 && (
              <Select
                value={seller}
                onChange={(e) => setSeller(e.target.value)}
                className="w-auto"
                options={[{ value: 'all', label: 'Todas as vendedoras/vendedores' }, ...sellers.map((s) => ({ value: s, label: s }))]}
              />
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardBody className="space-y-1">
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">Precisam de atenção</p>
                <p className="text-2xl font-bold text-amber-400">{attention.length}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">Ganhas</p>
                <p className="text-2xl font-bold text-emerald-400">{won.length}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">Perdidas</p>
                <p className="text-2xl font-bold text-rose-400">{lost.length}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1">
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">Analisadas</p>
                <p className="text-2xl font-bold text-slate-200">{filtered.length}</p>
              </CardBody>
            </Card>
          </div>

          {topLossReasons.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Motivos de perda mais comuns</h2>
              </CardHeader>
              <CardBody className="space-y-2">
                {topLossReasons.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{reason}</span>
                    <Badge variant="rose">{count}x</Badge>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <InsightSection
            title="Precisam de atenção"
            icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
            rows={attention}
            emptyText="Nada precisando de atenção agora — segue tudo tranquilo."
          />
          <InsightSection
            title="Fechadas — Ganhas"
            icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
            rows={won}
            emptyText="Nenhuma negociação ganha analisada ainda."
          />
          <InsightSection
            title="Fechadas — Perdidas"
            icon={<TrendingDown className="w-4 h-4 text-rose-400" />}
            rows={lost}
            emptyText="Nenhuma negociação perdida analisada ainda."
          />
        </>
      )}
    </div>
  )
}

function InsightSection({
  title,
  icon,
  rows,
  emptyText,
}: {
  title: string
  icon: React.ReactNode
  rows: InsightRow[]
  emptyText: string
}) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        {icon}
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          {title} ({rows.length})
        </h2>
      </CardHeader>
      <CardBody className="p-0 divide-y divide-slate-800/80">
        {rows.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">{emptyText}</p>
        ) : (
          rows.map((r) => (
            <Link
              key={r.id}
              href={`/inbox?conversa=${r.conversationId}`}
              className="block p-4 hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-200 truncate">{r.contactName}</p>
                  {(r.dealTitle || r.sellerName) && (
                    <p className="text-[11px] text-slate-500 truncate">
                      {[r.dealTitle, r.sellerName, formatCurrency(r.dealValue)].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={STATUS_BADGE[r.status].variant}>{STATUS_BADGE[r.status].label}</Badge>
                  <span className="text-[10px] text-slate-500">{formatRelative(r.lastAnalyzedAt)}</span>
                </div>
              </div>
              {(r.outcomeReason || r.summary) && (
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{r.outcomeReason || r.summary}</p>
              )}
              {r.signals.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {r.signals.map((s, i) => (
                    <Badge key={i} variant="slate">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </Link>
          ))
        )}
      </CardBody>
    </Card>
  )
}

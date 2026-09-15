'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Lock, History, Loader2, Send } from 'lucide-react'
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

interface QaEntry {
  question: string
  answer: string
  consideredCount: number
}

type PeriodFilter = 'all' | '7' | '30' | '90'
type StatusFilter = 'all' | 'atencao' | 'risco'
type TabKey = 'attention' | 'won' | 'lost'
const PAGE_SIZE = 20

const STATUS_BADGE: Record<InsightRow['status'], { variant: 'emerald' | 'amber' | 'rose'; label: string }> = {
  ok: { variant: 'emerald', label: 'Ok' },
  atencao: { variant: 'amber', label: 'Atenção' },
  risco: { variant: 'rose', label: 'Risco' },
}

const TABS: { key: TabKey; label: string; icon: typeof AlertTriangle }[] = [
  { key: 'attention', label: 'Precisam de atenção', icon: AlertTriangle },
  { key: 'won', label: 'Ganhas', icon: TrendingUp },
  { key: 'lost', label: 'Perdidas', icon: TrendingDown },
]

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [backfilling, setBackfilling] = useState(false)
  const [backfillProgress, setBackfillProgress] = useState<{ examined: number; analyzed: number } | null>(null)

  // Menu de abas — só uma categoria por vez em vez de 3 listas longas empilhadas, mais
  // fácil de digerir. visibleCount pagina dentro da aba ativa ("carregar mais" em vez de
  // despejar tudo de uma vez); volta pro padrão sempre que a aba ou um filtro muda, pra
  // nunca mostrar "carregar mais" preso numa lista que já trocou de assunto.
  const [activeTab, setActiveTab] = useState<TabKey>('attention')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const resetPaging = () => setVisibleCount(PAGE_SIZE)

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [qaError, setQaError] = useState<string | null>(null)
  const [qaHistory, setQaHistory] = useState<QaEntry[]>([])

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

  // Analisa o histórico: conversas que já existiam antes desta feature entrar no ar nunca
  // passam pela IA sozinhas (o monitoramento normal só reage a mensagem NOVA a partir de
  // agora). Chama /api/ai/backfill-conversations em lotes pequenos, em loop, até `done`
  // — retomável (se a pessoa fechar a aba no meio, um novo clique continua de onde parou,
  // porque a rota só olha conversas que ainda não têm nenhuma análise salva).
  const runBackfill = useCallback(async () => {
    setBackfilling(true)
    setBackfillProgress({ examined: 0, analyzed: 0 })
    setError(null)
    try {
      let cursor: string | null = null
      for (;;) {
        const response = await fetch('/api/ai/backfill-conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor }),
        })
        if (!response.ok) {
          setError('A análise do histórico parou no meio — tente de novo, ela continua de onde ficou.')
          break
        }
        const data = (await response.json()) as { done: boolean; examined: number; analyzed: number; nextCursor: string | null }
        setBackfillProgress((prev) => ({
          examined: (prev?.examined ?? 0) + data.examined,
          analyzed: (prev?.analyzed ?? 0) + data.analyzed,
        }))
        if (data.done) break
        cursor = data.nextCursor
      }
      await fetchInsights()
    } catch {
      setError('Erro de conexão durante a análise do histórico.')
    } finally {
      setBackfilling(false)
    }
  }, [fetchInsights])

  // Barra "Pergunte à IA": manda a pergunta pro servidor, que monta o contexto com TODAS
  // as conversas já analisadas da organização (não só as que estão filtradas na tela) e
  // devolve uma resposta em texto. Histórico fica só na memória desta sessão (não
  // persiste) — é uma conveniência pra comparar perguntas seguidas, não um registro.
  const handleAsk = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const q = question.trim()
      if (!q || asking) return
      setAsking(true)
      setQaError(null)
      try {
        const response = await fetch('/api/ai/ask-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q }),
        })
        const data = (await response.json()) as { answer?: string; consideredCount?: number; error?: string }
        if (!response.ok || !data.answer) {
          setQaError(data.error || 'Não foi possível responder agora.')
          return
        }
        setQaHistory((prev) => [{ question: q, answer: data.answer!, consideredCount: data.consideredCount ?? 0 }, ...prev])
        setQuestion('')
      } catch {
        setQaError('Erro de conexão.')
      } finally {
        setAsking(false)
      }
    },
    [question, asking]
  )

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
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (periodMs !== null) {
        if (!r.lastAnalyzedAt) return false
        if (asOf - new Date(r.lastAnalyzedAt).getTime() > periodMs) return false
      }
      return true
    })
  }, [rows, seller, statusFilter, period, asOf])

  const attention = filtered.filter((r) => r.outcome === 'aberta' && (r.status === 'risco' || r.status === 'atencao'))
  const won = filtered.filter((r) => r.outcome === 'ganha')
  const lost = filtered.filter((r) => r.outcome === 'perdida')
  const activeList = activeTab === 'attention' ? attention : activeTab === 'won' ? won : lost
  const visibleRows = activeList.slice(0, visibleCount)

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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => void runBackfill()} disabled={backfilling || loading}>
            {backfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
            Analisar conversas antigas
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void fetchInsights()} disabled={loading || backfilling}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {backfilling && backfillProgress && (
        <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-3">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
          <span>
            Analisando o histórico… {backfillProgress.examined} conversas examinadas, {backfillProgress.analyzed} analisadas pela IA até
            agora. Pode deixar a tela aberta ou navegar — se fechar no meio, um novo clique continua de onde parou.
          </span>
        </div>
      )}

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
          description="Conversas novas são analisadas automaticamente. Pra ver o histórico (conversas de antes desta tela existir), clique em 'Analisar conversas antigas' acima. Se isto continuar vazio depois disso, confirme se o gateway de IA (OMNIROUTE_BASE_URL) já foi configurado no servidor e está no ar."
          action={
            <Button type="button" size="sm" onClick={() => void runBackfill()} disabled={backfilling}>
              {backfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
              Analisar conversas antigas
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <>
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Pergunte à IA sobre as conversas</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <form onSubmit={(e) => void handleAsk(e)} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ex: quantas vendas fechamos essa semana? quais clientes reclamaram do preço?"
                  className="flex-1 min-w-[200px] px-3.5 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <Button type="submit" size="sm" disabled={asking || !question.trim()}>
                  {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Perguntar
                </Button>
              </form>
              {qaError && <p className="text-xs text-rose-400">{qaError}</p>}
              {qaHistory.length > 0 && (
                <div className="space-y-4 pt-1">
                  {qaHistory.map((qa, i) => (
                    <div key={i} className="space-y-1 border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
                      <p className="text-xs font-semibold text-slate-200">{qa.question}</p>
                      <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{qa.answer}</p>
                      <p className="text-[10px] text-slate-600">baseado em {qa.consideredCount} conversa(s) analisada(s)</p>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as PeriodFilter)
                resetPaging()
              }}
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
                onChange={(e) => {
                  setSeller(e.target.value)
                  resetPaging()
                }}
                className="w-auto"
                options={[{ value: 'all', label: 'Todas as vendedoras/vendedores' }, ...sellers.map((s) => ({ value: s, label: s }))]}
              />
            )}
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter)
                resetPaging()
              }}
              className="w-auto"
              options={[
                { value: 'all', label: 'Todos os status' },
                { value: 'atencao', label: 'Só Atenção' },
                { value: 'risco', label: 'Só Risco' },
              ]}
            />
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

          {/* Menu de abas: uma categoria por vez em vez de 3 listas compridas empilhadas —
              mais fácil de achar o que importa sem rolar a página inteira. */}
          <div className="flex flex-wrap gap-1 bg-[#0f172a] border border-slate-800 rounded-2xl p-1">
            {TABS.map((tab) => {
              const count = tab.key === 'attention' ? attention.length : tab.key === 'won' ? won.length : lost.length
              const Icon = tab.icon
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key)
                    resetPaging()
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label} ({count})
                </button>
              )
            })}
          </div>

          <InsightSection rows={visibleRows} totalCount={activeList.length} emptyText={emptyTextFor(activeTab)} />

          {activeList.length > visibleCount && (
            <div className="flex justify-center">
              <Button type="button" variant="secondary" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Carregar mais ({activeList.length - visibleCount} restantes)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function emptyTextFor(tab: TabKey): string {
  if (tab === 'attention') return 'Nada precisando de atenção agora — segue tudo tranquilo.'
  if (tab === 'won') return 'Nenhuma negociação ganha analisada ainda.'
  return 'Nenhuma negociação perdida analisada ainda.'
}

function InsightSection({ rows, totalCount, emptyText }: { rows: InsightRow[]; totalCount: number; emptyText: string }) {
  return (
    <Card>
      <CardBody className="p-0 divide-y divide-slate-800/80">
        {totalCount === 0 ? (
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

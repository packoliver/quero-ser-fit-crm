'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  User,
  Phone,
  MessageSquare,
  TrendingUp,
  Flame,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Tag,
  ShoppingBag,
  Ruler,
  Palette,
  DollarSign,
} from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'

interface ClientProfile {
  id: string
  name: string
  phone: string | null
  email: string | null
  tags: string[]
  notes: string | null
  created_at: string
}

interface ConversationSummary {
  id: string
  last_message_at: string | null
  status: string
  channel_type: string
}

interface DealSummary {
  id: string
  title: string
  value: number | null
  stage: string
  closed_at: string | null
  is_won: boolean
}

interface InsightSummary {
  lead_score: number | null
  temperature: string | null
  commercial_state: Record<string, unknown> | null
  signals: string[]
  last_analyzed_at: string | null
  next_best_action: string | null
}

interface SignalPreference {
  signal_type: string
  count: number
  last_seen: string
}

export default function Client360Page() {
  const params = useParams()
  const router = useRouter()
  const clientId = params.id as string

  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [deals, setDeals] = useState<DealSummary[]>([])
  const [insight, setInsight] = useState<InsightSummary | null>(null)
  const [preferences, setPreferences] = useState<{
    sizes: SignalPreference[]
    colors: SignalPreference[]
    products: SignalPreference[]
    objections: SignalPreference[]
  }>({ sizes: [], colors: [], products: [], objections: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchClientData = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) { setError('Não autenticado.'); setLoading(false); return }
      const { data: member } = await supabase.from('organization_members')
        .select('organization_id').eq('user_id', userData.user.id).limit(1).maybeSingle()
      if (!member) { setError('Organização não encontrada.'); setLoading(false); return }
      const orgId = member.organization_id

      // Perfil do cliente
      const { data: contact, error: contactErr } = await supabase.from('contacts')
        .select('id, name, phone, email, tags, notes, created_at')
        .eq('organization_id', orgId).eq('id', clientId).single()
      if (contactErr || !contact) { setError('Cliente não encontrado.'); setLoading(false); return }
      setProfile(contact)

      // Conversas
      const { data: convs } = await supabase.from('conversations')
        .select('id, last_message_at, status, channel_type')
        .eq('organization_id', orgId).eq('contact_id', clientId)
        .order('last_message_at', { ascending: false }).limit(50)
      setConversations(convs || [])

      // Deals
      const { data: rawDeals } = await supabase.from('deals')
        .select('id, title, value, stage, closed_at, pipeline_stages!inner(is_won)')
        .eq('organization_id', orgId).eq('contact_id', clientId)
        .order('created_at', { ascending: false }).limit(50)
      const mappedDeals = (rawDeals || []).map((d: any) => ({
        id: d.id, title: d.title, value: d.value, stage: d.stage,
        closed_at: d.closed_at, is_won: d.pipeline_stages?.is_won ?? false,
      }))
      setDeals(mappedDeals)

      // Insight mais recente (agregado de todas as conversas deste contato)
      const convIds = (convs || []).map((c: ConversationSummary) => c.id)
      if (convIds.length > 0) {
        const { data: insights } = await supabase.from('ai_conversation_insights')
          .select('lead_score, temperature, commercial_state, signals, last_analyzed_at, next_best_action')
          .eq('organization_id', orgId).in('conversation_id', convIds)
          .order('last_analyzed_at', { ascending: false }).limit(1).maybeSingle()
        if (insights) {
          setInsight({
            lead_score: insights.lead_score,
            temperature: insights.temperature,
            commercial_state: insights.commercial_state,
            signals: Array.isArray(insights.signals) ? insights.signals.filter((s: unknown) => typeof s === 'string') : [],
            last_analyzed_at: insights.last_analyzed_at,
            next_best_action: insights.next_best_action,
          })
        }

        // Preferências derivadas de sinais (tamanho, cor, produto, objeção)
        const { data: signals } = await supabase.from('commercial_signals')
          .select('signal_type, created_at')
          .eq('organization_id', orgId).in('conversation_id', convIds)
          .is('invalidated_at', null)
          .order('created_at', { ascending: false })

        const sizeMap = new Map<string, { count: number; last: string }>()
        const colorMap = new Map<string, { count: number; last: string }>()
        const productMap = new Map<string, { count: number; last: string }>()
        const objectionMap = new Map<string, { count: number; last: string }>()

        for (const sig of (signals || []) as Array<{ signal_type: string; created_at: string }>) {
          if (sig.signal_type === 'SIZE_SELECTED') {
            const entry = sizeMap.get('Tamanho mencionado') || { count: 0, last: '' }
            entry.count++; entry.last = sig.created_at; sizeMap.set('Tamanho mencionado', entry)
          }
          if (sig.signal_type === 'COLOR_SELECTED') {
            const entry = colorMap.get('Cor mencionada') || { count: 0, last: '' }
            entry.count++; entry.last = sig.created_at; colorMap.set('Cor mencionada', entry)
          }
          if (sig.signal_type === 'PRODUCT_INTEREST') {
            const entry = productMap.get('Interesse em produto') || { count: 0, last: '' }
            entry.count++; entry.last = sig.created_at; productMap.set('Interesse em produto', entry)
          }
          if (sig.signal_type.startsWith('OBJECTION_')) {
            const label = sig.signal_type.replace('OBJECTION_', '').replace(/_/g, ' ').toLowerCase()
            const entry = objectionMap.get(label) || { count: 0, last: '' }
            entry.count++; entry.last = sig.created_at; objectionMap.set(label, entry)
          }
        }

        setPreferences({
          sizes: [...sizeMap.entries()].map(([k, v]) => ({ signal_type: k, count: v.count, last_seen: v.last })),
          colors: [...colorMap.entries()].map(([k, v]) => ({ signal_type: k, count: v.count, last_seen: v.last })),
          products: [...productMap.entries()].map(([k, v]) => ({ signal_type: k, count: v.count, last_seen: v.last })),
          objections: [...objectionMap.entries()].map(([k, v]) => ({ signal_type: k, count: v.count, last_seen: v.last })),
        })
      }
    } catch (err) {
      console.error('[Client360]', err)
      setError('Erro ao carregar dados do cliente.')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    const timer = setTimeout(() => { void fetchClientData() }, 0)
    return () => clearTimeout(timer)
  }, [fetchClientData])

  // Métricas derivadas
  const totalRevenue = deals.filter(d => d.is_won).reduce((sum, d) => sum + (d.value || 0), 0)
  const wonCount = deals.filter(d => d.is_won).length
  const lostCount = deals.filter(d => !d.is_won && d.closed_at).length
  const avgTicket = wonCount > 0 ? Math.round(totalRevenue / wonCount) : 0
  const lastConversation = conversations[0] || null

  if (loading) {
    return (
      <div className="p-4 lg:p-8 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        <span className="ml-2 text-sm text-slate-400">Carregando ficha do cliente…</span>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <Button variant="secondary" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Voltar
        </Button>
        <EmptyState
          icon={<AlertTriangle className="w-5 h-5" />}
          title={error || 'Cliente não encontrado'}
          description="Verifique se o cliente existe ou tente novamente."
        />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="secondary" size="sm" onClick={() => router.back()} className="mt-1 shrink-0">
            <ArrowLeft className="w-3.5 h-3.5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-400" />
              {profile.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400">
              {profile.phone && (
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{profile.phone}</span>
              )}
              {profile.email && (
                <span className="flex items-center gap-1">✉️ {profile.email}</span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />Cliente desde {new Date(profile.created_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
            {profile.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {profile.tags.map((tag, i) => (
                  <Badge key={i} variant="slate"><Tag className="w-2.5 h-2.5 mr-1" />{tag}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        {lastConversation && (
          <Link href={`/inbox?conversa=${lastConversation.id}`}>
            <Button variant="primary" size="sm">
              <MessageSquare className="w-3.5 h-3.5 mr-1" /> Abrir Conversa
            </Button>
          </Link>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardBody className="space-y-1">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Receita Total</p>
          <p className="text-lg font-bold text-emerald-400">{totalRevenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
        </CardBody></Card>
        <Card><CardBody className="space-y-1">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Negócios Ganhos</p>
          <p className="text-lg font-bold text-slate-100">{wonCount}</p>
        </CardBody></Card>
        <Card><CardBody className="space-y-1">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Ticket Médio</p>
          <p className="text-lg font-bold text-slate-100">{avgTicket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
        </CardBody></Card>
        <Card><CardBody className="space-y-1">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Conversas</p>
          <p className="text-lg font-bold text-slate-100">{conversations.length}</p>
        </CardBody></Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Coluna Esquerda: IA + Preferências */}
        <div className="space-y-4 lg:col-span-1">
          {/* Insight Card */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Flame className="w-3.5 h-3.5 text-rose-400" /> Inteligência Comercial
              </h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {!insight ? (
                <p className="text-xs text-slate-500 italic">Sem análise de IA para este cliente ainda.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {insight.temperature && (
                      <Badge variant={insight.temperature === 'QUENTE' ? 'rose' : insight.temperature === 'MORNO' ? 'amber' : 'slate'}>
                        {insight.temperature}
                      </Badge>
                    )}
                    {insight.lead_score !== null && (
                      <span className="text-xs font-mono text-slate-400">Score {insight.lead_score}</span>
                    )}
                  </div>
                  {insight.next_best_action && (
                    <div className="p-2 rounded-lg bg-emerald-950/20 border border-emerald-900/30">
                      <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 mb-0.5">
                        <TrendingUp className="w-3 h-3" /> Próxima Ação
                      </p>
                      <p className="text-xs text-slate-200">{insight.next_best_action}</p>
                    </div>
                  )}
                  {insight.signals.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Sinais recentes</p>
                      <div className="flex flex-wrap gap-1">
                        {insight.signals.slice(0, 8).map((s, i) => (
                          <Badge key={i} variant="slate">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {insight.last_analyzed_at && (
                    <p className="text-[10px] text-slate-600">
                      Última análise: {new Date(insight.last_analyzed_at).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* Preferências (Inferência) */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <ShoppingBag className="w-3.5 h-3.5 text-violet-400" /> Preferências Detectadas
              </h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-[10px] text-slate-500 italic">
                Inferências baseadas em sinais das conversas. Não são fatos confirmados pelo cliente.
              </p>
              {preferences.sizes.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1"><Ruler className="w-3 h-3" /> Tamanhos</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {preferences.sizes.map((p, i) => (
                      <Badge key={i} variant="slate">{p.signal_type} ({p.count}x)</Badge>
                    ))}
                  </div>
                </div>
              )}
              {preferences.colors.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1"><Palette className="w-3 h-3" /> Cores</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {preferences.colors.map((p, i) => (
                      <Badge key={i} variant="slate">{p.signal_type} ({p.count}x)</Badge>
                    ))}
                  </div>
                </div>
              )}
              {preferences.products.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Produtos</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {preferences.products.map((p, i) => (
                      <Badge key={i} variant="slate">{p.signal_type} ({p.count}x)</Badge>
                    ))}
                  </div>
                </div>
              )}
              {preferences.objections.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Objeções</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {preferences.objections.map((p, i) => (
                      <Badge key={i} variant="rose">{p.signal_type} ({p.count}x)</Badge>
                    ))}
                  </div>
                </div>
              )}
              {preferences.sizes.length === 0 && preferences.colors.length === 0 &&
               preferences.products.length === 0 && preferences.objections.length === 0 && (
                <p className="text-xs text-slate-500 italic">Nenhuma preferência detectada nas conversas analisadas.</p>
              )}
            </CardBody>
          </Card>

          {/* Notas */}
          {profile.notes && (
            <Card>
              <CardHeader className="pb-2">
                <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Notas</h2>
              </CardHeader>
              <CardBody>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{profile.notes}</p>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Coluna Direita: Histórico */}
        <div className="space-y-4 lg:col-span-2">
          {/* Deals */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Histórico de Negociações
              </h2>
            </CardHeader>
            <CardBody className="p-0 divide-y divide-slate-800/80">
              {deals.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">Nenhuma negociação registrada.</p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-200 truncate">{deal.title}</p>
                      <p className="text-[10px] text-slate-500">
                        {deal.stage} · {deal.closed_at ? new Date(deal.closed_at).toLocaleDateString('pt-BR') : 'Em andamento'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {deal.value !== null && (
                        <span className="text-xs font-mono text-slate-300">
                          {deal.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </span>
                      )}
                      {deal.is_won ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : deal.closed_at ? (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-400" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          {/* Conversas Recentes */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-blue-400" /> Conversas Recentes
              </h2>
            </CardHeader>
            <CardBody className="p-0 divide-y divide-slate-800/80">
              {conversations.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">Nenhuma conversa registrada.</p>
              ) : (
                conversations.slice(0, 20).map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/inbox?conversa=${conv.id}`}
                    className="block p-3 hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant={conv.channel_type === 'whatsapp' ? 'emerald' : 'indigo'}>
                          {conv.channel_type === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                        </Badge>
                        <span className="text-xs text-slate-300 capitalize">{conv.status}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {conv.last_message_at
                          ? new Date(conv.last_message_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
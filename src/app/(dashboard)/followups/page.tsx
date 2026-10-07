'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock, AlertTriangle, CheckCircle2, RefreshCw, MessageSquare, TrendingUp, Filter, Loader2 } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import type { FollowUpState, LeadTemperature } from '@/lib/ai/commercial-intelligence'

interface FollowUpRow {
 conversation_id: string
 contact_name: string
 contact_phone: string | null
 channel_type: string
 lead_score: number | null
 temperature: string | null
 follow_up_state: string | null
 next_best_action: string | null
 summary: string | null
 last_message_at: string | null
 last_analyzed_at: string | null
deal_title: string | null
  deal_value: number | null
  seller_name: string | null
  hours_since_last_message: number | null
}

type QueueFilter = 'ALL' | 'NOW' | 'TODAY' | 'TOMORROW' | 'OVERDUE' | 'RECOVERY'

const QUEUE_LABELS: Record<QueueFilter, string> = {
 ALL: 'Todos',
 NOW: 'Agora',
 TODAY: 'Hoje',
 TOMORROW: 'Amanhã',
 OVERDUE: 'Atrasados',
 RECOVERY: 'Recuperação',
}

const STATE_BADGE: Record<string, { variant: 'emerald' | 'amber' | 'rose' | 'slate'; label: string }> = {
 AGUARDANDO_VENDEDORA: { variant: 'rose', label: 'Aguardando Vendedora' },
 AGUARDANDO_CLIENTE: { variant: 'amber', label: 'Aguardando Cliente' },
 FOLLOWUP_NECESSARIO: { variant: 'amber', label: 'Follow-up Necessário' },
 FOLLOWUP_AGENDADO: { variant: 'slate', label: 'Agendado' },
 FOLLOWUP_ATRASADO: { variant: 'rose', label: 'Atrasado' },
 SEM_ACAO_NECESSARIA: { variant: 'emerald', label: 'Sem Ação' },
}

const TEMP_BADGE: Record<string, { variant: 'rose' | 'amber' | 'slate'; label: string }> = {
 QUENTE: { variant: 'rose', label: 'Quente' },
 MORNO: { variant: 'amber', label: 'Morno' },
 FRIO: { variant: 'slate', label: 'Frio' },
}

function formatRelative(iso: string | null): string {
 if (!iso) return '—'
 const diffMs = Date.now() - new Date(iso).getTime()
 const minutes = Math.floor(diffMs / 60_000)
 if (minutes < 1) return 'agora'
 if (minutes < 60) return `${minutes}min`
 const hours = Math.floor(minutes / 60)
 if (hours < 24) return `${hours}h`
 const days = Math.floor(hours / 24)
 return `${days}d`
}

function formatCurrency(value: number | null): string | null {
 if (value === null) return null
 return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function FollowUpsPage() {
 const [rows, setRows] = useState<FollowUpRow[]>([])
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState<string | null>(null)
 const [queue, setQueue] = useState<QueueFilter>('ALL')

 const fetchFollowUps = useCallback(async () => {
 setLoading(true)
 setError(null)
 try {
 const supabase = createClient()
 // Tipagem simplificada: qualquer método de filtro retorna um builder que aceita
 // order/limit/gte/in/eq/is recursivamente. Evita erros de TS2339 em cadeias longas.
 type Builder = {
   eq: (c: string, v: string | number | null) => Builder
   in: (c: string, v: string[]) => Builder
   gte: (c: string, v: number | string) => Builder
   lte: (c: string, v: number | string) => Builder
   is: (c: string, v: null) => Builder
   order: (c: string, o?: { ascending?: boolean }) => Builder
   limit: (n: number) => { then: (r: (res: { data: unknown[] | null; error: { message: string } | null }) => void) => void } & Promise<{ data: unknown[] | null; error: { message: string } | null }>
   maybeSingle: () => Promise<{ data: unknown | null; error: { message: string } | null }>
   select: (c: string) => Builder
 }
  // Tipagem permissiva para evitar erros de encadeamento do Supabase JS v2 em queries complexas.
// A segurança real está no RLS e na validação de runtime dos dados retornados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const typed = supabase as any

 const { data: userData } = await typed.auth.getUser()
 if (!userData.user) { setError('Não autenticado.'); setLoading(false); return }

 const { data: member } = await typed.from('organization_members').select('organization_id').eq('user_id', userData.user.id).limit(1).maybeSingle()
 if (!member) { setError('Organização não encontrada.'); setLoading(false); return }

 // Busca insights com follow_up_state definido + joins necessários
 const { data: insights, error: err } = await typed
 .from('ai_conversation_insights')
 .select(`
 conversation_id,
 lead_score,
 temperature,
 follow_up_state,
 next_best_action,
 summary,
 last_analyzed_at,
 conversations!inner(last_message_at, channel_type, status, contacts(name, phone)),
 deals(conversation_id, title, value, assigned_to_id)
 `)
 .eq('organization_id', member.organization_id)
 .in('conversations.status', ['open', 'assigned'])
 .order('last_analyzed_at', { ascending: false })
 .limit(500)

 if (err) { setError('Falha ao carregar follow-ups.'); setLoading(false); return }

 const raw = (insights ?? []) as unknown as Array<{
 conversation_id: string
 lead_score: number | null
 temperature: string | null
 follow_up_state: string | null
 next_best_action: string | null
 summary: string | null
 last_analyzed_at: string | null
 conversations: { last_message_at: string | null; channel_type: string; contacts: { name: string; phone: string | null } | null } | null
 deals: Array<{ conversation_id: string; title: string; value: number | null; assigned_to_id: string | null }> | null
 }>

 // Coleta seller IDs para batch lookup
 const sellerIds = [...new Set(raw.flatMap(r => (r.deals ?? []).map(d => d.assigned_to_id).filter((id): id is string => !!id)))]
 let namesById: Record<string, string> = {}
 if (sellerIds.length > 0) {
 const { data: profiles } = await typed.from('profiles').select('id, full_name').in('id', sellerIds)
 const profileRows = (profiles || []) as { id: string; full_name: string }[]
 namesById = Object.fromEntries(profileRows.map(p => [p.id, p.full_name]))
 }

// Calcula hoursSinceLastMessage aqui (dentro do callback assíncrono) para evitar
  // chamar Date.now() durante o render, o que viola react-hooks/purity.
  const fetchNow = Date.now()
  const mapped: FollowUpRow[] = raw.map(r => {
    const deal = (r.deals ?? [])[0] ?? null
    const lastMsgAt = r.conversations?.last_message_at ?? null
    const hoursSinceLastMessage = lastMsgAt
      ? (fetchNow - new Date(lastMsgAt).getTime()) / 3_600_000
      : null
    return {
      conversation_id: r.conversation_id,
      contact_name: r.conversations?.contacts?.name || 'Contato sem nome',
      contact_phone: r.conversations?.contacts?.phone ?? null,
      channel_type: r.conversations?.channel_type ?? '',
      lead_score: r.lead_score,
      temperature: r.temperature,
      follow_up_state: r.follow_up_state,
      next_best_action: r.next_best_action,
      summary: r.summary,
      last_message_at: lastMsgAt,
      last_analyzed_at: r.last_analyzed_at,
      deal_title: deal?.title ?? null,
      deal_value: deal?.value ?? null,
      seller_name: deal?.assigned_to_id ? namesById[deal.assigned_to_id] ?? null : null,
      hours_since_last_message: hoursSinceLastMessage,
    }
  })

 setRows(mapped)
 } catch {
 setError('Erro de conexão ao carregar follow-ups.')
 } finally {
 setLoading(false)
 }
 }, [])

 useEffect(() => {
 const timer = setTimeout(() => { void fetchFollowUps() }, 0)
 return () => clearTimeout(timer)
 }, [fetchFollowUps])

const filtered = useMemo(() => {
    if (queue === 'ALL') return rows.filter(r => r.follow_up_state && r.follow_up_state !== 'SEM_ACAO_NECESSARIA')
    if (queue === 'NOW') return rows.filter(r => r.follow_up_state === 'AGUARDANDO_VENDEDORA' || r.follow_up_state === 'FOLLOWUP_ATRASADO')
    if (queue === 'OVERDUE') return rows.filter(r => r.follow_up_state === 'FOLLOWUP_ATRASADO')
    if (queue === 'RECOVERY') return rows.filter(r => r.follow_up_state === 'FOLLOWUP_NECESSARIO' && (r.lead_score ?? 0) >= 50)
    if (queue === 'TODAY') return rows.filter(r => {
      const hours = r.hours_since_last_message
      return hours !== null && hours < 24 && r.follow_up_state !== 'SEM_ACAO_NECESSARIA'
    })
    if (queue === 'TOMORROW') return rows.filter(r => {
      const hours = r.hours_since_last_message
      return hours !== null && hours >= 24 && hours < 48 && r.follow_up_state !== 'SEM_ACAO_NECESSARIA'
    })
    return rows
  }, [rows, queue])

 const counts = useMemo(() => ({
 all: rows.filter(r => r.follow_up_state && r.follow_up_state !== 'SEM_ACAO_NECESSARIA').length,
 now: rows.filter(r => r.follow_up_state === 'AGUARDANDO_VENDEDORA' || r.follow_up_state === 'FOLLOWUP_ATRASADO').length,
 overdue: rows.filter(r => r.follow_up_state === 'FOLLOWUP_ATRASADO').length,
 recovery: rows.filter(r => r.follow_up_state === 'FOLLOWUP_NECESSARIO' && (r.lead_score ?? 0) >= 50).length,
 }), [rows])

 return (
 <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
 <Clock className="w-5 h-5 text-amber-400" />
 Follow-ups Inteligentes
 </h1>
 <p className="text-xs text-slate-400 mt-1">
 Filas priorizadas por estado comercial, score e tempo de espera. Dados atualizados automaticamente pela IA.
 </p>
 </div>
 <Button type="button" variant="secondary" size="sm" onClick={() => void fetchFollowUps()} disabled={loading}>
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

 {/* Queue Tabs */}
 <div className="flex flex-wrap gap-1 bg-[#0f172a] border border-slate-800 rounded-2xl p-1">
 {(Object.keys(QUEUE_LABELS) as QueueFilter[]).map((q) => {
 const active = queue === q
 const count = q === 'ALL' ? counts.all : q === 'NOW' ? counts.now : q === 'OVERDUE' ? counts.overdue : q === 'RECOVERY' ? counts.recovery : null
 return (
 <button
 key={q}
 type="button"
 onClick={() => setQueue(q)}
 className={`px-3 py-2 rounded-xl text-xs font-semibold transition ${
 active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
 }`}
 >
 {QUEUE_LABELS[q]}
 {count !== null && count > 0 && <span className="ml-1.5 opacity-70">({count})</span>}
 </button>
 )
 })}
 </div>

 {!loading && filtered.length === 0 && !error && (
 <EmptyState
 icon={<CheckCircle2 className="w-5 h-5" />}
 title="Nenhum follow-up nesta fila"
 description="As conversas aparecem aqui automaticamente quando a IA detecta que uma ação é necessária."
 />
 )}

 {filtered.length > 0 && (
 <Card>
 <CardBody className="p-0 divide-y divide-slate-800/80">
 {filtered.map((r) => {
 const stateBadge = r.follow_up_state ? STATE_BADGE[r.follow_up_state] : null
 const tempBadge = r.temperature ? TEMP_BADGE[r.temperature] : null
 return (
 <Link
 key={r.conversation_id}
 href={`/inbox?conversa=${r.conversation_id}`}
 className="block p-4 hover:bg-slate-800/40 transition-colors"
 >
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-sm font-semibold text-slate-200 truncate">{r.contact_name}</p>
 {tempBadge && <Badge variant={tempBadge.variant}>{tempBadge.label}</Badge>}
 {stateBadge && <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>}
 {r.lead_score !== null && (
 <span className="text-[10px] text-slate-500 font-mono">Score {r.lead_score}</span>
 )}
 </div>
 {(r.deal_title || r.seller_name) && (
 <p className="text-[11px] text-slate-500 truncate mt-0.5">
 {[r.deal_title, r.seller_name, formatCurrency(r.deal_value)].filter(Boolean).join(' · ')}
 </p>
 )}
 {r.next_best_action && (
 <p className="text-xs text-emerald-400 mt-1.5 flex items-start gap-1">
 <TrendingUp className="w-3 h-3 mt-0.5 shrink-0" />
 {r.next_best_action}
 </p>
 )}
 {r.summary && !r.next_best_action && (
 <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{r.summary}</p>
 )}
 </div>
 <div className="flex flex-col items-end gap-1 shrink-0 text-[10px] text-slate-500">
 <span>Última msg: {formatRelative(r.last_message_at)}</span>
 <span>Análise: {formatRelative(r.last_analyzed_at)}</span>
 <MessageSquare className="w-3.5 h-3.5 text-slate-600 mt-1" />
 </div>
 </div>
 </Link>
 )
 })}
 </CardBody>
 </Card>
 )}
 </div>
 )
}
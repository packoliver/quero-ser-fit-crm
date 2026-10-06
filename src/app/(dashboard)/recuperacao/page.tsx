'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, AlertTriangle, TrendingUp, MessageSquare, Loader2, Flame, Clock, Target } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { RecoveryPriority, LeadTemperature } from '@/lib/ai/commercial-intelligence'

interface RecoveryRow {
 conversationId: string
 contactName: string
 contactPhone: string | null
 channelType: string
 leadScore: number
 temperature: LeadTemperature
 priority: RecoveryPriority
 lastMessageAt: string | null
 lastAnalyzedAt: string | null
 nextBestAction: string | null
 summary: string | null
 reason: 'cold_lead' | 'stale_analysis' | 'no_follow_up_task'
 hoursSinceLastMessage: number | null
 dealTitle: string | null
 dealValue: number | null
}

type PriorityFilter = 'ALL' | 'ALTA' | 'MEDIA' | 'BAIXA'

const PRIORITY_BADGE: Record<RecoveryPriority, { variant: 'rose' | 'amber' | 'slate'; label: string }> = {
 ALTA: { variant: 'rose', label: 'Alta Prioridade' },
 MEDIA: { variant: 'amber', label: 'Média' },
 BAIXA: { variant: 'slate', label: 'Baixa' },
}

const TEMP_BADGE: Record<LeadTemperature, { variant: 'rose' | 'amber' | 'slate'; label: string }> = {
 QUENTE: { variant: 'rose', label: 'Quente' },
 MORNO: { variant: 'amber', label: 'Morno' },
 FRIO: { variant: 'slate', label: 'Frio' },
}

const REASON_LABEL: Record<RecoveryRow['reason'], string> = {
 cold_lead: 'Lead esfriando',
 stale_analysis: 'Análise parada',
 no_follow_up_task: 'Sem follow-up criado',
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

export default function RecuperacaoPage() {
 const [rows, setRows] = useState<RecoveryRow[]>([])
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState<string | null>(null)
 const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL')

 const fetchOpportunities = useCallback(async () => {
 setLoading(true)
 setError(null)
 try {
 const response = await fetch('/api/ai/recovery-opportunities', { cache: 'no-store' })
 const data = await response.json() as { opportunities?: RecoveryRow[]; error?: string }
 if (!response.ok || !data.opportunities) {
 setError(data.error || 'Não foi possível carregar oportunidades.')
 return
 }
 setRows(data.opportunities)
 } catch {
 setError('Erro de conexão ao carregar oportunidades.')
 } finally {
 setLoading(false)
 }
 }, [])

 useEffect(() => {
 const timer = setTimeout(() => { void fetchOpportunities() }, 0)
 return () => clearTimeout(timer)
 }, [fetchOpportunities])

 const filtered = useMemo(() => {
 if (priorityFilter === 'ALL') return rows
 return rows.filter((r) => r.priority === priorityFilter)
 }, [rows, priorityFilter])

 const counts = useMemo(() => ({
 all: rows.length,
 alta: rows.filter((r) => r.priority === 'ALTA').length,
 media: rows.filter((r) => r.priority === 'MEDIA').length,
 baixa: rows.filter((r) => r.priority === 'BAIXA').length,
 }), [rows])

 return (
 <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
 <Target className="w-5 h-5 text-rose-400" />
 Central de Recuperação
 </h1>
 <p className="text-xs text-slate-400 mt-1">
 Leads com intenção de compra que pararam de responder ou não receberam follow-up. Ordenados por prioridade e score.
 </p>
 </div>
 <Button type="button" variant="secondary" size="sm" onClick={() => void fetchOpportunities()} disabled={loading}>
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

 {/* Priority Tabs */}
 <div className="flex flex-wrap gap-1 bg-[#0f172a] border border-slate-800 rounded-2xl p-1">
 {(['ALL', 'ALTA', 'MEDIA', 'BAIXA'] as PriorityFilter[]).map((p) => {
 const active = priorityFilter === p
 const count = p === 'ALL' ? counts.all : p === 'ALTA' ? counts.alta : p === 'MEDIA' ? counts.media : counts.baixa
 const label = p === 'ALL' ? 'Todas' : p === 'ALTA' ? 'Alta Prioridade' : p === 'MEDIA' ? 'Média' : 'Baixa'
 return (
 <button
 key={p}
 type="button"
 onClick={() => setPriorityFilter(p)}
 className={`px-3 py-2 rounded-xl text-xs font-semibold transition ${
 active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
 }`}
 >
 {label}
 {count > 0 && <span className="ml-1.5 opacity-70">({count})</span>}
 </button>
 )
 })}
 </div>

 {!loading && filtered.length === 0 && !error && (
 <EmptyState
 icon={<Flame className="w-5 h-5" />}
 title="Nenhuma oportunidade de recuperação agora"
 description="Conversas com sinais positivos e sem follow-up recente aparecem aqui automaticamente."
 />
 )}

 {filtered.length > 0 && (
 <Card>
 <CardBody className="p-0 divide-y divide-slate-800/80">
 {filtered.map((r) => {
 const prioBadge = PRIORITY_BADGE[r.priority]
 const tempBadge = TEMP_BADGE[r.temperature]
 return (
 <Link
 key={r.conversationId}
 href={`/inbox?conversa=${r.conversationId}`}
 className="block p-4 hover:bg-slate-800/40 transition-colors"
 >
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-sm font-semibold text-slate-200 truncate">{r.contactName}</p>
 <Badge variant={prioBadge.variant}>{prioBadge.label}</Badge>
 <Badge variant={tempBadge.variant}>{tempBadge.label}</Badge>
 <span className="text-[10px] text-slate-500 font-mono">Score {r.leadScore}</span>
 </div>
 {(r.dealTitle || r.hoursSinceLastMessage !== null) && (
 <p className="text-[11px] text-slate-500 truncate mt-0.5">
 {[r.dealTitle, r.hoursSinceLastMessage !== null ? `${r.hoursSinceLastMessage}h sem resposta` : null, formatCurrency(r.dealValue)].filter(Boolean).join(' · ')}
 </p>
 )}
 <p className="text-[11px] text-rose-400 mt-1 flex items-center gap-1">
 <Clock className="w-3 h-3 shrink-0" />
 {REASON_LABEL[r.reason]}
 </p>
 {r.nextBestAction && (
 <p className="text-xs text-emerald-400 mt-1.5 flex items-start gap-1">
 <TrendingUp className="w-3 h-3 mt-0.5 shrink-0" />
 {r.nextBestAction}
 </p>
 )}
 {r.summary && !r.nextBestAction && (
 <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{r.summary}</p>
 )}
 </div>
 <div className="flex flex-col items-end gap-1 shrink-0 text-[10px] text-slate-500">
 <span>Última msg: {formatRelative(r.lastMessageAt)}</span>
 <span>Análise: {formatRelative(r.lastAnalyzedAt)}</span>
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
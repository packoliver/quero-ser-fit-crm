'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  MessageSquare,
  Clock,
  TrendingUp,
  Users,
  CheckCircle2,
  Sparkles,
  Database,
  RefreshCw,
  UserCheck,
  Inbox,
  Award,
  CheckCircle,
  Timer,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { cacheEntity, readCachedEntity } from '@/lib/offline/repository'
import { getOfflineScope } from '@/lib/offline/scope'
import { SLA_BREACH_MINUTES, formatMinutes, computeSlaMetrics } from '@/lib/sla'

export interface RealMetrics {
  totalContacts: number
  pendingTasks: number
  completedTasks: number
  openConversations: number
  /** Média (minutos) entre a primeira mensagem do cliente e a primeira resposta da
   * equipe, por conversa — só conta conversas que já foram respondidas ao menos uma vez.
   * Null quando não há dado suficiente ainda (org nova, ou nenhuma conversa respondida). */
  avgFirstResponseMinutes: number | null
  /** Conversas com a ÚLTIMA mensagem vinda do cliente há mais de SLA_BREACH_MINUTES,
   * ou seja, esperando resposta agora mesmo além do prazo. */
  slaBreachedCount: number
}

export interface RealAttendantPerformance {
  id: string
  name: string
  role: 'admin' | 'manager' | 'attendant'
  assignedConvs: number
  completedTasks: number
}

export default function RelatoriosPage() {
  const { db, isLoaded } = useDemoStorage()
  const [viewMode, setViewMode] = useState<'demo' | 'real'>('real')
  const [realMetrics, setRealMetrics] = useState<RealMetrics>({
    totalContacts: 0,
    pendingTasks: 0,
    completedTasks: 0,
    openConversations: 0,
    avgFirstResponseMinutes: null,
    slaBreachedCount: 0,
  })
  const [realAttendantPerformance, setRealAttendantPerformance] = useState<RealAttendantPerformance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Calculations extracted directly from db in real-time
  const totalContacts = db.contacts.length
  const newLeads = db.contacts.filter((c) =>
    (c.tags || []).some((t) => t.toLowerCase().includes('lead') || t.toLowerCase().includes('novo'))
  ).length

  const pendingTasks = db.tasks.filter((t) => t.status === 'pending').length
  const completedTasks = db.tasks.filter((t) => t.status === 'completed').length
  const totalTasks = pendingTasks + completedTasks
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  const unassignedQueueConversations = db.conversations.filter(
    (c) => c.status === 'open' && !c.currentAssigneeId
  ).length
  const activeConversations = db.conversations.filter(
    (c) => c.currentAssigneeId !== null
  ).length

  const activeTeamMembers = db.members.filter((m) => m.status === 'active').length

  // Attendant Performance derived dynamically from db
  const attendantPerformance = db.members.map((m) => {
    const assignedConvs = db.conversations.filter((c) => c.currentAssigneeId === m.id).length
    const assignedTasks = db.tasks.filter((t) => t.assigneeId === m.id && t.status === 'completed').length
    return {
      id: m.id,
      name: m.fullName,
      role: m.role,
      status: m.status,
      assignedConvs,
      completedTasks: assignedTasks,
    }
  })

  const fetchRealMetrics = useCallback(async () => {
    setLoading(true)
    const offlineScope = await getOfflineScope().catch(() => null)
    if (!navigator.onLine && offlineScope) {
      const cached = await readCachedEntity<{ metrics: RealMetrics; performance: RealAttendantPerformance[] }>(offlineScope, 'reports')
      if (cached) {
        setRealMetrics(cached.metrics)
        setRealAttendantPerformance(cached.performance)
        setError('Você está offline. Estes indicadores podem estar desatualizados.')
      } else {
        setError('Sem conexão e sem indicadores armazenados neste dispositivo.')
      }
      setLoading(false)
      return
    }
    try {
      const supabase = createClient()

      const [contactsRes, pendingTasksRes, completedTasksRes, convRes] = await Promise.all([
        (supabase as unknown as { from: (t: string) => { select: (c: string, o: { count: string; head: boolean }) => Promise<{ count: number | null }> } }).from('contacts').select('*', { count: 'exact', head: true }),
        (supabase as unknown as { from: (t: string) => { select: (c: string, o: { count: string; head: boolean }) => { neq: (col: string, val: string) => Promise<{ count: number | null }> } } }).from('tasks').select('*', { count: 'exact', head: true }).neq('status', 'completed'),
        (supabase as unknown as { from: (t: string) => { select: (c: string, o: { count: string; head: boolean }) => { eq: (col: string, val: string) => Promise<{ count: number | null }> } } }).from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        (supabase as unknown as { from: (t: string) => { select: (c: string, o: { count: string; head: boolean }) => { eq: (col: string, val: string) => Promise<{ count: number | null }> } } }).from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      ])

      setRealMetrics((prev) => ({
        ...prev,
        totalContacts: contactsRes.count || 0,
        pendingTasks: pendingTasksRes.count || 0,
        completedTasks: completedTasksRes.count || 0,
        openConversations: convRes.count || 0,
      }))

      // Real per-attendant performance: org members joined with their assigned
      // conversations and completed tasks, computed client-side (small org sizes).
      const typed = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => Promise<{ data: unknown[] | null }>
        }
      }

      const [membersRes, allConvRes, completedTaskRowsRes, messagesForSlaRes] = await Promise.all([
        typed.from('organization_members').select('user_id, role, profiles(full_name)'),
        typed.from('conversations').select('current_assignee_id'),
        typed.from('tasks').select('assigned_to_id, status'),
        // Só o necessário pra calcular SLA (não o conteúdo da mensagem) — ordenado
        // cronologicamente logo abaixo (computeSlaMetrics depende da ordem pra achar a
        // primeira resposta de cada conversa).
        typed.from('messages').select('conversation_id, sender_type, created_at'),
      ])

      const membersData = (membersRes.data || []) as Array<{
        user_id: string
        role: 'admin' | 'manager' | 'attendant'
        profiles: { full_name: string | null } | null
      }>
      const convData = (allConvRes.data || []) as Array<{ current_assignee_id: string | null }>
      const taskData = (completedTaskRowsRes.data || []) as Array<{ assigned_to_id: string | null; status: string }>
      const slaMessages = (messagesForSlaRes.data || []) as Array<{
        conversation_id: string
        sender_type: 'contact' | 'user' | 'system'
        created_at: string
      }>
      slaMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      const { avgFirstResponseMinutes, slaBreachedCount } = computeSlaMetrics(slaMessages)

      const performance = membersData.map((m) => ({
        id: m.user_id,
        name: m.profiles?.full_name || 'Membro',
        role: m.role,
        assignedConvs: convData.filter((c) => c.current_assignee_id === m.user_id).length,
        completedTasks: taskData.filter((t) => t.assigned_to_id === m.user_id && t.status === 'completed').length,
      }))
      setRealAttendantPerformance(performance)
      setRealMetrics((prev) => ({ ...prev, avgFirstResponseMinutes, slaBreachedCount }))
      if (offlineScope) await cacheEntity(offlineScope, 'reports', { metrics: { totalContacts: contactsRes.count || 0, pendingTasks: pendingTasksRes.count || 0, completedTasks: completedTasksRes.count || 0, openConversations: convRes.count || 0, avgFirstResponseMinutes, slaBreachedCount }, performance })
    } catch {
      const cached = offlineScope ? await readCachedEntity<{ metrics: RealMetrics; performance: RealAttendantPerformance[] }>(offlineScope, 'reports').catch(() => null) : null
      if (cached) {
        setRealMetrics(cached.metrics)
        setRealAttendantPerformance(cached.performance)
        setError('Não foi possível atualizar. Exibindo indicadores sincronizados anteriormente.')
      } else {
        setViewMode('demo')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchRealMetrics()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchRealMetrics])

  // Skeleton Loading State for SSR Hydration Safety
  if (!isLoaded) {
    return (
      <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-8 w-64 bg-slate-800 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-[#0f172a] border border-slate-800 rounded-2xl p-4" />
          ))}
        </div>
        <div className="h-40 bg-[#0f172a] border border-slate-800 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-100">Relatórios e Métricas de Atendimento</h1>
            {viewMode === 'real' ? (
              <Badge variant="emerald" icon={<Database className="w-3 h-3" />}>
                Supabase Real
              </Badge>
            ) : (
              <Badge variant="amber" icon={<Sparkles className="w-3 h-3" />}>
                Modo Demonstração Dinâmico
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Indicadores calculados dinamicamente em tempo real com base no armazenamento ativo do CRM.
          </p>
          {error && <p role="status" className="text-xs text-amber-300 mt-2">{error}</p>}
        </div>

        <div className="flex items-center gap-2">
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex text-xs">
              <button
                onClick={() => {
                  setViewMode('real')
                  void fetchRealMetrics()
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  viewMode === 'real' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dados Reais
              </button>
              <button
                onClick={() => setViewMode('demo')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  viewMode === 'demo' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Modo Demo
              </button>
            </div>
          )}

          {viewMode === 'real' && (
            <Button variant="secondary" onClick={fetchRealMetrics}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </div>

      {/* Primary KPI Cards Grid — neutro por padrão (rótulo + ícone discreto + número em
          branco), cor só entra quando o número em si representa um alerta de verdade
          (SLA estourado). Antes cada card tinha uma cor de "decoração" diferente sem
          nenhum significado — a versão de painel de verdade reserva cor pra estado real. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {viewMode === 'real' ? (
          <>
            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Users className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Total de Clientes</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{realMetrics.totalContacts}</p>
              <p className="text-[11px] text-slate-500">Cadastrados no Supabase</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Tarefas Pendentes</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{realMetrics.pendingTasks}</p>
              <p className="text-[11px] text-slate-500">Aguardando atendimento</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <CheckCircle className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Tarefas Concluídas</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{realMetrics.completedTasks}</p>
              <p className="text-[11px] text-slate-500">Resoluções finalizadas</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Conversas em Fila</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{realMetrics.openConversations}</p>
              <p className="text-[11px] text-slate-500">Aguardando atribuição</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Timer className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Tempo Médio de 1ª Resposta</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">
                {realMetrics.avgFirstResponseMinutes === null ? '-' : formatMinutes(realMetrics.avgFirstResponseMinutes)}
              </p>
              <p className="text-[11px] text-slate-500">Do 1º contato à 1ª resposta da equipe</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className={`flex items-center gap-1.5 ${realMetrics.slaBreachedCount > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">SLA Estourado</span>
              </div>
              <p className={`text-2xl font-bold font-mono tabular-nums ${realMetrics.slaBreachedCount > 0 ? 'text-rose-400' : 'text-slate-100'}`}>
                {realMetrics.slaBreachedCount}
              </p>
              <p className="text-[11px] text-slate-500">Esperando resposta há mais de {SLA_BREACH_MINUTES}min</p>
            </Card>
          </>
        ) : (
          <>
            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Users className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Total de Clientes</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{totalContacts}</p>
              <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> {newLeads} novo(s) lead(s)
              </p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Tarefas Pendentes</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{pendingTasks}</p>
              <p className="text-[11px] text-slate-500">{completedTasks} tarefas concluídas</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Inbox className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Fila de Espera (Inbox)</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{unassignedQueueConversations}</p>
              <p className="text-[11px] text-slate-500">{activeConversations} atendimentos em andamento</p>
            </Card>

            <Card className="p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-500">
                <UserCheck className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wide">Membros de Equipe Ativos</span>
              </div>
              <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">{activeTeamMembers}</p>
              <p className="text-[11px] text-slate-500">Equipe pronta no sistema</p>
            </Card>
          </>
        )}
      </div>

      {/* Task Completion Progress Bar Section */}
      {viewMode === 'demo' && (
        <Card className="p-5 space-y-3 bg-[#0f172a] border border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-100">Taxa de Conclusão de Tarefas da Equipe</h2>
            </div>
            <span className="text-xs font-extrabold text-emerald-400 font-mono">{taskCompletionRate}% Concluído</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-900 rounded-full h-3 border border-slate-800 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-500 ease-out"
              style={{ width: `${taskCompletionRate}%` }}
            />
          </div>

          <div className="flex justify-between text-[11px] text-slate-400 pt-1">
            <span>Concluídas: {completedTasks}</span>
            <span>Pendentes: {pendingTasks}</span>
            <span>Total: {totalTasks}</span>
          </div>
        </Card>
      )}

      {/* Attendant Performance Table Card */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-400" />
            <span>Desempenho por Atendente da Equipe (Dinâmico)</span>
          </h2>
          <Badge variant={viewMode === 'real' ? 'emerald' : 'slate'} icon={viewMode === 'real' ? <Database className="w-3 h-3" /> : undefined}>
            {viewMode === 'real' ? 'Atualizado via Supabase' : 'Atualizado via DemoStorage'}
          </Badge>
        </CardHeader>

        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                  <th className="py-3 px-4">Atendente</th>
                  <th className="py-3 px-4">Perfil</th>
                  {viewMode === 'demo' && <th className="py-3 px-4">Status</th>}
                  <th className="py-3 px-4">Conversas Atribuídas</th>
                  <th className="py-3 px-4">Tarefas Concluídas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {viewMode === 'real'
                  ? realAttendantPerformance.map((att) => (
                      <tr key={att.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3.5 px-4 font-semibold text-slate-100">{att.name}</td>
                        <td className="py-3.5 px-4">
                          <Badge variant={att.role === 'admin' ? 'emerald' : att.role === 'manager' ? 'indigo' : 'teal'}>
                            {att.role === 'admin' ? 'Admin' : att.role === 'manager' ? 'Gerente' : 'Atendente'}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-200">{att.assignedConvs}</td>
                        <td className="py-3.5 px-4 font-bold text-emerald-400">{att.completedTasks}</td>
                      </tr>
                    ))
                  : attendantPerformance.map((att) => (
                      <tr key={att.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3.5 px-4 font-semibold text-slate-100">{att.name}</td>
                        <td className="py-3.5 px-4">
                          <Badge variant={att.role === 'admin' ? 'emerald' : 'teal'}>
                            {att.role === 'admin' ? 'Admin' : 'Atendente'}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4">
                          {att.status === 'active' ? (
                            <span className="text-emerald-400 font-semibold">Ativo</span>
                          ) : (
                            <span className="text-amber-400 font-semibold">Pendente</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-200">{att.assignedConvs}</td>
                        <td className="py-3.5 px-4 font-bold text-emerald-400">{att.completedTasks}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

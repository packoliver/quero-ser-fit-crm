'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  CheckSquare,
  MessageSquare,
  Plus,
  Clock,
  User,
  CheckCircle2,
  Sparkles,
  Database,
  AlertCircle,
  RefreshCw,
  Pencil,
  Trash2,
  Filter,
  X,
  AlertTriangle,
} from 'lucide-react'
import { DemoTask } from '@/lib/demo'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Toast } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/client'
import { cacheEntity, readCachedEntity, queueEntityMutation } from '@/lib/offline/repository'
import { getOfflineScope } from '@/lib/offline/scope'
import { TaskStatus } from '@/types/database'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { taskTimeBucket, type TaskTimeBucket } from '@/lib/tasks/buckets'

export interface RealTask {
  id: string
  title: string
  description: string | null
  due_date: string | null
  status: TaskStatus
  priority: 'alta' | 'media' | 'baixa' | null
  assigned_to_id: string | null
  contact_id: string | null
  /** Conversa de origem, quando a tarefa nasceu dentro de um atendimento — permite voltar
   * direto pro contexto em vez de procurar o cliente na lista. Coluna que já existia na
   * tabela `tasks` e simplesmente não estava sendo lida. */
  conversation_id: string | null
  /** Flattened from the joined `profiles`/`contacts` rows at fetch time — never sent back on write. */
  assignee_name: string | null
  contact_name: string | null
  created_at: string
}

interface RealTeamMemberOption {
  id: string
  fullName: string
}

interface RealContactOption {
  id: string
  name: string
}

function getAssigneeDisplay(task: RealTask | DemoTask): string {
  return 'assigneeName' in task ? task.assigneeName : task.assignee_name || 'Sem responsável'
}

function getClientDisplay(task: RealTask | DemoTask): string | null {
  return 'clientName' in task ? task.clientName : task.contact_name
}

/** Ponte pro cálculo puro em @/lib/tasks/buckets — só o modo real tem data de verdade; no
 * modo de demonstração `dueDate` é texto de exibição ("Hoje, 15:00"), sem informação
 * suficiente pra comparar com hoje, então cai no padrão "Próximas". */
function bucketOf(task: RealTask | DemoTask): TaskTimeBucket {
  return taskTimeBucket({ status: task.status, due_date: 'due_date' in task ? task.due_date : null })
}

const safeToISOString = (dateVal: string | null | undefined): string | null => {
  if (!dateVal || !dateVal.trim()) return null
  try {
    const parsed = new Date(dateVal)
    return isNaN(parsed.getTime()) ? null : parsed.toISOString()
  } catch {
    return null
  }
}

export default function TarefasPage() {
  const {
    tasks: storedDemoTasks,
    members: storedDemoMembers,
    addTask: saveDemoTask,
    updateTaskStatus: updateDemoTaskStatus,
    updateTask: updateDemoTask,
    deleteTask: deleteDemoTask,
  } = useDemoStorage()

  const [viewMode, setViewMode] = useState<'demo' | 'real'>('real')
  const [realTasks, setRealTasks] = useState<RealTask[]>([])
  const [realTeamMembers, setRealTeamMembers] = useState<RealTeamMemberOption[]>([])
  const [realContacts, setRealContacts] = useState<RealContactOption[]>([])

  // Filters State
  const [filterTime, setFilterTime] = useState<'all' | TaskTimeBucket>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all')
  const [filterPriority, setFilterPriority] = useState<'all' | 'alta' | 'media' | 'baixa'>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')

  // Modals State
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  // Selected for Edit/Delete
  const [editingTask, setEditingTask] = useState<RealTask | DemoTask | null>(null)
  const [deletingTask, setDeletingTask] = useState<RealTask | DemoTask | null>(null)

  // Feedback State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  // Forms State — clientName/assigneeName are free text, used only in demo mode;
  // contactId/assigneeId are real foreign keys, used only in real (Supabase) mode.
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    clientName: '',
    contactId: '',
    dueDate: '',
    priority: 'media' as 'alta' | 'media' | 'baixa',
    assigneeName: 'Patricia Silva',
    assigneeId: '',
  })

  const [editTaskData, setEditTaskData] = useState({
    id: '',
    title: '',
    description: '',
    clientName: '',
    contactId: '',
    dueDate: '',
    priority: 'media' as 'alta' | 'media' | 'baixa',
    assigneeName: '',
    assigneeId: '',
  })

  const showToast = (msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null)
      toastTimerRef.current = null
    }, 3500)
  }

  const fetchRealTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    const offlineScope = await getOfflineScope()
    if (!navigator.onLine && offlineScope) {
      const cached = await readCachedEntity<RealTask[]>(offlineScope, 'tasks')
      if (cached) setRealTasks(cached)
      else setError('Sem conexão e sem tarefas armazenadas neste dispositivo.')
      setLoading(false)
      return
    }
    try {
      const supabase = createClient()
      const typed = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
          } & Promise<{ data: unknown[] | null; error: unknown }>
        }
      }

      const [tasksRes, membersRes, contactsRes] = await Promise.all([
        typed
          .from('tasks')
          .select('id, title, description, due_date, status, priority, assigned_to_id, contact_id, conversation_id, created_at, contacts(name), profiles(full_name)')
          .order('created_at', { ascending: false }),
        typed.from('organization_members').select('user_id, profiles(full_name)'),
        typed.from('contacts').select('id, name').order('name', { ascending: true }),
      ])

      if (tasksRes.error) {
        setViewMode('demo')
        return
      }

      const rawTasks = (tasksRes.data || []) as Array<{
        id: string
        title: string
        description: string | null
        due_date: string | null
        status: TaskStatus
        priority: 'alta' | 'media' | 'baixa' | null
        assigned_to_id: string | null
        contact_id: string | null
        conversation_id: string | null
        created_at: string
        contacts: { name: string | null } | null
        profiles: { full_name: string | null } | null
      }>

      const mappedTasks = rawTasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          due_date: t.due_date,
          status: t.status,
          priority: t.priority,
          assigned_to_id: t.assigned_to_id,
          contact_id: t.contact_id,
          conversation_id: t.conversation_id,
          assignee_name: t.profiles?.full_name || null,
          contact_name: t.contacts?.name || null,
          created_at: t.created_at,
        }))
      setRealTasks(mappedTasks)
      if (offlineScope) await cacheEntity(offlineScope, 'tasks', mappedTasks)

      const membersData = (membersRes.data || []) as Array<{ user_id: string; profiles: { full_name: string | null } | null }>
      setRealTeamMembers(membersData.map((m) => ({ id: m.user_id, fullName: m.profiles?.full_name || 'Membro' })))

      const contactsData = (contactsRes.data || []) as Array<{ id: string; name: string }>
      setRealContacts(contactsData)
    } catch {
      setViewMode('demo')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchRealTasks()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchRealTasks])

  // Toggle Task Status (1-click)
  const toggleTaskStatus = async (task: RealTask | DemoTask) => {
    const nextStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed'

    if (viewMode === 'real' && 'created_at' in task) {
      const offlineScope = await getOfflineScope()
      if (!navigator.onLine && offlineScope) {
        await queueEntityMutation(offlineScope, 'task.update', { id: task.id, status: nextStatus }, null)
        setRealTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
        showToast('Status salvo localmente e aguardando sincronização.')
        return
      }
      try {
        const supabase = createClient()
        const { error: updateError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (d: unknown) => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
            }
          }
        })
          .from('tasks')
          .update({ status: nextStatus })
          .eq('id', task.id)

        if (updateError) {
          setError('Não foi possível atualizar o status da tarefa no Supabase.')
          return
        }

        setRealTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
        showToast(nextStatus === 'completed' ? 'Tarefa concluída no Supabase!' : 'Tarefa reaberta como pendente!')
      } catch {
        setError('Erro ao atualizar a tarefa.')
      }
    } else {
      updateDemoTaskStatus(task.id, nextStatus)
      showToast(nextStatus === 'completed' ? 'Tarefa marcada como concluída!' : 'Tarefa reaberta como pendente!')
    }
  }

  // Handle Create Task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!newTask.title.trim()) {
      setError('O título da tarefa é obrigatório.')
      return
    }

    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { data: created, error: insertError } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (d: unknown) => {
              select: (c: string) => {
                single: () => Promise<{
                  data:
                    | { id: string; title: string; description: string | null; due_date: string | null; status: TaskStatus; priority: 'alta' | 'media' | 'baixa' | null; assigned_to_id: string | null; contact_id: string | null; conversation_id: string | null; created_at: string; contacts: { name: string | null } | null; profiles: { full_name: string | null } | null }
                    | null
                  error: { message: string } | null
                }>
              }
            }
          }
        })
          .from('tasks')
          .insert({
            title: newTask.title,
            description: newTask.description || null,
            due_date: safeToISOString(newTask.dueDate),
            status: 'pending',
            priority: newTask.priority,
            contact_id: newTask.contactId || null,
            assigned_to_id: newTask.assigneeId || null,
          })
          .select('id, title, description, due_date, status, priority, assigned_to_id, contact_id, conversation_id, created_at, contacts(name), profiles(full_name)')
          .single()

        if (insertError) {
          setError('Falha ao criar tarefa no Supabase. Verifique se possui permissão.')
          return
        }

        if (created) {
          setRealTasks([
            {
              id: created.id,
              title: created.title,
              description: created.description,
              due_date: created.due_date,
              status: created.status,
              priority: created.priority,
              assigned_to_id: created.assigned_to_id,
              contact_id: created.contact_id,
              // Sempre null aqui: tarefa criada por esta tela nasce solta, sem conversa de
              // origem. Quem preenche isso é o lembrete criado de dentro do Inbox.
              conversation_id: created.conversation_id,
              assignee_name: created.profiles?.full_name || null,
              contact_name: created.contacts?.name || null,
              created_at: created.created_at,
            },
            ...realTasks,
          ])
          showToast('Tarefa criada no Supabase!')
        }
      } catch {
        setError('Erro ao salvar tarefa.')
        return
      }
    } else {
      saveDemoTask({
        title: newTask.title,
        description: newTask.description || 'Sem descrição adicional.',
        dueDate: newTask.dueDate || 'Hoje, 18:00',
        status: 'pending',
        assigneeId: 'att-1',
        assigneeName: newTask.assigneeName || 'Patricia Silva',
        clientName: newTask.clientName || 'Cliente Fit',
        priority: newTask.priority,
      })
      showToast('Nova tarefa criada com sucesso!')
    }

    setNewTask({ title: '', description: '', clientName: '', contactId: '', dueDate: '', priority: 'media', assigneeName: 'Patricia Silva', assigneeId: '' })
    setCreateModalOpen(false)
  }

  // Open Edit Modal
  const openEditModal = (task: RealTask | DemoTask) => {
    const rawDueDate =
      'due_date' in task
        ? task.due_date ? task.due_date.split('T')[0] : ''
        : task.dueDate || ''

    const taskPriority = (task.priority as 'alta' | 'media' | 'baixa') || 'media'
    const isReal = 'created_at' in task

    setEditingTask(task)
    setEditTaskData({
      id: task.id,
      title: task.title,
      description: task.description || '',
      clientName: 'clientName' in task ? task.clientName : '',
      contactId: isReal ? (task as RealTask).contact_id || '' : '',
      dueDate: rawDueDate,
      priority: taskPriority,
      assigneeName: 'assigneeName' in task ? task.assigneeName : '',
      assigneeId: isReal ? (task as RealTask).assigned_to_id || '' : '',
    })
    setError(null)
    setEditModalOpen(true)
  }

  // Handle Edit Task
  const handleEditTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!editTaskData.title.trim()) {
      setError('O título da tarefa é obrigatório.')
      return
    }

    if (viewMode === 'real' && editingTask && 'created_at' in editingTask) {
      try {
        const supabase = createClient()
        const { error: updateError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (d: unknown) => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
            }
          }
        })
          .from('tasks')
          .update({
            title: editTaskData.title,
            description: editTaskData.description || null,
            due_date: safeToISOString(editTaskData.dueDate),
            priority: editTaskData.priority,
            contact_id: editTaskData.contactId || null,
            assigned_to_id: editTaskData.assigneeId || null,
          })
          .eq('id', editTaskData.id)

        if (updateError) {
          setError('Não foi possível atualizar a tarefa no Supabase.')
          return
        }

        setRealTasks((prev) =>
          prev.map((t) =>
            t.id === editTaskData.id
              ? {
                  ...t,
                  title: editTaskData.title,
                  description: editTaskData.description || null,
                  due_date: safeToISOString(editTaskData.dueDate),
                  priority: editTaskData.priority,
                  contact_id: editTaskData.contactId || null,
                  assigned_to_id: editTaskData.assigneeId || null,
                  contact_name: realContacts.find((c) => c.id === editTaskData.contactId)?.name || null,
                  assignee_name: realTeamMembers.find((m) => m.id === editTaskData.assigneeId)?.fullName || null,
                }
              : t
          )
        )
        showToast('Tarefa atualizada no Supabase!')
      } catch {
        setError('Erro ao atualizar a tarefa.')
        return
      }
    } else {
      updateDemoTask(editTaskData.id, {
        title: editTaskData.title,
        description: editTaskData.description || 'Sem descrição adicional.',
        dueDate: editTaskData.dueDate || 'Hoje',
        priority: editTaskData.priority,
        assigneeName: editTaskData.assigneeName || 'Patricia Silva',
        clientName: editTaskData.clientName || 'Cliente Fit',
      })
      showToast('Tarefa atualizada com sucesso!')
    }

    setEditModalOpen(false)
  }

  // Handle Delete Task
  const handleDeleteTask = async () => {
    if (!deletingTask) return
    setError(null)

    if (viewMode === 'real' && 'created_at' in deletingTask) {
      try {
        const supabase = createClient()
        const { error: deleteError } = await (supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
            }
          }
        })
          .from('tasks')
          .delete()
          .eq('id', deletingTask.id)

        if (deleteError) {
          setError('Não foi possível remover a tarefa do Supabase.')
          setDeleteModalOpen(false)
          return
        }

        setRealTasks((prev) => prev.filter((t) => t.id !== deletingTask.id))
        showToast('Tarefa removida do Supabase.')
      } catch {
        setError('Erro ao excluir tarefa.')
      }
    } else {
      deleteDemoTask(deletingTask.id)
      showToast('Tarefa removida com sucesso!')
    }

    setDeleteModalOpen(false)
  }

  const activeTaskList: Array<RealTask | DemoTask> = viewMode === 'real' ? realTasks : storedDemoTasks

  // Unique assignees for filter
  const allAssignees = Array.from(new Set(activeTaskList.map(getAssigneeDisplay).filter(Boolean)))

  // Apply Status, Priority, and Assignee Filters
  const filteredTasks = activeTaskList.filter((t: RealTask | DemoTask) => {
    const matchesTime = filterTime === 'all' ? true : bucketOf(t) === filterTime
    const matchesStatus = filterStatus === 'all' ? true : t.status === filterStatus
    const matchesPriority = filterPriority === 'all' ? true : t.priority === filterPriority
    const matchesAssignee = filterAssignee === 'all' ? true : getAssigneeDisplay(t) === filterAssignee

    return matchesTime && matchesStatus && matchesPriority && matchesAssignee
  })

  const timeBucketCounts = activeTaskList.reduce<Record<TaskTimeBucket, number>>(
    (acc, t) => {
      acc[bucketOf(t)] += 1
      return acc
    },
    { overdue: 0, today: 0, upcoming: 0, completed: 0 }
  )

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      <Toast message={toastMessage} />

      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-100">Tarefas e Lembretes</h1>
            {viewMode === 'real' ? (
              <Badge variant="emerald" icon={<Database className="w-3 h-3" />}>
                Supabase Real
              </Badge>
            ) : (
              <Badge variant="amber" icon={<Sparkles className="w-3 h-3" />}>
                Modo Demonstração
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Acompanhe compromissos, tarefas de atendimento e prioridades da equipe Quero Ser Fit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex text-xs">
              <button
                onClick={() => {
                  setViewMode('real')
                  void fetchRealTasks()
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
            <Button variant="secondary" onClick={fetchRealTasks}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}

          <Button onClick={() => { setError(null); setCreateModalOpen(true) }} variant="primary">
            <Plus className="w-4 h-4" />
            <span>Criar Tarefa</span>
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Bar: Status Tabs + Advanced Dropdowns */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs border-b border-slate-800/80 pb-3">
          {/* Abas por momento, não por status: "o que preciso fazer agora" em vez de "em que
              pé está o registro". Rolável na horizontal pra caber no celular sem quebrar
              linha. Ver @/lib/tasks/buckets. */}
          <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {([
              { key: 'all', label: 'Todas', count: activeTaskList.length, urgent: false },
              { key: 'overdue', label: 'Atrasadas', count: timeBucketCounts.overdue, urgent: true },
              { key: 'today', label: 'Hoje', count: timeBucketCounts.today, urgent: false },
              { key: 'upcoming', label: 'Próximas', count: timeBucketCounts.upcoming, urgent: false },
              { key: 'completed', label: 'Concluídas', count: timeBucketCounts.completed, urgent: false },
            ] as const).map((chip) => {
              const active = filterTime === chip.key
              // Atrasadas é a única que ganha cor sozinha, e só quando existe alguma —
              // vermelho permanente numa aba vazia vira ruído e para de ser notado.
              const alert = chip.urgent && chip.count > 0
              return (
                <button
                  key={chip.key}
                  onClick={() => setFilterTime(chip.key)}
                  aria-pressed={active}
                  suppressHydrationWarning
                  className={`shrink-0 px-3 py-1.5 rounded-full font-medium border transition whitespace-nowrap ${
                    active
                      ? alert
                        ? 'bg-rose-500/15 text-rose-300 border-rose-500/40 font-semibold'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 font-semibold'
                      : alert
                      ? 'bg-slate-900 text-rose-400 border-rose-900/60'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {chip.label} <span className="tabular-nums opacity-70">{chip.count}</span>
                </button>
              )
            })}
          </div>

          {/* Clear Filters Button */}
          {(filterPriority !== 'all' || filterAssignee !== 'all' || filterStatus !== 'all' || filterTime !== 'all') && (
            <button
              onClick={() => {
                setFilterTime('all')
                setFilterStatus('all')
                setFilterPriority('all')
                setFilterAssignee('all')
              }}
              className="text-[11px] text-rose-400 hover:underline flex items-center gap-1 self-start md:self-auto shrink-0"
            >
              <X className="w-3.5 h-3.5" /> Limpar Filtros
            </button>
          )}
        </div>

        {/* Advanced Filters: Status, Priority & Assignee */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 text-xs">
          {/* O filtro por status saiu das abas principais mas continua aqui inteiro —
              "Em Andamento" não tem equivalente entre os momentos acima. */}
          <div className="flex items-center gap-2 flex-1">
            <Filter className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-slate-400 font-medium text-[11px]">Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'pending' | 'in_progress' | 'completed')}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-base lg:text-xs focus:outline-none focus:border-emerald-500 flex-1 sm:flex-initial"
            >
              <option value="all">Todos os Status</option>
              <option value="pending">Pendente</option>
              <option value="in_progress">Em Andamento</option>
              <option value="completed">Concluída</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1">
            <span className="text-slate-400 font-medium text-[11px]">Prioridade:</span>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as 'all' | 'alta' | 'media' | 'baixa')}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-base lg:text-xs focus:outline-none focus:border-emerald-500 flex-1 sm:flex-initial"
            >
              <option value="all">Todas as Prioridades</option>
              <option value="alta">Alta Prioridade</option>
              <option value="media">Média Prioridade</option>
              <option value="baixa">Baixa Prioridade</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1">
            <span className="text-slate-400 font-medium text-[11px]">Responsável:</span>
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-base lg:text-xs focus:outline-none focus:border-emerald-500 flex-1 sm:flex-initial"
            >
              <option value="all">Todos os Responsáveis</option>
              {allAssignees.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="w-6 h-6" />}
            title="Nenhuma tarefa encontrada"
            description="Nenhuma tarefa atende aos critérios de status, prioridade e responsável selecionados."
          />
        ) : (
          filteredTasks.map((task: RealTask | DemoTask) => {
            const isCompleted = task.status === 'completed'
            const dueDateDisplay =
              'due_date' in task
                ? task.due_date
                  ? new Date(task.due_date).toLocaleDateString('pt-BR')
                  : 'Sem prazo'
                : task.dueDate

            const assigneeDisplay = getAssigneeDisplay(task)
            const clientDisplay = getClientDisplay(task)
            const isOverdue = bucketOf(task) === 'overdue'
            // Só existe quando a tarefa nasceu de dentro de um atendimento (ver
            // conversation_id) — aí dá pra voltar pro contexto em um toque, em vez de sair
            // procurando o cliente na lista de conversas.
            const conversationId = 'conversation_id' in task ? task.conversation_id : null

            return (
              <div
                key={task.id}
                className={`p-4 bg-[#0f172a] border border-slate-800 rounded-2xl flex items-start gap-4 transition ${
                  isCompleted ? 'opacity-60 bg-slate-900/50' : 'hover:border-slate-700'
                }`}
              >
                {/* 1-Click Status Toggle Button */}
                <button
                  onClick={() => toggleTaskStatus(task)}
                  aria-label={isCompleted ? 'Marcar como pendente' : 'Marcar como concluída'}
                  title={isCompleted ? 'Marcar como pendente' : 'Marcar como concluída'}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition ${
                    isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-600 text-transparent hover:border-emerald-500'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className={`text-sm font-semibold ${isCompleted ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                      {task.title}
                    </h3>
                    <span
                      className={`text-[10px] flex items-center gap-1 shrink-0 font-mono tabular-nums ${
                        isOverdue ? 'text-rose-400 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      <Clock className={`w-3 h-3 ${isOverdue ? 'text-rose-400' : 'text-slate-500'}`} />
                      {dueDateDisplay}
                      {/* O atraso não pode depender só da cor da data — precisa estar
                          escrito pra quem não distingue vermelho de cinza. */}
                      {isOverdue && <span className="not-italic">· atrasada</span>}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mt-1">{task.description || 'Sem descrição.'}</p>

                  <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-[11px] text-slate-400">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1 text-slate-300">
                        <User className="w-3.5 h-3.5 text-emerald-400" />
                        {assigneeDisplay}
                      </span>
                      {clientDisplay && (
                        <span className="text-slate-400">
                          Cliente: <strong className="text-slate-200 font-medium">{clientDisplay}</strong>
                        </span>
                      )}
                      <Badge variant={task.priority === 'alta' ? 'rose' : task.priority === 'media' ? 'amber' : 'slate'}>
                        Prioridade: {task.priority || 'media'}
                      </Badge>
                    </div>

                    {/* Action Buttons: Abrir conversa, Edit & Delete */}
                    <div className="flex items-center gap-1 shrink-0">
                      {conversationId && (
                        <Link
                          href={`/inbox?conversa=${conversationId}`}
                          title="Abrir a conversa deste cliente"
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-400 transition"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span className="sr-only">Abrir conversa</span>
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditModal(task)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-400 transition"
                        title="Editar tarefa"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDeletingTask(task); setDeleteModalOpen(true) }}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                        title="Excluir tarefa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Create Task Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Nova Tarefa"
        icon={<CheckSquare className="w-5 h-5" />}
      >
        <form onSubmit={handleCreateTask} className="space-y-3 text-xs">
          <Input
            label="Título da Tarefa *"
            required
            placeholder="Ex: Enviar orçamento de kit mensal"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
          />

          {viewMode === 'real' ? (
            <div>
              <label className="block text-slate-300 font-medium mb-1">Cliente Associado</label>
              <select
                value={newTask.contactId}
                onChange={(e) => setNewTask({ ...newTask, contactId: e.target.value })}
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
              >
                <option value="">Nenhum (opcional)</option>
                {realContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <Input
              label="Cliente Associado"
              placeholder="Nome do cliente (opcional)"
              value={newTask.clientName}
              onChange={(e) => setNewTask({ ...newTask, clientName: e.target.value })}
            />
          )}

          <Input
            label="Data de Vencimento"
            type="date"
            value={newTask.dueDate}
            onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
          />

          <div>
            <label className="block text-slate-300 font-medium mb-1">Prioridade</label>
            <select
              value={newTask.priority}
              onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as 'alta' | 'media' | 'baixa' })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            >
              <option value="media">Média (Padrão)</option>
              <option value="alta">Alta Prioridade</option>
              <option value="baixa">Baixa Prioridade</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Responsável</label>
            {viewMode === 'real' ? (
              <select
                value={newTask.assigneeId}
                onChange={(e) => setNewTask({ ...newTask, assigneeId: e.target.value })}
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
              >
                <option value="">Sem responsável definido</option>
                {realTeamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={newTask.assigneeName}
                onChange={(e) => setNewTask({ ...newTask, assigneeName: e.target.value })}
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
              >
                {storedDemoMembers.map((m) => (
                  <option key={m.id} value={m.fullName}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Descrição</label>
            <textarea
              rows={3}
              placeholder="Detalhes sobre a tarefa..."
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Criar Tarefa
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Task Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Editar Tarefa"
        icon={<Pencil className="w-5 h-5" />}
      >
        <form onSubmit={handleEditTask} className="space-y-3 text-xs">
          <Input
            label="Título da Tarefa *"
            required
            placeholder="Título"
            value={editTaskData.title}
            onChange={(e) => setEditTaskData({ ...editTaskData, title: e.target.value })}
          />

          {viewMode === 'real' ? (
            <div>
              <label className="block text-slate-300 font-medium mb-1">Cliente Associado</label>
              <select
                value={editTaskData.contactId}
                onChange={(e) => setEditTaskData({ ...editTaskData, contactId: e.target.value })}
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
              >
                <option value="">Nenhum</option>
                {realContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <Input
              label="Cliente Associado"
              placeholder="Nome do cliente"
              value={editTaskData.clientName}
              onChange={(e) => setEditTaskData({ ...editTaskData, clientName: e.target.value })}
            />
          )}

          <Input
            label="Data de Vencimento"
            type="date"
            value={editTaskData.dueDate}
            onChange={(e) => setEditTaskData({ ...editTaskData, dueDate: e.target.value })}
          />

          <div>
            <label className="block text-slate-300 font-medium mb-1">Prioridade</label>
            <select
              value={editTaskData.priority}
              onChange={(e) => setEditTaskData({ ...editTaskData, priority: e.target.value as 'alta' | 'media' | 'baixa' })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            >
              <option value="alta">Alta Prioridade</option>
              <option value="media">Média Prioridade</option>
              <option value="baixa">Baixa Prioridade</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Responsável</label>
            {viewMode === 'real' ? (
              <select
                value={editTaskData.assigneeId}
                onChange={(e) => setEditTaskData({ ...editTaskData, assigneeId: e.target.value })}
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
              >
                <option value="">Sem responsável definido</option>
                {realTeamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={editTaskData.assigneeName}
                onChange={(e) => setEditTaskData({ ...editTaskData, assigneeName: e.target.value })}
                className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
              >
                {storedDemoMembers.map((m) => (
                  <option key={m.id} value={m.fullName}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Descrição</label>
            <textarea
              rows={3}
              placeholder="Detalhes..."
              value={editTaskData.description}
              onChange={(e) => setEditTaskData({ ...editTaskData, description: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Atualizar Tarefa
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Task Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirmar Exclusão de Tarefa"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300 leading-relaxed">
            Tem certeza que deseja excluir a tarefa{' '}
            <strong className="text-slate-100">{deletingTask?.title}</strong>?
          </p>
          <p className="text-rose-400 bg-rose-950/40 border border-rose-800/40 p-3 rounded-xl">
            Atenção: Esta ação removerá a tarefa do painel da equipe.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setDeleteModalOpen(false)}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleDeleteTask}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition"
            >
              Sim, Excluir Tarefa
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

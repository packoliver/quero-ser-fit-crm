'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CheckSquare,
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
import { createClient } from '@/lib/supabase/client'
import { TaskStatus } from '@/types/database'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'

export interface RealTask {
  id: string
  title: string
  description: string | null
  due_date: string | null
  status: TaskStatus
  priority: 'alta' | 'media' | 'baixa' | null
  assigned_to_id: string | null
  created_at: string
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

  // Filters State
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

  // Forms State
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    clientName: '',
    dueDate: '',
    priority: 'media' as 'alta' | 'media' | 'baixa',
    assigneeName: 'Patricia Silva',
  })

  const [editTaskData, setEditTaskData] = useState({
    id: '',
    title: '',
    description: '',
    clientName: '',
    dueDate: '',
    priority: 'media' as 'alta' | 'media' | 'baixa',
    assigneeName: '',
  })

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  const fetchRealTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: RealTask[] | null; error: { message: string } | null }>
          }
        }
      })
        .from('tasks')
        .select('id, title, description, due_date, status, priority, assigned_to_id, created_at')
        .order('created_at', { ascending: false })

      if (dbError) {
        setViewMode('demo')
      } else if (data) {
        setRealTasks(data)
      }
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
              select: () => {
                single: () => Promise<{ data: RealTask | null; error: { message: string } | null }>
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
          })
          .select()
          .single()

        if (insertError) {
          setError('Falha ao criar tarefa no Supabase. Verifique se possui permissão.')
          return
        }

        if (created) {
          setRealTasks([created, ...realTasks])
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

    setNewTask({ title: '', description: '', clientName: '', dueDate: '', priority: 'media', assigneeName: 'Patricia Silva' })
    setCreateModalOpen(false)
  }

  // Open Edit Modal
  const openEditModal = (task: RealTask | DemoTask) => {
    const rawDueDate =
      'due_date' in task
        ? task.due_date ? task.due_date.split('T')[0] : ''
        : task.dueDate || ''

    const taskPriority = (task.priority as 'alta' | 'media' | 'baixa') || 'media'
    const taskAssignee = 'assigneeName' in task ? task.assigneeName : 'Atendente da Organização'
    const taskClient = 'clientName' in task ? task.clientName : ''

    setEditingTask(task)
    setEditTaskData({
      id: task.id,
      title: task.title,
      description: task.description || '',
      clientName: taskClient,
      dueDate: rawDueDate,
      priority: taskPriority,
      assigneeName: taskAssignee,
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
  const allAssignees = Array.from(
    new Set(
      activeTaskList
        .map((t) => ('assigneeName' in t ? t.assigneeName : 'Atendente da Organização'))
        .filter(Boolean)
    )
  )

  // Apply Status, Priority, and Assignee Filters
  const filteredTasks = activeTaskList.filter((t: RealTask | DemoTask) => {
    const matchesStatus = filterStatus === 'all' ? true : t.status === filterStatus
    const matchesPriority = filterPriority === 'all' ? true : t.priority === filterPriority
    const taskAssignee = 'assigneeName' in t ? t.assigneeName : 'Atendente da Organização'
    const matchesAssignee = filterAssignee === 'all' ? true : taskAssignee === filterAssignee

    return matchesStatus && matchesPriority && matchesAssignee
  })

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-bounce border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{toastMessage}</span>
        </div>
      )}

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
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                filterStatus === 'all' ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todas ({activeTaskList.length})
            </button>
            <button
              onClick={() => setFilterStatus('pending')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                filterStatus === 'pending' ? 'bg-amber-950/80 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pendentes ({activeTaskList.filter((t) => t.status === 'pending').length})
            </button>
            <button
              onClick={() => setFilterStatus('in_progress')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                filterStatus === 'in_progress' ? 'bg-blue-950/80 text-blue-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Em Andamento
            </button>
            <button
              onClick={() => setFilterStatus('completed')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                filterStatus === 'completed' ? 'bg-emerald-950/80 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Concluídas ({activeTaskList.filter((t) => t.status === 'completed').length})
            </button>
          </div>

          {/* Clear Filters Button */}
          {(filterPriority !== 'all' || filterAssignee !== 'all' || filterStatus !== 'all') && (
            <button
              onClick={() => {
                setFilterStatus('all')
                setFilterPriority('all')
                setFilterAssignee('all')
              }}
              className="text-[11px] text-rose-400 hover:underline flex items-center gap-1 self-start md:self-auto"
            >
              <X className="w-3.5 h-3.5" /> Limpar Filtros
            </button>
          )}
        </div>

        {/* Advanced Filters: Priority & Assignee */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 text-xs">
          <div className="flex items-center gap-2 flex-1">
            <Filter className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-slate-400 font-medium text-[11px]">Prioridade:</span>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as 'all' | 'alta' | 'media' | 'baixa')}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 flex-1 sm:flex-initial"
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
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 flex-1 sm:flex-initial"
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

            const assigneeDisplay = 'assigneeName' in task ? task.assigneeName : 'Atendente da Organização'
            const clientDisplay = 'clientName' in task ? task.clientName : null

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
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 shrink-0 font-mono">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {dueDateDisplay}
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

                    {/* Action Buttons: Edit & Delete */}
                    <div className="flex items-center gap-1 shrink-0">
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

          <Input
            label="Cliente Associado"
            placeholder="Nome do cliente (opcional)"
            value={newTask.clientName}
            onChange={(e) => setNewTask({ ...newTask, clientName: e.target.value })}
          />

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
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            >
              <option value="media">Média (Padrão)</option>
              <option value="alta">Alta Prioridade</option>
              <option value="baixa">Baixa Prioridade</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Responsável</label>
            <select
              value={newTask.assigneeName}
              onChange={(e) => setNewTask({ ...newTask, assigneeName: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            >
              {storedDemoMembers.map((m) => (
                <option key={m.id} value={m.fullName}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Descrição</label>
            <textarea
              rows={3}
              placeholder="Detalhes sobre a tarefa..."
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
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

          <Input
            label="Cliente Associado"
            placeholder="Nome do cliente"
            value={editTaskData.clientName}
            onChange={(e) => setEditTaskData({ ...editTaskData, clientName: e.target.value })}
          />

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
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            >
              <option value="alta">Alta Prioridade</option>
              <option value="media">Média Prioridade</option>
              <option value="baixa">Baixa Prioridade</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Responsável</label>
            <select
              value={editTaskData.assigneeName}
              onChange={(e) => setEditTaskData({ ...editTaskData, assigneeName: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            >
              {storedDemoMembers.map((m) => (
                <option key={m.id} value={m.fullName}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Descrição</label>
            <textarea
              rows={3}
              placeholder="Detalhes..."
              value={editTaskData.description}
              onChange={(e) => setEditTaskData({ ...editTaskData, description: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
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

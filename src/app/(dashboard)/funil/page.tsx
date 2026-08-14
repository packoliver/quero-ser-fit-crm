'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Kanban,
  Plus,
  Sparkles,
  Database,
  AlertCircle,
  RefreshCw,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Phone,
  DollarSign,
  GripVertical,
} from 'lucide-react'
import { DemoDeal } from '@/lib/demo'
import { Button } from '@/components/ui/Button'
import { Badge, BadgeProps } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import { DealStage } from '@/types/database'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { cacheEntity, readCachedEntity, queueEntityMutation } from '@/lib/offline/repository'
import { getOfflineScope } from '@/lib/offline/scope'

export interface RealDeal {
  id: string
  title: string
  contact_id: string
  value: number | null
  stage: DealStage
  notes: string | null
  created_at: string
  closed_at: string | null
  contacts?: { name: string; phone: string | null } | null
}

interface RealContactOption {
  id: string
  name: string
  phone: string | null
}

const STAGES: Array<{ key: DealStage; label: string; variant: NonNullable<BadgeProps['variant']> }> = [
  { key: 'lead', label: 'Lead', variant: 'slate' },
  { key: 'negociando', label: 'Negociando', variant: 'amber' },
  { key: 'fechado', label: 'Fechado', variant: 'emerald' },
  { key: 'entrega', label: 'Entrega', variant: 'teal' },
  { key: 'posvenda', label: 'Pós-venda', variant: 'indigo' },
  { key: 'perdido', label: 'Perdido', variant: 'rose' },
]

const formatCurrency = (value: number | null) =>
  value == null ? null : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type AnyDeal = RealDeal | DemoDeal

function isRealDeal(d: AnyDeal): d is RealDeal {
  return 'created_at' in d && 'contact_id' in d
}

function dealTitle(d: AnyDeal) {
  return d.title
}
function dealStage(d: AnyDeal): DealStage {
  return d.stage
}
function dealContactName(d: AnyDeal): string {
  return isRealDeal(d) ? d.contacts?.name || 'Contato removido' : d.contactName
}
function dealContactPhone(d: AnyDeal): string | null {
  return isRealDeal(d) ? d.contacts?.phone || null : null
}
function dealValue(d: AnyDeal): number | null {
  return d.value
}
function dealNotes(d: AnyDeal): string {
  return (isRealDeal(d) ? d.notes : d.notes) || ''
}

export default function FunilPage() {
  const {
    deals: storedDemoDeals,
    contacts: storedDemoContacts,
    addDeal: saveDemoDeal,
    updateDealStage: updateDemoDealStage,
    updateDeal: updateDemoDeal,
    deleteDeal: deleteDemoDeal,
  } = useDemoStorage()

  const [viewMode, setViewMode] = useState<'demo' | 'real'>('real')
  const [realDeals, setRealDeals] = useState<RealDeal[]>([])
  const [realContacts, setRealContacts] = useState<RealContactOption[]>([])

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  const [editingDeal, setEditingDeal] = useState<AnyDeal | null>(null)
  const [deletingDeal, setDeletingDeal] = useState<AnyDeal | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  const [newDeal, setNewDeal] = useState({ title: '', contactId: '', value: '', notes: '' })
  const [editDealData, setEditDealData] = useState({ id: '', title: '', value: '', notes: '' })

  const showToast = (msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null)
      toastTimerRef.current = null
    }, 3500)
  }

  const fetchRealDeals = useCallback(async () => {
    setLoading(true)
    setError(null)
    const offlineScope = await getOfflineScope()
    if (!navigator.onLine && offlineScope) {
      const cached = await readCachedEntity<RealDeal[]>(offlineScope, 'deals')
      if (cached) setRealDeals(cached)
      else setError('Sem conexão e sem pedidos armazenados neste dispositivo.')
      setLoading(false)
      return
    }
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: RealDeal[] | null; error: { message: string } | null }>
          }
        }
      })
        .from('deals')
        .select('id, title, contact_id, value, stage, notes, created_at, closed_at, contacts(name, phone)')
        .order('created_at', { ascending: false })

      if (dbError) {
        setError(dbError.message || 'Não foi possível carregar os pedidos do Supabase.')
        setRealDeals([])
      } else if (data) {
        setRealDeals(data)
        if (offlineScope) await cacheEntity(offlineScope, 'deals', data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado ao carregar o funil.')
      setRealDeals([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchRealContacts = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: RealContactOption[] | null }>
          }
        }
      })
        .from('contacts')
        .select('id, name, phone')
        .order('name', { ascending: true })

      if (data) setRealContacts(data)
    } catch {
      // Silencioso — o select de contato simplesmente fica vazio; o usuário ainda vê o erro
      // principal (se houver) vindo de fetchRealDeals.
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchRealDeals()
      void fetchRealContacts()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchRealDeals, fetchRealContacts])

  // Realtime: um card que outra vendedora mover aparece pra todo mundo sem precisar
  // atualizar a página — mesmo padrão de debounce usado no Inbox.
  useEffect(() => {
    if (viewMode !== 'real') return
    const supabase = createClient()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void fetchRealDeals(), 400)
    }
    const channel = supabase
      .channel('funil-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [viewMode, fetchRealDeals])

  const moveDeal = async (deal: AnyDeal, newStage: DealStage) => {
    if (dealStage(deal) === newStage) return

    if (viewMode === 'real' && isRealDeal(deal)) {
      const offlineScope = await getOfflineScope()
      const updates: Record<string, unknown> = { stage: newStage }
      if (newStage === 'fechado' && !deal.closed_at) updates.closed_at = new Date().toISOString()
      if (!navigator.onLine && offlineScope) {
        await queueEntityMutation(offlineScope, 'deal.update', { id: deal.id, ...updates }, null)
        setRealDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage: newStage, closed_at: (updates.closed_at as string) || d.closed_at } : d)))
        showToast('Etapa salva localmente e aguardando sincronização.')
        return
      }
      try {
        const supabase = createClient()
        const { error: updateError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (d: unknown) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
          }
        })
          .from('deals')
          .update(updates)
          .eq('id', deal.id)

        if (updateError) {
          setError('Não foi possível mover o pedido no Supabase.')
          return
        }

        setRealDeals((prev) =>
          prev.map((d) => (d.id === deal.id ? { ...d, stage: newStage, closed_at: (updates.closed_at as string) || d.closed_at } : d))
        )
        showToast(`Pedido movido para "${STAGES.find((s) => s.key === newStage)?.label}"!`)
      } catch {
        setError('Erro ao mover o pedido.')
      }
    } else {
      updateDemoDealStage(deal.id, newStage)
      showToast(`Pedido movido para "${STAGES.find((s) => s.key === newStage)?.label}"!`)
    }
  }

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!newDeal.title.trim()) {
      setError('O título do pedido é obrigatório.')
      return
    }
    if (!newDeal.contactId) {
      setError('Selecione o cliente deste pedido.')
      return
    }

    const parsedValue = newDeal.value.trim() ? Number(newDeal.value.replace(',', '.')) : null

    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { data: created, error: insertError } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (d: unknown) => {
              select: (c: string) => { single: () => Promise<{ data: RealDeal | null; error: { message: string } | null }> }
            }
          }
        })
          .from('deals')
          .insert({
            title: newDeal.title,
            contact_id: newDeal.contactId,
            value: parsedValue,
            notes: newDeal.notes || null,
            stage: 'lead',
          })
          .select('id, title, contact_id, value, stage, notes, created_at, closed_at, contacts(name, phone)')
          .single()

        if (insertError) {
          setError('Falha ao criar o pedido no Supabase. Verifique se possui permissão.')
          return
        }
        if (created) {
          setRealDeals([created, ...realDeals])
          showToast('Pedido adicionado ao funil!')
        }
      } catch {
        setError('Erro ao salvar o pedido.')
        return
      }
    } else {
      const contact = storedDemoContacts.find((c) => c.id === newDeal.contactId)
      saveDemoDeal({
        title: newDeal.title,
        contactId: newDeal.contactId,
        contactName: contact?.name || 'Cliente',
        value: parsedValue,
        stage: 'lead',
        notes: newDeal.notes,
      })
      showToast('Pedido adicionado ao funil!')
    }

    setNewDeal({ title: '', contactId: '', value: '', notes: '' })
    setCreateModalOpen(false)
  }

  const openEditModal = (deal: AnyDeal) => {
    setEditingDeal(deal)
    setEditDealData({
      id: deal.id,
      title: dealTitle(deal),
      value: dealValue(deal) != null ? String(dealValue(deal)) : '',
      notes: dealNotes(deal),
    })
    setError(null)
    setEditModalOpen(true)
  }

  const handleEditDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!editDealData.title.trim()) {
      setError('O título do pedido é obrigatório.')
      return
    }
    const parsedValue = editDealData.value.trim() ? Number(editDealData.value.replace(',', '.')) : null

    if (viewMode === 'real' && editingDeal && isRealDeal(editingDeal)) {
      try {
        const supabase = createClient()
        const { error: updateError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (d: unknown) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
          }
        })
          .from('deals')
          .update({ title: editDealData.title, value: parsedValue, notes: editDealData.notes || null })
          .eq('id', editDealData.id)

        if (updateError) {
          setError('Não foi possível atualizar o pedido no Supabase.')
          return
        }

        setRealDeals((prev) =>
          prev.map((d) =>
            d.id === editDealData.id ? { ...d, title: editDealData.title, value: parsedValue, notes: editDealData.notes || null } : d
          )
        )
        showToast('Pedido atualizado no Supabase!')
      } catch {
        setError('Erro ao atualizar o pedido.')
        return
      }
    } else {
      updateDemoDeal(editDealData.id, { title: editDealData.title, value: parsedValue, notes: editDealData.notes })
      showToast('Pedido atualizado com sucesso!')
    }

    setEditModalOpen(false)
  }

  const handleDeleteDeal = async () => {
    if (!deletingDeal) return
    setError(null)

    if (viewMode === 'real' && isRealDeal(deletingDeal)) {
      try {
        const supabase = createClient()
        const { error: deleteError } = await (supabase as unknown as {
          from: (t: string) => { delete: () => { eq: (col: string, val: string) => Promise<{ error: unknown }> } }
        })
          .from('deals')
          .delete()
          .eq('id', deletingDeal.id)

        if (deleteError) {
          setError('Não foi possível remover o pedido do Supabase.')
          setDeleteModalOpen(false)
          return
        }

        setRealDeals((prev) => prev.filter((d) => d.id !== deletingDeal.id))
        showToast('Pedido removido do funil.')
      } catch {
        setError('Erro ao excluir o pedido.')
      }
    } else {
      deleteDemoDeal(deletingDeal.id)
      showToast('Pedido removido do funil.')
    }

    setDeleteModalOpen(false)
  }

  const activeDealList: AnyDeal[] = viewMode === 'real' ? realDeals : storedDemoDeals
  const contactOptions = viewMode === 'real' ? realContacts : storedDemoContacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))

  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null)

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1600px] mx-auto relative">
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-bounce border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-100">Funil de Vendas</h1>
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
            Acompanhe cada pedido do primeiro contato até o pós-venda. Arraste o card ou use o seletor &quot;Mover&quot;.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex text-xs">
              <button
                onClick={() => {
                  setViewMode('real')
                  void fetchRealDeals()
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
            <Button variant="secondary" onClick={fetchRealDeals}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}

          <Button onClick={() => { setError(null); setCreateModalOpen(true) }} variant="primary">
            <Plus className="w-4 h-4" />
            <span>Novo Pedido</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {activeDealList.length === 0 ? (
        <EmptyState
          icon={<Kanban className="w-6 h-6" />}
          title="Nenhum pedido no funil ainda"
          description="Crie o primeiro pedido pra começar a acompanhar a jornada do cliente do lead até o pós-venda."
          action={
            <Button onClick={() => setCreateModalOpen(true)} variant="primary">
              <Plus className="w-4 h-4" />
              <span>Novo Pedido</span>
            </Button>
          }
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 lg:mx-0 lg:px-0">
          {STAGES.map((stage) => {
            const stageDeals = activeDealList.filter((d) => dealStage(d) === stage.key)
            const stageValueTotal = stageDeals.reduce((sum, d) => sum + (dealValue(d) || 0), 0)

            return (
              <div
                key={stage.key}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverStage(stage.key)
                }}
                onDragLeave={() => setDragOverStage((prev) => (prev === stage.key ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverStage(null)
                  const deal = activeDealList.find((d) => d.id === draggedId)
                  if (deal) void moveDeal(deal, stage.key)
                  setDraggedId(null)
                }}
                className={`shrink-0 w-[300px] bg-[#0f172a] border rounded-2xl flex flex-col max-h-[calc(100vh-260px)] transition ${
                  dragOverStage === stage.key ? 'border-emerald-500/70 bg-emerald-950/10' : 'border-slate-800'
                }`}
              >
                <div className="p-3.5 border-b border-slate-800 shrink-0 flex items-center justify-between">
                  <Badge variant={stage.variant}>{stage.label}</Badge>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400 font-mono">{stageDeals.length} pedido{stageDeals.length === 1 ? '' : 's'}</div>
                    {stageValueTotal > 0 && (
                      <div className="text-[10px] text-slate-500 font-mono">{formatCurrency(stageValueTotal)}</div>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                  {stageDeals.length === 0 ? (
                    <p className="text-[11px] text-slate-600 text-center py-6">Nenhum pedido aqui.</p>
                  ) : (
                    stageDeals.map((deal) => (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={() => setDraggedId(deal.id)}
                        onDragEnd={() => setDraggedId(null)}
                        className={`p-3 bg-slate-900/80 border border-slate-800 rounded-xl hover:border-slate-700 transition cursor-grab active:cursor-grabbing ${
                          draggedId === deal.id ? 'opacity-40' : ''
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <GripVertical className="w-3.5 h-3.5 text-slate-600 mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <h3 className="text-xs font-semibold text-slate-100 leading-snug">{dealTitle(deal)}</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{dealContactName(deal)}</p>
                            {dealContactPhone(deal) && (
                              <span className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
                                <Phone className="w-3 h-3" />
                                {dealContactPhone(deal)}
                              </span>
                            )}
                            {dealValue(deal) != null && (
                              <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold mt-1.5">
                                <DollarSign className="w-3 h-3" />
                                {formatCurrency(dealValue(deal))}
                              </span>
                            )}
                            {dealNotes(deal) && (
                              <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-2">{dealNotes(deal)}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-slate-800/80">
                          <select
                            value={stage.key}
                            onChange={(e) => void moveDeal(deal, e.target.value as DealStage)}
                            className="flex-1 bg-slate-950 border border-slate-800 text-slate-300 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:border-emerald-500"
                            aria-label="Mover pedido para outra etapa"
                          >
                            {STAGES.map((s) => (
                              <option key={s.key} value={s.key}>
                                Mover: {s.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => openEditModal(deal)}
                            className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-emerald-400 transition shrink-0"
                            title="Editar pedido"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeletingDeal(deal); setDeleteModalOpen(true) }}
                            className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-800 text-slate-500 hover:text-rose-400 transition shrink-0"
                            title="Excluir pedido"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Deal Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Novo Pedido" icon={<Kanban className="w-5 h-5" />}>
        <form onSubmit={handleCreateDeal} className="space-y-3 text-xs">
          <Input
            label="Título do Pedido *"
            required
            placeholder="Ex: Kit marmitas fit semanal"
            value={newDeal.title}
            onChange={(e) => setNewDeal({ ...newDeal, title: e.target.value })}
          />

          <div>
            <label className="block text-slate-300 font-medium mb-1">Cliente *</label>
            <select
              value={newDeal.contactId}
              onChange={(e) => setNewDeal({ ...newDeal, contactId: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            >
              <option value="">Selecione um cliente...</option>
              {contactOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ''}
                </option>
              ))}
            </select>
            {contactOptions.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                Nenhum cliente cadastrado ainda — crie um contato em &quot;Clientes&quot; primeiro.
              </p>
            )}
          </div>

          <Input
            label="Valor (R$)"
            type="text"
            inputMode="decimal"
            placeholder="Ex: 189.90"
            value={newDeal.value}
            onChange={(e) => setNewDeal({ ...newDeal, value: e.target.value })}
          />

          <div>
            <label className="block text-slate-300 font-medium mb-1">Observações</label>
            <textarea
              rows={3}
              placeholder="Detalhes sobre o pedido..."
              value={newDeal.notes}
              onChange={(e) => setNewDeal({ ...newDeal, notes: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Criar Pedido
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Deal Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Editar Pedido" icon={<Pencil className="w-5 h-5" />}>
        <form onSubmit={handleEditDeal} className="space-y-3 text-xs">
          <Input
            label="Título do Pedido *"
            required
            value={editDealData.title}
            onChange={(e) => setEditDealData({ ...editDealData, title: e.target.value })}
          />
          <Input
            label="Valor (R$)"
            type="text"
            inputMode="decimal"
            value={editDealData.value}
            onChange={(e) => setEditDealData({ ...editDealData, value: e.target.value })}
          />
          <div>
            <label className="block text-slate-300 font-medium mb-1">Observações</label>
            <textarea
              rows={3}
              value={editDealData.notes}
              onChange={(e) => setEditDealData({ ...editDealData, notes: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Salvar Alterações
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Deal Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirmar Exclusão de Pedido"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300 leading-relaxed">
            Tem certeza que deseja excluir o pedido <strong className="text-slate-100">{deletingDeal ? dealTitle(deletingDeal) : ''}</strong>?
          </p>
          <p className="text-rose-400 bg-rose-950/40 border border-rose-800/40 p-3 rounded-xl">
            Atenção: isso remove o pedido do funil — o histórico de conversa do cliente no Inbox não é afetado.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setDeleteModalOpen(false)}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleDeleteDeal}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition"
            >
              Sim, Excluir Pedido
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

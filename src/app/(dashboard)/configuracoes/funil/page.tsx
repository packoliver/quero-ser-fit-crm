'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ListOrdered,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Trophy,
  XCircle,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import {
  PipelineStage,
  PipelineStageRow,
  StageColor,
  STAGE_COLOR_OPTIONS,
  DEFAULT_PIPELINE_STAGES,
  mapPipelineStageRow,
  slugifyStageKey,
} from '@/lib/pipeline/stages'
import { UserRole, CustomPermissions } from '@/types/database'
import { hasPermission } from '@/lib/security/permissions'

const COLOR_LABELS: Record<StageColor, string> = {
  slate: 'Cinza',
  amber: 'Âmbar',
  emerald: 'Verde',
  teal: 'Verde-água',
  rose: 'Rosa-vermelho',
  pink: 'Rosa',
  indigo: 'Índigo',
}

const emptyForm = { id: '', label: '', color: 'slate' as StageColor, isWon: false, isLost: false }

export default function EtapasDoFunilPage() {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const isEditing = !!form.id

  const [deleteTarget, setDeleteTarget] = useState<PipelineStage | null>(null)
  const [seeding, setSeeding] = useState(false)

  // Papel + overrides de permissão do usuário logado — controla se os controles de
  // criar/editar/excluir/reordenar aparecem (mesma lógica de canDeleteMessages no
  // Inbox). O item de menu já fica escondido de atendentes (adminOnly em
  // navigation.ts), mas isso cobre o caso de um admin ter revogado
  // manage_pipeline_stages de um gerente específico via permissões granulares.
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)
  const [currentUserPermissions, setCurrentUserPermissions] = useState<CustomPermissions | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const supabase = createClient() as unknown as {
        auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: { role: UserRole; permissions: CustomPermissions | null } | null }> } }
          }
        }
      }
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return
        supabase
          .from('organization_members')
          .select('role, permissions')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle()
          .then(({ data }) => {
            setCurrentUserRole(data?.role || null)
            setCurrentUserPermissions(data?.permissions || null)
          })
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Antes do papel carregar, currentUserRole é null → hasPermission trata como
  // 'attendant' (o menos privilegiado), então os controles não piscam aparecendo e
  // sumindo pra quem não pode usá-los.
  const canManageStages = hasPermission(currentUserRole || 'attendant', currentUserPermissions, 'manage_pipeline_stages')

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 3500)
  }

  const fetchStages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: PipelineStageRow[] | null; error: { message: string } | null }>
          }
        }
      })
        .from('pipeline_stages')
        .select('id, key, label, color, position, is_won, is_lost')
        .order('position', { ascending: true })

      if (dbError) {
        setError('Não foi possível carregar as etapas do funil.')
        return
      }
      setStages((data || []).map(mapPipelineStageRow))
    } catch {
      setError('Erro de conexão ao carregar as etapas do funil.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchStages()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchStages])

  const openCreate = () => {
    setForm(emptyForm)
    setError(null)
    setFormOpen(true)
  }

  const openEdit = (stage: PipelineStage) => {
    setForm({ id: stage.id, label: stage.label, color: stage.color, isWon: stage.isWon, isLost: stage.isLost })
    setError(null)
    setFormOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.label.trim()) return
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()

      if (isEditing) {
        const { error: dbError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
          }
        })
          .from('pipeline_stages')
          .update({ label: form.label.trim(), color: form.color, is_won: form.isWon, is_lost: form.isLost })
          .eq('id', form.id)

        if (dbError) {
          setError('Falha ao salvar a etapa.')
          return
        }
        showToast('Etapa atualizada!')
      } else {
        const key = slugifyStageKey(form.label.trim(), stages.map((s) => s.key))
        const position = stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0

        const { error: dbError } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (v: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>
          }
        })
          .from('pipeline_stages')
          .insert({ key, label: form.label.trim(), color: form.color, position, is_won: form.isWon, is_lost: form.isLost })

        if (dbError) {
          setError(dbError.code === '23505' ? 'Já existe uma etapa parecida com esse nome.' : 'Falha ao criar a etapa.')
          return
        }
        showToast('Etapa criada!')
      }

      setFormOpen(false)
      void fetchStages()
    } catch {
      setError('Erro de conexão ao salvar a etapa.')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = async (stage: PipelineStage) => {
    setError(null)
    if (stages.length <= 1) {
      setError('Mantenha ao menos uma etapa no funil — não é possível excluir a última.')
      return
    }
    try {
      const supabase = createClient()
      const { count } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string, opt: { count: 'exact'; head: boolean }) => {
            eq: (col: string, val: string) => Promise<{ count: number | null }>
          }
        }
      })
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('stage', stage.key)

      if ((count || 0) > 0) {
        setError(
          `Essa etapa tem ${count} pedido${count === 1 ? '' : 's'} vinculado${count === 1 ? '' : 's'} no Funil. Mova ${count === 1 ? 'ele' : 'eles'} para outra etapa antes de excluir.`
        )
        return
      }
      setDeleteTarget(stage)
    } catch {
      setError('Erro ao verificar pedidos vinculados a essa etapa.')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setError(null)
    try {
      const supabase = createClient()
      const { error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
        }
      })
        .from('pipeline_stages')
        .delete()
        .eq('id', deleteTarget.id)

      if (dbError) {
        setError('Falha ao excluir a etapa.')
        return
      }
      showToast('Etapa excluída.')
      void fetchStages()
    } catch {
      setError('Erro de conexão ao excluir.')
    } finally {
      setDeleteTarget(null)
    }
  }

  // Reordenar troca a `position` da etapa com a vizinha (subir/descer) — mais simples e
  // confiável do que drag-and-drop pra uma lista curta como essa.
  const moveStage = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= stages.length) return
    const current = stages[index]
    const target = stages[targetIndex]

    const reordered = [...stages]
    reordered[index] = { ...target, position: current.position }
    reordered[targetIndex] = { ...current, position: target.position }
    reordered.sort((a, b) => a.position - b.position)
    setStages(reordered)

    try {
      const supabase = createClient()
      const db = supabase as unknown as {
        from: (t: string) => {
          update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
        }
      }
      await Promise.all([
        db.from('pipeline_stages').update({ position: current.position }).eq('id', target.id),
        db.from('pipeline_stages').update({ position: target.position }).eq('id', current.id),
      ])
    } catch {
      setError('Não foi possível salvar a nova ordem — atualize a página e tente de novo.')
      void fetchStages()
    }
  }

  const handleSeedDefaults = async () => {
    setSeeding(true)
    setError(null)
    try {
      const supabase = createClient()
      const payload = DEFAULT_PIPELINE_STAGES.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        position: s.position,
        is_won: s.isWon,
        is_lost: s.isLost,
      }))
      const { error: dbError } = await (supabase as unknown as {
        from: (t: string) => { insert: (v: unknown[]) => Promise<{ error: { message: string } | null }> }
      })
        .from('pipeline_stages')
        .insert(payload)

      if (dbError) {
        setError('Falha ao criar as etapas padrão.')
        return
      }
      showToast('Etapas padrão criadas!')
      void fetchStages()
    } catch {
      setError('Erro de conexão ao criar as etapas padrão.')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto relative">
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-bounce border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{toast}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-emerald-400" />
            Etapas do Funil
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            As colunas do Kanban em &quot;Funil&quot; e as opções de mover pedido no Inbox vêm daqui — crie,
            renomeie, reordene ou exclua etapas sem depender de ninguém mexer no código.
          </p>
        </div>
        {canManageStages && (
          <Button onClick={openCreate} variant="primary">
            <Plus className="w-4 h-4" />
            <span>Nova Etapa</span>
          </Button>
        )}
      </div>

      {!loading && stages.length === 0 ? (
        <EmptyState
          icon={<ListOrdered className="w-6 h-6" />}
          title="Nenhuma etapa configurada ainda"
          description={
            canManageStages
              ? 'Sem etapas, o Funil e a aba Pedido do Inbox ficam vazios. Comece do zero ou use o modelo padrão (Lead, Negociando, Fechado, Entrega, Pós-venda, Perdido) como ponto de partida.'
              : 'Sem etapas, o Funil e a aba Pedido do Inbox ficam vazios. Peça para um admin ou gerente configurar as etapas.'
          }
          action={
            canManageStages ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={handleSeedDefaults} variant="secondary" disabled={seeding}>
                  <Sparkles className="w-4 h-4" />
                  <span>{seeding ? 'Criando...' : 'Usar modelo padrão'}</span>
                </Button>
                <Button onClick={openCreate} variant="primary">
                  <Plus className="w-4 h-4" />
                  <span>Criar primeira etapa</span>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardHeader className="flex justify-between items-center">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Etapas cadastradas ({stages.length})
            </h2>
            <Button variant="secondary" size="sm" onClick={fetchStages}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-slate-800">
              {stages.map((stage, index) => (
                <div key={stage.id} className="p-4 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    {canManageStages && (
                      <div className="flex flex-col shrink-0">
                        <button
                          type="button"
                          onClick={() => void moveStage(index, -1)}
                          disabled={index === 0}
                          className="p-0.5 text-slate-500 hover:text-emerald-400 disabled:opacity-20 disabled:hover:text-slate-500 transition"
                          title="Mover pra cima"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveStage(index, 1)}
                          disabled={index === stages.length - 1}
                          className="p-0.5 text-slate-500 hover:text-emerald-400 disabled:opacity-20 disabled:hover:text-slate-500 transition"
                          title="Mover pra baixo"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={stage.color}>{stage.label}</Badge>
                        {stage.isWon && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                            <Trophy className="w-3 h-3" /> Etapa de ganho
                          </span>
                        )}
                        {stage.isLost && (
                          <span className="flex items-center gap-1 text-[10px] text-rose-400 font-semibold">
                            <XCircle className="w-3 h-3" /> Etapa de perda
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {canManageStages && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(stage)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-emerald-400 transition"
                        title="Editar etapa"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void requestDelete(stage)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                        title="Excluir etapa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={isEditing ? 'Editar Etapa' : 'Nova Etapa'}
        icon={<ListOrdered className="w-5 h-5" />}
      >
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <Input
            label="Nome da Etapa *"
            required
            placeholder="Ex: Faltando peças"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Cor</label>
            <div className="flex flex-wrap gap-2">
              {STAGE_COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, color })}
                  className={`px-2 py-1 rounded-lg border transition ${
                    form.color === color ? 'border-emerald-500 ring-1 ring-emerald-500/40' : 'border-transparent'
                  }`}
                  title={COLOR_LABELS[color]}
                >
                  <Badge variant={color}>{COLOR_LABELS[color]}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={form.isWon}
                onChange={(e) => setForm({ ...form, isWon: e.target.checked, isLost: e.target.checked ? false : form.isLost })}
                className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              <span>Etapa de ganho (marca a venda como fechada ao chegar aqui)</span>
            </label>
            <label className="flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={form.isLost}
                onChange={(e) => setForm({ ...form, isLost: e.target.checked, isWon: e.target.checked ? false : form.isWon })}
                className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500"
              />
              <span>Etapa de perda (pedido não foi adiante)</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              {isEditing ? 'Salvar Alterações' : 'Criar Etapa'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir Etapa"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300">
            Tem certeza que deseja excluir <strong className="text-slate-100">{deleteTarget?.label}</strong>? Essa ação
            não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

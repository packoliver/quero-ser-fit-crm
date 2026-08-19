'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Zap, Plus, Pencil, Trash2, AlertCircle, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Toast } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/client'

export interface QuickReply {
  id: string
  shortcut: string | null
  title: string
  content: string
}

const emptyForm = { id: '', shortcut: '', title: '', content: '' }

export default function RespostasRapidasPage() {
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const isEditing = !!form.id

  const [deleteTarget, setDeleteTarget] = useState<QuickReply | null>(null)

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

  const fetchReplies = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: QuickReply[] | null; error: { message: string } | null }>
          }
        }
      })
        .from('quick_replies')
        .select('id, shortcut, title, content')
        .order('title', { ascending: true })

      if (dbError) {
        setError('Não foi possível carregar as respostas rápidas.')
        return
      }
      setReplies(data || [])
    } catch {
      setError('Erro de conexão ao carregar respostas rápidas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchReplies()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchReplies])

  const openCreate = () => {
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (reply: QuickReply) => {
    setForm({ id: reply.id, shortcut: reply.shortcut || '', title: reply.title, content: reply.content })
    setFormOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        shortcut: form.shortcut.trim() || null,
      }

      if (isEditing) {
        const { error: dbError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (v: typeof payload) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
          }
        })
          .from('quick_replies')
          .update(payload)
          .eq('id', form.id)

        if (dbError) {
          setError(dbError.message.includes('duplicate') ? 'Já existe uma resposta com esse atalho.' : 'Falha ao salvar a resposta rápida.')
          return
        }
        showToast('Resposta rápida atualizada!')
      } else {
        const { error: dbError } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (v: typeof payload) => Promise<{ error: { message: string; code?: string } | null }>
          }
        })
          .from('quick_replies')
          .insert(payload)

        if (dbError) {
          setError(dbError.code === '23505' ? 'Já existe uma resposta com esse atalho.' : 'Falha ao criar a resposta rápida.')
          return
        }
        showToast('Resposta rápida criada!')
      }

      setFormOpen(false)
      fetchReplies()
    } catch {
      setError('Erro de conexão ao salvar.')
    } finally {
      setSaving(false)
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
        .from('quick_replies')
        .delete()
        .eq('id', deleteTarget.id)

      if (dbError) {
        setError('Falha ao excluir a resposta rápida.')
        setDeleteTarget(null)
        return
      }
      showToast('Resposta rápida excluída.')
      fetchReplies()
    } catch {
      setError('Erro de conexão ao excluir.')
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto relative">
      <Toast message={toast} />

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            Respostas Rápidas
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Mensagens prontas que qualquer atendente pode inserir com um clique no Inbox — pra não digitar a
            mesma resposta toda hora.
          </p>
        </div>
        <Button onClick={openCreate} variant="primary">
          <Plus className="w-4 h-4" />
          <span>Nova Resposta</span>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Biblioteca da Equipe ({replies.length})
          </h2>
          <Button variant="secondary" size="sm" onClick={fetchReplies}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {replies.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              {loading ? 'Carregando...' : 'Nenhuma resposta rápida cadastrada ainda. Crie a primeira!'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {replies.map((reply) => (
                <div key={reply.id} className="p-4 flex items-start justify-between gap-3 hover:bg-slate-800/40 transition">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-100 text-xs">{reply.title}</span>
                      {reply.shortcut && (
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                          /{reply.shortcut}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 text-xs mt-1 line-clamp-2 whitespace-pre-wrap">{reply.content}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(reply)}
                      className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-emerald-400 transition"
                      title="Editar resposta rápida"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(reply)}
                      className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                      title="Excluir resposta rápida"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={isEditing ? 'Editar Resposta Rápida' : 'Nova Resposta Rápida'}
        icon={<Zap className="w-5 h-5" />}
      >
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <Input
            label="Título *"
            required
            placeholder="Ex: Prazo de entrega"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />

          <Input
            label="Atalho (opcional)"
            placeholder="Ex: entrega"
            helperText="Só pra organizar — sem espaços ou barra."
            value={form.shortcut}
            onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
          />

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Conteúdo *
            </label>
            <textarea
              required
              rows={5}
              placeholder="O texto que vai ser inserido na conversa..."
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              {isEditing ? 'Salvar Alterações' : 'Criar Resposta'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir Resposta Rápida"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300">
            Tem certeza que deseja excluir <strong className="text-slate-100">{deleteTarget?.title}</strong>? Essa
            ação não pode ser desfeita.
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

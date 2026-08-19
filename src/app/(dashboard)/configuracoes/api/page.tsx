'use client'

import { useState, useEffect, useCallback } from 'react'
import { Code2, Plus, Trash2, AlertCircle, CheckCircle2, Copy, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Toast } from '@/components/ui/Toast'

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export default function ApiConfigPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/api-keys')
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Falha ao carregar as chaves de API.')
        return
      }
      setKeys(body.keys || [])
    } catch {
      setError('Erro de conexão ao carregar as chaves.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchKeys()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchKeys])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Falha ao criar a chave.')
        return
      }
      setJustCreatedKey(body.key)
      setNewKeyName('')
      fetchKeys()
    } catch {
      setError('Erro de conexão ao criar a chave.')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setError(null)
    try {
      const res = await fetch(`/api/api-keys/${revokeTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Falha ao revogar a chave.')
        setRevokeTarget(null)
        return
      }
      showToast('Chave revogada.')
      fetchKeys()
    } catch {
      setError('Erro de conexão ao revogar.')
    } finally {
      setRevokeTarget(null)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text)
    showToast('Copiado!')
  }

  const closeCreateModal = () => {
    setCreateModalOpen(false)
    setJustCreatedKey(null)
    setNewKeyName('')
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-4xl mx-auto relative">
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
            <Code2 className="w-5 h-5 text-emerald-400" />
            API Pública
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Chaves de API pra ferramentas externas (Zapier, Google Sheets, Make, scripts) lerem os dados do seu
            CRM.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
          <Plus className="w-4 h-4" />
          <span>Nova Chave</span>
        </Button>
      </div>

      <Card className="p-4 space-y-2 text-xs">
        <h2 className="font-semibold text-slate-200">Como usar</h2>
        <p className="text-slate-400">
          Envie a chave no cabeçalho <code className="bg-slate-900 px-1.5 py-0.5 rounded text-emerald-400">Authorization: Bearer sua_chave</code> em
          um GET pra um destes endereços:
        </p>
        <div className="space-y-1 font-mono text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-3">
          <p>GET {baseUrl}/api/public/v1/contacts</p>
          <p>GET {baseUrl}/api/public/v1/conversations</p>
          <p>GET {baseUrl}/api/public/v1/deals</p>
        </div>
        <p className="text-slate-500">
          Aceita <code className="bg-slate-900 px-1 rounded">?limit=50&amp;offset=0</code> pra paginação (máximo 200 por página).
        </p>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Suas Chaves</h2>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs">Carregando...</div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">Nenhuma chave criada ainda.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                    <th className="py-3 px-4">Nome</th>
                    <th className="py-3 px-4">Chave</th>
                    <th className="py-3 px-4">Criada em</th>
                    <th className="py-3 px-4">Último uso</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {keys.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3.5 px-4 font-semibold">{k.name}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-400">{k.key_prefix}…</td>
                      <td className="py-3.5 px-4 text-slate-400">{new Date(k.created_at).toLocaleDateString('pt-BR')}</td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString('pt-BR') : 'Nunca usada'}
                      </td>
                      <td className="py-3.5 px-4">
                        {k.revoked_at ? <Badge variant="rose">Revogada</Badge> : <Badge variant="emerald">Ativa</Badge>}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {!k.revoked_at && (
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(k)}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                            title="Revogar chave"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={createModalOpen} onClose={closeCreateModal} title="Nova Chave de API" icon={<Code2 className="w-5 h-5" />}>
        {justCreatedKey ? (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Copie a chave agora — ela não aparece de novo depois de fechar isso.</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] text-emerald-400 break-all">
              <span className="flex-1">{justCreatedKey}</span>
              <button type="button" onClick={() => copyToClipboard(justCreatedKey)} className="shrink-0 text-slate-400 hover:text-emerald-400">
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={closeCreateModal}>
                Entendi, fechar
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-3 text-xs">
            <Input
              label="Nome da chave *"
              required
              placeholder="Ex: Zapier, Planilha de vendas"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={closeCreateModal}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit" isLoading={creating}>
                Gerar Chave
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Revoke Confirmation Modal */}
      <Modal isOpen={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Revogar Chave" icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}>
        <div className="space-y-4 text-xs">
          <p className="text-slate-300">
            Tem certeza que deseja revogar <strong className="text-slate-100">{revokeTarget?.name}</strong>? Qualquer
            integração usando essa chave para de funcionar imediatamente.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleRevoke}>
              Revogar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

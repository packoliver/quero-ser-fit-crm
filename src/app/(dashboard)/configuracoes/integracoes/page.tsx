'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Phone,
  Info,
  AlertCircle,
  Plus,
  Trash2,
  CheckCircle2,
  QrCode,
  Cloud,
  Loader2,
} from 'lucide-react'
import { InstagramIcon as Instagram } from '@/components/icons/InstagramIcon'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'

type Provider = 'whatsapp_meta' | 'whatsapp_zapi' | 'instagram_meta'
type ConnectionMethod = 'cloud_api' | 'zapi'

interface Connection {
  id: string
  provider: Provider
  label: string
  connection_method: ConnectionMethod
  external_identifier: string | null
  status: 'active' | 'inactive' | 'error'
  settings: Record<string, unknown> | null
  created_at: string
}

export default function IntegracoesConfigPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formWarning, setFormWarning] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [form, setForm] = useState({
    provider: 'whatsapp_meta' as Provider,
    connectionMethod: 'cloud_api' as ConnectionMethod,
    label: '',
    externalIdentifier: '',
    accessToken: '',
    instanceId: '',
    instanceToken: '',
    clientToken: '',
  })

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/integrations/connections')
      const body = await res.json()
      if (!res.ok) {
        setLoadError(body.error || 'Falha ao carregar conexões.')
        setConnections([])
        return
      }
      setConnections(body.connections || [])
    } catch {
      setLoadError('Erro de conexão ao carregar integrações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchConnections()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchConnections])

  const resetForm = () => {
    setForm({
      provider: 'whatsapp_meta',
      connectionMethod: 'cloud_api',
      label: '',
      externalIdentifier: '',
      accessToken: '',
      instanceId: '',
      instanceToken: '',
      clientToken: '',
    })
    setFormError(null)
    setFormWarning(null)
  }

  const openModal = () => {
    resetForm()
    setModalOpen(true)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormWarning(null)
    setSaving(true)

    const payload =
      form.connectionMethod === 'cloud_api'
        ? {
            connectionMethod: 'cloud_api',
            provider: form.provider,
            label: form.label,
            externalIdentifier: form.externalIdentifier,
            accessToken: form.accessToken,
          }
        : {
            connectionMethod: 'zapi',
            provider: 'whatsapp_zapi',
            label: form.label,
            instanceId: form.instanceId,
            instanceToken: form.instanceToken,
            clientToken: form.clientToken,
          }

    try {
      const res = await fetch('/api/integrations/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()

      if (!res.ok) {
        setFormError(body.error || 'Falha ao criar conexão.')
        setSaving(false)
        return
      }

      if (body.warning) {
        setFormWarning(body.warning)
        setSaving(false)
        fetchConnections()
        return
      }

      showToast(`Conexão "${form.label}" criada com sucesso!`)
      setModalOpen(false)
      fetchConnections()
    } catch {
      setFormError('Erro de conexão ao criar a integração.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (conn: Connection) => {
    if (!confirm(`Remover a conexão "${conn.label}"? Isso não pode ser desfeito.`)) return

    try {
      const res = await fetch(`/api/integrations/connections/${conn.id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) {
        showToast(body.error || 'Falha ao remover conexão.')
        return
      }
      showToast(`Conexão "${conn.label}" removida.`)
      fetchConnections()
    } catch {
      showToast('Erro de conexão ao remover.')
    }
  }

  const providerLabel = (p: Provider) => (p === 'instagram_meta' ? 'Instagram' : 'WhatsApp')

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Integrações do CRM</h1>
          <p className="text-xs text-slate-400 mt-1">
            Conecte quantos números de WhatsApp e páginas de Instagram forem necessários — cada um vira uma conexão independente.
          </p>
        </div>
        <Button onClick={openModal} variant="primary">
          <Plus className="w-4 h-4" />
          <span>Adicionar Número/Página</span>
        </Button>
      </div>

      {loadError && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Connections Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando conexões...
        </div>
      ) : connections.length === 0 ? (
        <Card className="p-8 text-center text-xs text-slate-400 space-y-2">
          <Info className="w-6 h-6 mx-auto text-slate-500" />
          <p>Nenhuma conexão cadastrada ainda. Clique em &ldquo;Adicionar Número/Página&rdquo; pra começar.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {connections.map((conn) => (
            <Card key={conn.id} className="flex flex-col justify-between">
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-xl bg-slate-800 text-emerald-400 border border-slate-700">
                    {conn.provider === 'instagram_meta' ? (
                      <Instagram className="w-5 h-5 text-pink-400" />
                    ) : (
                      <Phone className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      variant={conn.status === 'active' ? 'emerald' : conn.status === 'error' ? 'rose' : 'amber'}
                      icon={<AlertCircle className="w-3 h-3" />}
                    >
                      {conn.status === 'active' ? 'Ativa' : conn.status === 'error' ? 'Erro' : 'Inativa'}
                    </Badge>
                    <Badge variant="indigo" icon={conn.connection_method === 'cloud_api' ? <Cloud className="w-3 h-3" /> : <QrCode className="w-3 h-3" />}>
                      {conn.connection_method === 'cloud_api' ? 'Cloud API' : 'Z-API'}
                    </Badge>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-bold text-slate-100">{conn.label}</h2>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {providerLabel(conn.provider)}
                    {conn.external_identifier ? ` · ${conn.external_identifier}` : ' · aguardando identificador'}
                  </p>
                </div>
              </CardHeader>

              <CardBody className="bg-slate-950/40 border-t border-slate-800 text-xs flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  Criada em {new Date(conn.created_at).toLocaleDateString('pt-BR')}
                </span>
                <button
                  onClick={() => handleDelete(conn)}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                  title="Remover conexão"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Webhook Endpoints Info Box */}
      <Card className="p-5 text-xs space-y-4">
        <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-emerald-400" />
          <span>Endpoints de Webhook</span>
        </h3>

        <div className="space-y-1.5">
          <p className="text-slate-400">Cloud API oficial — configure no painel de desenvolvedor da Meta (WhatsApp/Instagram → Webhooks):</p>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono space-y-1 text-[11px]">
            <div className="text-slate-400"><strong className="text-emerald-400">Endpoint:</strong> /api/webhooks/meta</div>
            <div className="text-slate-400"><strong className="text-emerald-400">Verify Token:</strong> valor de META_WEBHOOK_VERIFY_TOKEN no ambiente</div>
            <div className="text-slate-400"><strong className="text-emerald-400">Segurança:</strong> HMAC SHA-256 (X-Hub-Signature-256) com META_APP_SECRET</div>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-slate-400">Z-API — configure no painel da Z-API (Instância → Webhooks → &ldquo;Ao receber&rdquo;):</p>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono space-y-1 text-[11px]">
            <div className="text-slate-400"><strong className="text-emerald-400">Endpoint:</strong> /api/webhooks/zapi?secret=SEU_ZAPI_WEBHOOK_SECRET</div>
            <div className="text-slate-400"><strong className="text-emerald-400">Segurança:</strong> segredo próprio na URL (ZAPI_WEBHOOK_SECRET no ambiente) — a Z-API não assina webhooks</div>
          </div>
        </div>
      </Card>

      {/* Modal Add Connection */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Adicionar Número/Página" icon={<Plus className="w-5 h-5" />}>
        <form onSubmit={handleCreate} className="space-y-3 text-xs">
          {formError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{formError}</span>
            </div>
          )}
          {formWarning && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{formWarning}</span>
            </div>
          )}

          <Select
            label="Método de Conexão *"
            value={form.connectionMethod}
            onChange={(e) => {
              const method = e.target.value as ConnectionMethod
              setForm((prev) => ({
                ...prev,
                connectionMethod: method,
                provider: method === 'zapi' ? 'whatsapp_zapi' : 'whatsapp_meta',
              }))
            }}
            options={[
              { value: 'cloud_api', label: 'Cloud API Oficial (WhatsApp ou Instagram)' },
              { value: 'zapi', label: 'Z-API / WhatsApp Web (não-oficial, via z-api.io — só WhatsApp)' },
            ]}
          />

          {form.connectionMethod === 'cloud_api' && (
            <Select
              label="Plataforma *"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value as Provider })}
              options={[
                { value: 'whatsapp_meta', label: 'WhatsApp' },
                { value: 'instagram_meta', label: 'Instagram' },
              ]}
            />
          )}

          <Input
            label="Nome desta Conexão *"
            required
            placeholder="Ex: Loja Centro, Atendimento SP..."
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />

          {form.connectionMethod === 'cloud_api' ? (
            <>
              <Input
                label={form.provider === 'instagram_meta' ? 'Page ID (Instagram) *' : 'Phone Number ID *'}
                required
                placeholder={form.provider === 'instagram_meta' ? 'Ex: 178234567890123' : 'Ex: 109876543210987'}
                value={form.externalIdentifier}
                onChange={(e) => setForm({ ...form, externalIdentifier: e.target.value })}
              />
              <Input
                label="Token de Acesso Permanente *"
                required
                type="password"
                placeholder="Token gerado no Meta Business Manager"
                value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              />
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-[11px] text-emerald-300">
                O token é validado direto com a Meta e criptografado (AES-256) antes de ser salvo no banco.
              </div>
            </>
          ) : (
            <>
              <Input
                label="Instance ID *"
                required
                placeholder="ID da instância no painel da Z-API"
                value={form.instanceId}
                onChange={(e) => setForm({ ...form, instanceId: e.target.value })}
              />
              <Input
                label="Instance Token *"
                required
                type="password"
                placeholder="Token da instância no painel da Z-API"
                value={form.instanceToken}
                onChange={(e) => setForm({ ...form, instanceToken: e.target.value })}
              />
              <Input
                label="Client-Token (opcional)"
                type="password"
                placeholder="Só se você ativou a segurança por Account Security Token"
                value={form.clientToken}
                onChange={(e) => setForm({ ...form, clientToken: e.target.value })}
              />
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-[11px] text-emerald-300">
                As credenciais são validadas direto com a Z-API (checa se o dispositivo está conectado) e criptografadas antes de salvar.
              </div>
              <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-300">
                Risco de banimento do número pelo WhatsApp — automação não-oficial do WhatsApp Web, terceirizada pra Z-API.
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" isLoading={saving}>
              Criar Conexão
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

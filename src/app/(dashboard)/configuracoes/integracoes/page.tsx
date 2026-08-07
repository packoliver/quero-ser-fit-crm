'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Phone,
  Info,
  AlertCircle,
  Plus,
  Trash2,
  CheckCircle2,
  Cloud,
  QrCode,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { InstagramIcon as Instagram } from '@/components/icons/InstagramIcon'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'

type Provider = 'whatsapp_meta' | 'instagram_meta' | 'whatsapp_uazapi'
type ConnectionMethod = 'cloud_api' | 'uazapi'

interface Connection {
  id: string
  provider: Provider
  label: string
  connection_method: ConnectionMethod
  external_identifier: string | null
  api_base_url: string | null
  status: 'active' | 'inactive' | 'error'
  settings: Record<string, unknown> | null
  created_at: string
}

const QR_POLL_INTERVAL_MS = 3000
const QR_TIMEOUT_MS = 2 * 60 * 1000

export default function IntegracoesConfigPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formWarning, setFormWarning] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [form, setForm] = useState({
    connectionMethod: 'cloud_api' as ConnectionMethod,
    provider: 'whatsapp_meta' as Provider,
    label: '',
    externalIdentifier: '',
    accessToken: '',
    apiBaseUrl: '',
    instanceToken: '',
  })

  // QR Code modal (uazapi only)
  const [qrModal, setQrModal] = useState<{ connId: string; label: string } | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [paircode, setPaircode] = useState<string | null>(null)
  const [qrConnected, setQrConnected] = useState(false)
  const [qrTimedOut, setQrTimedOut] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const resetForm = () => {
    setForm({
      connectionMethod: 'cloud_api',
      provider: 'whatsapp_meta',
      label: '',
      externalIdentifier: '',
      accessToken: '',
      apiBaseUrl: '',
      instanceToken: '',
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
            connectionMethod: 'uazapi',
            provider: 'whatsapp_uazapi',
            label: form.label,
            apiBaseUrl: form.apiBaseUrl,
            instanceToken: form.instanceToken,
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

  const handleVerify = async (conn: Connection) => {
    setVerifyingId(conn.id)
    try {
      const res = await fetch(`/api/integrations/connections/${conn.id}/verify`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showToast(body.error || 'Falha ao reverificar conexão.')
        return
      }
      if (body.connection?.status === 'active') {
        showToast(body.warning ? `Conexão "${conn.label}" ativa! ${body.warning}` : `Conexão "${conn.label}" está ativa!`)
      } else {
        showToast(body.warning || `Conexão "${conn.label}" ainda não confirmada.`)
      }
      fetchConnections()
    } catch {
      showToast('Erro de conexão ao reverificar.')
    } finally {
      setVerifyingId(null)
    }
  }

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const closeQrModal = () => {
    stopPolling()
    setQrModal(null)
    setQrImage(null)
    setPaircode(null)
    setQrConnected(false)
    setQrTimedOut(false)
    setQrError(null)
  }

  const pollQrStatus = useCallback(
    async (connId: string, deadline: number) => {
      try {
        const res = await fetch(`/api/integrations/connections/${connId}/connect`)
        const body = await res.json()
        if (!res.ok) {
          setQrError(body.error || 'Falha ao consultar status da conexão.')
          return
        }
        if (body.qrcode) setQrImage(body.qrcode)
        if (body.paircode) setPaircode(body.paircode)
        if (body.connected) {
          setQrConnected(true)
          stopPolling()
          showToast('WhatsApp conectado com sucesso!')
          fetchConnections()
          return
        }
        if (Date.now() > deadline) {
          setQrTimedOut(true)
          stopPolling()
        }
      } catch {
        setQrError('Erro de conexão ao consultar status.')
      }
    },
    [fetchConnections]
  )

  const handleOpenQr = useCallback(async (conn: Connection) => {
    setQrModal({ connId: conn.id, label: conn.label })
    setQrImage(null)
    setPaircode(null)
    setQrConnected(false)
    setQrTimedOut(false)
    setQrError(null)

    try {
      const res = await fetch(`/api/integrations/connections/${conn.id}/connect`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setQrError(body.error || 'Falha ao iniciar conexão.')
        return
      }
      if (body.qrcode) setQrImage(body.qrcode)
      if (body.paircode) setPaircode(body.paircode)
      if (body.connected) {
        setQrConnected(true)
        fetchConnections()
        return
      }

      const deadline = Date.now() + QR_TIMEOUT_MS
      pollRef.current = setInterval(() => {
        void pollQrStatus(conn.id, deadline)
      }, QR_POLL_INTERVAL_MS)
    } catch {
      setQrError('Erro de conexão ao iniciar o processo de conexão.')
    }
  }, [pollQrStatus, fetchConnections])

  const providerLabel = (p: Provider) => (p === 'instagram_meta' ? 'Instagram' : 'WhatsApp')
  const methodLabel = (m: ConnectionMethod) => (m === 'cloud_api' ? 'Cloud API' : 'uazapi')

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
                      {methodLabel(conn.connection_method)}
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
                <div className="flex items-center gap-1.5">
                  {conn.connection_method === 'uazapi' && conn.status !== 'active' && (
                    <button
                      onClick={() => handleOpenQr(conn)}
                      className="p-1.5 rounded-lg bg-slate-900 hover:bg-emerald-950/60 border border-slate-700 hover:border-emerald-800 text-slate-400 hover:text-emerald-400 transition"
                      title="Conectar via QR Code"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {/* Sempre visível, mesmo com status "Ativa" — a conexão pode continuar
                      ativa enquanto o registro do webhook na uazapi fica desatualizado
                      por fora (ex: alguém mexeu manualmente no painel deles), e sem
                      poder reverificar nesse estado não havia como consertar sem apagar
                      e recriar a conexão inteira. */}
                  <button
                    onClick={() => handleVerify(conn)}
                    disabled={verifyingId === conn.id}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-emerald-950/60 border border-slate-700 hover:border-emerald-800 text-slate-400 hover:text-emerald-400 transition disabled:opacity-50"
                    title="Reverificar conexão e reforçar o registro do webhook (usa a credencial já salva)"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${verifyingId === conn.id ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(conn)}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                    title="Remover conexão"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
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
          <p className="text-slate-400">uazapi — o webhook é registrado automaticamente na instância assim que você cadastra a conexão (ou clica em Reverificar), não precisa configurar nada manualmente no painel deles:</p>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono space-y-1 text-[11px]">
            <div className="text-slate-400"><strong className="text-emerald-400">Endpoint:</strong> /api/webhooks/uazapi/&#123;segredo&#125;</div>
            <div className="text-slate-400"><strong className="text-emerald-400">Segurança:</strong> a uazapi não assina webhooks (sem HMAC) — um segredo aleatório único por conexão fica embutido no próprio caminho da URL</div>
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
                provider: method === 'uazapi' ? 'whatsapp_uazapi' : 'whatsapp_meta',
              }))
            }}
            options={[
              { value: 'cloud_api', label: 'Cloud API Oficial (WhatsApp ou Instagram)' },
              { value: 'uazapi', label: 'uazapi / WhatsApp Web (não-oficial — só WhatsApp)' },
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
                label="Base URL da Instância *"
                required
                placeholder="Ex: https://minhaempresa.uazapi.com"
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
              />
              <Input
                label="Token da Instância *"
                required
                type="password"
                placeholder="Token gerado ao criar a instância na uazapi"
                value={form.instanceToken}
                onChange={(e) => setForm({ ...form, instanceToken: e.target.value })}
              />
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-[11px] text-emerald-300">
                Crie a instância no painel/API da sua conta uazapi primeiro (ela te dá a Base URL e o Token). Depois de
                salvar aqui, clique no ícone de QR Code no card da conexão pra escanear e conectar o WhatsApp — sem
                precisar sair do CRM.
              </div>
              <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-300">
                Risco de banimento do número pelo WhatsApp — automação não-oficial do WhatsApp Web. A uazapi recomenda
                usar contas WhatsApp Business.
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

      {/* QR Code Modal (uazapi) */}
      <Modal isOpen={!!qrModal} onClose={closeQrModal} title={`Conectar "${qrModal?.label || ''}"`} icon={<QrCode className="w-5 h-5" />}>
        <div className="space-y-3 text-xs text-center">
          {qrError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 flex items-center gap-2.5 text-left">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{qrError}</span>
            </div>
          )}

          {qrConnected ? (
            <div className="p-6 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <span className="font-semibold">WhatsApp conectado com sucesso!</span>
            </div>
          ) : qrTimedOut ? (
            <div className="p-6 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 flex flex-col items-center gap-3">
              <AlertCircle className="w-8 h-8 text-amber-400" />
              <span>O QR Code expirou sem confirmação. Feche e clique no ícone de QR Code de novo pra gerar um novo.</span>
            </div>
          ) : qrImage ? (
            <>
              <p className="text-slate-400">Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho, e escaneie:</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImage} alt="QR Code para conectar o WhatsApp" className="mx-auto rounded-xl border border-slate-700 w-56 h-56 object-contain bg-white p-2" />
              {paircode && (
                <p className="text-slate-400">
                  Ou use o código de pareamento: <span className="font-mono text-slate-200">{paircode}</span>
                </p>
              )}
              <p className="text-slate-500 flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Aguardando leitura...
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Gerando QR Code...
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="secondary" type="button" onClick={closeQrModal}>
              Fechar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

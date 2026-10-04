'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Toast } from '@/components/ui/Toast'

interface AiConfig {
  configured: boolean
  ai_gateway_url: string | null
  ai_gateway_model: string | null
  ai_gateway_api_key_masked: string | null
  has_api_key: boolean
}

export default function AiConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [form, setForm] = useState({ url: '', model: '', apiKey: '' })
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }, [])

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/configuracoes/ia')
      if (!res.ok) {
        setError('Falha ao carregar configurações.')
        return
      }
      const data = (await res.json()) as AiConfig
      setConfig(data)
      setForm({
        url: data.ai_gateway_url || '',
        model: data.ai_gateway_model || '',
        apiKey: '',
      })
    } catch {
      setError('Erro de conexão ao carregar configurações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        ai_gateway_url: form.url.trim() || null,
        ai_gateway_model: form.model.trim() || null,
      }
      // Só envia a chave se o usuário digitou algo — string vazia mantém a existente
      if (form.apiKey.trim()) {
        payload.ai_gateway_api_key = form.apiKey.trim()
      }

      const res = await fetch('/api/configuracoes/ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Erro desconhecido.' }))
        showToast(body.error || 'Falha ao salvar.')
        return
      }

      showToast('Configurações salvas com sucesso!')
      setForm((prev) => ({ ...prev, apiKey: '' }))
      void fetchConfig()
    } catch {
      showToast('Erro de conexão ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/mais"
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            Configurações de IA
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure o gateway de IA para Insights e análise de conversas
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-rose-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Gateway de IA (OmniRoute / OpenAI-compatible)</h2>
          <p className="text-xs text-slate-400 mt-1">
            A IA analisa conversas automaticamente e gera insights comerciais. Configure abaixo a URL, chave e modelo do seu gateway.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              URL do Gateway
            </label>
            <Input
              type="url"
              placeholder="https://api.omniroute.online/v1"
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              URL base da API compatível com OpenAI (sem barra final). Ex: <code className="text-slate-400">https://api.omniroute.online/v1</code>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              API Key
            </label>
            <Input
              type="password"
              placeholder={config?.has_api_key ? `Atual: ${config.ai_gateway_api_key_masked}` : 'Cole sua API key aqui'}
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {config?.has_api_key
                ? 'Deixe em branco para manter a chave atual. Preencha para substituir.'
                : 'Sua chave é criptografada antes de ser salva no banco.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Modelo / Rota
            </label>
            <Input
              type="text"
              placeholder="auto/cheap"
              value={form.model}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Nome do modelo ou rota no gateway. Ex: <code className="text-slate-400">auto/cheap</code>, <code className="text-slate-400">gpt-4o-mini</code>. Deixe vazio para usar o padrão.
            </p>
          </div>

          <div className="pt-2 flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar Configurações
                </>
              )}
            </Button>
            {config?.configured && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                IA ativa
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Como funciona</h2>
        </CardHeader>
        <CardBody>
          <ul className="text-xs text-slate-400 space-y-2 list-disc list-inside">
            <li>A IA analisa cada conversa automaticamente após novas mensagens</li>
            <li>Gera status (ok/atenção/risco), sinais e resumo comercial</li>
            <li>Os resultados aparecem na aba <strong>Insights</strong> do CRM</li>
            <li>A pergunta livre (&quot;Pergunte à IA&quot;) usa o mesmo gateway configurado aqui</li>
            <li>Sem gateway configurado, a feature de Insights fica desativada silenciosamente</li>
          </ul>
        </CardBody>
      </Card>

      {toast && <Toast message={toast} />}
    </div>
  )
}
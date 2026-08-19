'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, Save, AlertCircle, CheckCircle2, Star } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Toast } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_SCHEDULE, WEEKDAY_LABELS, WEEKDAY_ORDER, WeekSchedule, Weekday } from '@/lib/integrations/business-hours'

const DEFAULT_MESSAGE =
  'Olá! No momento estamos fora do nosso horário de atendimento. Assim que reabrirmos, respondemos sua mensagem. 💪'
const DEFAULT_CSAT_REQUEST = 'De 1 a 5, como foi seu atendimento hoje? Responda só com o número. 🙏'
const DEFAULT_CSAT_THANKS = 'Muito obrigado pela sua avaliação! 💚'

export default function HorarioAtendimentoPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [schedule, setSchedule] = useState<WeekSchedule>(DEFAULT_SCHEDULE)
  const [autoReplyMessage, setAutoReplyMessage] = useState(DEFAULT_MESSAGE)

  const [csatEnabled, setCsatEnabled] = useState(false)
  const [csatRequestMessage, setCsatRequestMessage] = useState(DEFAULT_CSAT_REQUEST)
  const [csatThankYouMessage, setCsatThankYouMessage] = useState(DEFAULT_CSAT_THANKS)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient() as unknown as {
        auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: { organization_id: string } | null }> } }
          }
        }
      }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Não autenticado.')
        setLoading(false)
        return
      }

      const { data: membership } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (!membership) {
        setError('Usuário sem organização associada.')
        setLoading(false)
        return
      }
      setOrgId(membership.organization_id)

      const settingsClient = createClient() as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: { enabled: boolean; schedule: WeekSchedule; auto_reply_message: string } | null }> }
          }
        }
      }
      const { data: settings } = await settingsClient
        .from('business_hours_settings')
        .select('enabled, schedule, auto_reply_message')
        .eq('organization_id', membership.organization_id)
        .maybeSingle()

      if (settings) {
        setEnabled(settings.enabled)
        setSchedule(settings.schedule)
        setAutoReplyMessage(settings.auto_reply_message)
      }

      const orgClient = createClient() as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: { csat_enabled: boolean; csat_request_message: string; csat_thank_you_message: string } | null }> }
          }
        }
      }
      const { data: orgSettings } = await orgClient
        .from('organizations')
        .select('csat_enabled, csat_request_message, csat_thank_you_message')
        .eq('id', membership.organization_id)
        .maybeSingle()

      if (orgSettings) {
        setCsatEnabled(orgSettings.csat_enabled)
        setCsatRequestMessage(orgSettings.csat_request_message)
        setCsatThankYouMessage(orgSettings.csat_thank_you_message)
      }
    } catch {
      setError('Erro de conexão ao carregar as configurações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchSettings()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchSettings])

  const updateDay = (day: Weekday, patch: Partial<WeekSchedule[Weekday]>) => {
    setSchedule((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }))
  }

  const handleSave = async () => {
    if (!orgId) return
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient() as unknown as {
        from: (t: string) => {
          upsert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
          update: (v: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
        }
      }
      const { error: dbError } = await supabase.from('business_hours_settings').upsert({
        organization_id: orgId,
        enabled,
        schedule,
        auto_reply_message: autoReplyMessage,
      })

      if (dbError) {
        setError('Falha ao salvar o horário de atendimento.')
        return
      }

      const { error: orgError } = await supabase
        .from('organizations')
        .update({
          csat_enabled: csatEnabled,
          csat_request_message: csatRequestMessage,
          csat_thank_you_message: csatThankYouMessage,
        })
        .eq('id', orgId)

      if (orgError) {
        setError('Falha ao salvar as configurações de avaliação (CSAT).')
        return
      }

      showToast('Automações salvas!')
    } catch {
      setError('Erro de conexão ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-8 w-64 bg-slate-800 rounded-xl" />
        <div className="h-64 bg-[#0f172a] border border-slate-800 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-3xl mx-auto relative">
      <Toast message={toast} />

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-400" />
          Automações
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Horário de atendimento com resposta automática, e pedido de avaliação (CSAT) quando uma conversa é
          encerrada.
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Resposta Automática</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Quando ativada, o CRM responde sozinho (uma vez a cada 6h por conversa) quando um cliente escreve
              fora do horário abaixo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            role="switch"
            aria-checked={enabled}
            className={`relative w-11 h-6 rounded-full transition shrink-0 ${enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`}
            />
          </button>
        </CardHeader>

        <CardBody className="space-y-4">
          <div className="space-y-2">
            {WEEKDAY_ORDER.map((day) => (
              <div key={day} className="flex items-center gap-3 text-xs p-2.5 bg-slate-900/60 rounded-xl border border-slate-800">
                <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!schedule[day].closed}
                    onChange={(e) => updateDay(day, { closed: !e.target.checked })}
                    className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
                  />
                  <span className="font-medium text-slate-200">{WEEKDAY_LABELS[day]}</span>
                </label>

                {schedule[day].closed ? (
                  <span className="text-slate-500">Fechado</span>
                ) : (
                  <div className="flex items-center gap-2 text-slate-300">
                    <input
                      type="time"
                      value={schedule[day].open}
                      onChange={(e) => updateDay(day, { open: e.target.value })}
                      className="px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 text-xs"
                    />
                    <span className="text-slate-500">até</span>
                    <input
                      type="time"
                      value={schedule[day].close}
                      onChange={(e) => updateDay(day, { close: e.target.value })}
                      className="px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 text-xs"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Mensagem automática
            </label>
            <textarea
              rows={3}
              value={autoReplyMessage}
              onChange={(e) => setAutoReplyMessage(e.target.value)}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              Avaliação do Atendimento (CSAT)
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Quando ativada, ao encerrar uma conversa o CRM pede uma nota de 1 a 5 ao cliente e agradece
              automaticamente quando ele responde.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCsatEnabled((v) => !v)}
            role="switch"
            aria-checked={csatEnabled}
            className={`relative w-11 h-6 rounded-full transition shrink-0 ${csatEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${csatEnabled ? 'translate-x-5' : ''}`}
            />
          </button>
        </CardHeader>

        <CardBody className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Mensagem do pedido de avaliação
            </label>
            <textarea
              rows={2}
              value={csatRequestMessage}
              onChange={(e) => setCsatRequestMessage(e.target.value)}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Mensagem de agradecimento
            </label>
            <textarea
              rows={2}
              value={csatThankYouMessage}
              onChange={(e) => setCsatThankYouMessage(e.target.value)}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} isLoading={saving}>
          <Save className="w-4 h-4" />
          <span>Salvar Tudo</span>
        </Button>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_SCHEDULE, WEEKDAY_LABELS, WEEKDAY_ORDER, WeekSchedule, Weekday } from '@/lib/integrations/business-hours'

const DEFAULT_MESSAGE =
  'Olá! No momento estamos fora do nosso horário de atendimento. Assim que reabrirmos, respondemos sua mensagem. 💪'

export default function HorarioAtendimentoPage() {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [schedule, setSchedule] = useState<WeekSchedule>(DEFAULT_SCHEDULE)
  const [autoReplyMessage, setAutoReplyMessage] = useState(DEFAULT_MESSAGE)

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
        }
      }
      const { error: dbError } = await supabase.from('business_hours_settings').upsert({
        organization_id: orgId,
        enabled,
        schedule,
        auto_reply_message: autoReplyMessage,
      })

      if (dbError) {
        setError('Falha ao salvar as configurações.')
        return
      }
      showToast('Horário de atendimento salvo!')
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

      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-400" />
          Horário de Atendimento
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure quando sua equipe atende e uma resposta automática pra quando o cliente escrever fora desse
          horário.
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
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <Button variant="primary" onClick={handleSave} isLoading={saving}>
              <Save className="w-4 h-4" />
              <span>Salvar</span>
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

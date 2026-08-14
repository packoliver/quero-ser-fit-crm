'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Clock3,
  Sparkles,
  Database,
  AlertCircle,
  RefreshCw,
  Phone,
  MessageSquare,
  UserX,
} from 'lucide-react'
import { demoConversations } from '@/lib/demo'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import { cacheEntity, readCachedEntity } from '@/lib/offline/repository'
import { getOfflineScope } from '@/lib/offline/scope'

interface FollowUpItem {
  conversationId: string
  contactName: string
  contactPhone: string | null
  channelType: 'whatsapp' | 'instagram'
  lastMessageAt: string
  daysSince: number
}

const THRESHOLDS = [3, 7, 15, 30] as const

const msPerDay = 1000 * 60 * 60 * 24

export default function FollowUpPage() {
  const [viewMode, setViewMode] = useState<'demo' | 'real'>('real')
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState<(typeof THRESHOLDS)[number]>(7)

  const fetchRealFollowUps = useCallback(async () => {
    setLoading(true)
    setError(null)
    const offlineScope = await getOfflineScope().catch(() => null)
    if (!navigator.onLine && offlineScope) {
      const cached = await readCachedEntity<FollowUpItem[]>(offlineScope, 'follow-up')
      if (cached) {
        setItems(cached)
        setError('Você está offline. Exibindo dados armazenados neste dispositivo.')
      } else {
        setError('Sem conexão e sem dados de follow-up armazenados.')
      }
      setLoading(false)
      return
    }
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (
              col: string,
              opt: { ascending: boolean }
            ) => Promise<{
              data:
                | Array<{
                    id: string
                    channel_type: 'whatsapp' | 'instagram'
                    last_message_at: string
                    contacts: { name: string | null; phone: string | null; status: string | null; is_group: boolean | null } | null
                  }>
                | null
              error: { message: string } | null
            }>
          }
        }
      })
        .from('conversations')
        .select('id, channel_type, last_message_at, contacts(name, phone, status, is_group)')
        .order('last_message_at', { ascending: true })

      if (dbError) {
        setViewMode('demo')
      } else if (data) {
        const now = Date.now()
        const built = data
          // Grupos não são "clientes" que precisam de retomada de contato, e contatos
          // arquivados/bloqueados já foram deliberadamente tirados do fluxo ativo.
          .filter((c) => c.contacts && !c.contacts.is_group && c.contacts.status === 'active')
          .map<FollowUpItem>((c) => ({
            conversationId: c.id,
            contactName: c.contacts?.name || 'Contato',
            contactPhone: c.contacts?.phone || null,
            channelType: c.channel_type,
            lastMessageAt: c.last_message_at,
            daysSince: Math.floor((now - new Date(c.last_message_at).getTime()) / msPerDay),
          }))
          .sort((a, b) => b.daysSince - a.daysSince)

        setItems(built)
        if (offlineScope) await cacheEntity(offlineScope, 'follow-up', built)
      }
    } catch {
      const cached = offlineScope ? await readCachedEntity<FollowUpItem[]>(offlineScope, 'follow-up').catch(() => null) : null
      if (cached) {
        setItems(cached)
        setError('Não foi possível atualizar. Exibindo o último follow-up sincronizado.')
      } else {
        setViewMode('demo')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void fetchRealFollowUps(), 0)
    return () => clearTimeout(timer)
  }, [fetchRealFollowUps])

  // Modo demo: os dados de exemplo só têm horários de exibição ("10:42", "Ontem"), sem
  // data real — geramos uma contagem de dias ilustrativa (determinística por posição na
  // lista) só pra dar uma prévia de como a tela funciona, não pra representar dados reais.
  const demoItems: FollowUpItem[] = demoConversations.map((c, i) => ({
    conversationId: c.id,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    channelType: c.channel,
    lastMessageAt: '',
    daysSince: [2, 9, 18][i % 3],
  }))

  const activeItems = viewMode === 'real' ? items : demoItems
  const filteredItems = activeItems.filter((it) => it.daysSince >= threshold)

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-100">Follow-up</h1>
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
            Clientes ativos sem nenhuma mensagem (sua ou dele) há um tempo — pra ninguém sumir do radar.
          </p>
        </div>

        {viewMode === 'real' && (
          <Button variant="secondary" onClick={fetchRealFollowUps}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Threshold Tabs */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-3 flex items-center gap-1.5 flex-wrap text-xs">
        {THRESHOLDS.map((t) => {
          const count = activeItems.filter((it) => it.daysSince >= t).length
          return (
            <button
              key={t}
              onClick={() => setThreshold(t)}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                threshold === t ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}+ dias sem contato ({count})
            </button>
          )
        })}
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<Clock3 className="w-6 h-6" />}
          title="Ninguém parado nesse período"
          description={`Nenhum cliente ativo ficou ${threshold}+ dias sem mensagem. Ótimo sinal de acompanhamento!`}
        />
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((it) => (
            <div
              key={it.conversationId}
              className="p-4 bg-[#0f172a] border border-slate-800 rounded-2xl flex items-center gap-4 hover:border-slate-700 transition"
            >
              <Avatar name={it.contactName} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-100 truncate">{it.contactName}</h3>
                  <Badge variant={it.daysSince >= 30 ? 'rose' : it.daysSince >= 15 ? 'amber' : 'slate'}>
                    {it.daysSince} dia{it.daysSince === 1 ? '' : 's'} sem contato
                  </Badge>
                </div>
                {it.contactPhone && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                    <Phone className="w-3 h-3" />
                    {it.contactPhone}
                  </span>
                )}
              </div>

              {viewMode === 'real' ? (
                <Link href={`/inbox?conversa=${it.conversationId}`}>
                  <Button variant="secondary" size="sm">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Abrir conversa</span>
                  </Button>
                </Link>
              ) : (
                <Button variant="secondary" size="sm" disabled title="Disponível no modo com dados reais">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Abrir conversa</span>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {activeItems.length === 0 && !loading && viewMode === 'real' && (
        <EmptyState
          icon={<UserX className="w-6 h-6" />}
          title="Nenhum cliente ativo encontrado"
          description="Assim que houver conversas com clientes ativos, elas aparecem aqui ordenadas pelas que estão há mais tempo sem contato."
        />
      )}
    </div>
  )
}

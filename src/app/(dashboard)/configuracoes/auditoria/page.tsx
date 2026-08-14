'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, AlertCircle, UserPlus, ShieldCheck, Share2, Trash2, Info } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { cacheEntity, readCachedEntity } from '@/lib/offline/repository'
import { getOfflineScope } from '@/lib/offline/scope'

interface AuditLogRow {
  id: string
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, unknown> | null
  created_at: string
  actor: { full_name: string | null; email: string | null } | null
}

const PAGE_SIZE = 25

const ACTION_META: Record<string, { label: string; icon: typeof Info; variant: 'emerald' | 'teal' | 'rose' | 'indigo' }> = {
  member_created: { label: 'Membro cadastrado', icon: UserPlus, variant: 'emerald' },
  member_role_changed: { label: 'Cargo alterado', icon: ShieldCheck, variant: 'teal' },
  member_removed: { label: 'Membro removido', icon: Trash2, variant: 'rose' },
  integration_connection_created: { label: 'Conexão criada', icon: Share2, variant: 'indigo' },
  integration_connection_deleted: { label: 'Conexão removida', icon: Trash2, variant: 'rose' },
}

function describeDetails(action: string, details: Record<string, unknown> | null): string {
  if (!details) return ''
  switch (action) {
    case 'member_created':
      return `${details.fullName || ''} (${details.email || ''}) — cargo: ${details.role || '-'}`
    case 'member_role_changed':
      return `${details.from_role || '?'} → ${details.to_role || '?'}`
    case 'member_removed':
      return `Cargo removido: ${details.removed_role || '?'}`
    case 'integration_connection_created':
      return `${details.label || ''} (${details.connectionMethod || details.provider || ''})${details.verified === false ? ' — não verificada na hora' : ''}`
    default:
      return JSON.stringify(details)
  }
}

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)

  const fetchLogs = useCallback(async (offset: number) => {
    const offlineScope = await getOfflineScope().catch(() => null)
    if (!navigator.onLine && offlineScope) {
      const cached = await readCachedEntity<AuditLogRow[]>(offlineScope, 'audit-logs')
      if (cached) {
        if (offset === 0) setLogs(cached)
        return { rows: offset === 0 ? cached : [], ok: true }
      }
      setError('Sem conexão e sem log de auditoria armazenado neste dispositivo.')
      return { rows: [], ok: false }
    }
    const supabase = createClient()
    const { data, error: fetchError } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          order: (col: string, opt: { ascending: boolean }) => {
            range: (from: number, to: number) => Promise<{ data: AuditLogRow[] | null; error: { message: string } | null }>
          }
        }
      }
    })
      .from('audit_logs')
      .select('id, action, target_type, target_id, details, created_at, actor:profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (fetchError) {
      setError(
        fetchError.message.toLowerCase().includes('permission')
          ? 'Apenas administradores podem ver o log de auditoria.'
          : `Falha ao carregar o log de auditoria: ${fetchError.message}`
      )
      return { rows: [], ok: false }
    }

    if (data && offlineScope && offset === 0) await cacheEntity(offlineScope, 'audit-logs', data)
    return { rows: data || [], ok: true }
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      const { rows, ok } = await fetchLogs(0)
      if (ok) {
        setLogs(rows)
        setHasMore(rows.length === PAGE_SIZE)
      }
      setLoading(false)
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchLogs])

  const handleLoadMore = async () => {
    setLoadingMore(true)
    const { rows, ok } = await fetchLogs(logs.length)
    if (ok) {
      setLogs((prev) => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <History className="w-5 h-5 text-emerald-400" />
          Log de Auditoria
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Ações administrativas sensíveis registradas automaticamente: cadastro de membros, mudança de cargo, e gestão de integrações.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando log de auditoria...
        </div>
      ) : error ? null : logs.length === 0 ? (
        <Card className="p-8 text-center text-xs text-slate-400 space-y-2">
          <Info className="w-6 h-6 mx-auto text-slate-500" />
          <p>Nenhum evento registrado ainda. Ações administrativas futuras (cadastrar membro, trocar cargo, gerenciar integrações) vão aparecer aqui.</p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              {logs.length} evento{logs.length !== 1 ? 's' : ''} carregado{logs.length !== 1 ? 's' : ''}
            </CardHeader>
            <CardBody className="p-0 divide-y divide-slate-800/60">
              {logs.map((log) => {
                const meta = ACTION_META[log.action] || { label: log.action, icon: Info, variant: 'indigo' as const }
                const Icon = meta.icon
                return (
                  <div key={log.id} className="p-4 flex items-start gap-3 text-xs">
                    <div className="p-2 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <span className="text-slate-500">
                          por <strong className="text-slate-300">{log.actor?.full_name || log.actor?.email || 'Sistema'}</strong>
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="text-slate-500">{new Date(log.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-slate-400">{describeDetails(log.action, log.details)}</p>
                    </div>
                  </div>
                )
              })}
            </CardBody>
          </Card>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={handleLoadMore} isLoading={loadingMore}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { replayOfflineMutations } from '@/lib/offline/sync'
import type { OfflineScope } from '@/lib/offline/db'

export function NetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [showBackOnline, setShowBackOnline] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const syncCurrentScope = async () => {
      if (!navigator.onLine) return
      const supabase = (await import('@/lib/supabase/client')).createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: member } = await (supabase as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: { organization_id: string } | null }> } } } })
        .from('organization_members').select('organization_id').eq('user_id', user.id).single()
      if (!member || cancelled) return
      const result = await replayOfflineMutations({ userId: user.id, organizationId: member.organization_id } satisfies OfflineScope)
      if (!cancelled && (result.synced || result.failed || result.conflicts)) {
        // Quando dá pra identificar o registro (título/nome veio na resposta do
        // servidor), a mensagem fica acionável — "Fulano" foi alterado por outra pessoa —
        // em vez de só um número que não diz o que fazer com ele.
        const conflictLabels = result.conflictDetails.map((c) => c.label).filter((l): l is string => !!l)
        const conflictPart =
          result.conflicts > 0
            ? conflictLabels.length > 0
              ? ` "${conflictLabels.join('", "')}" foi alterado por outra pessoa enquanto você estava offline — sua edição NÃO foi salva, confira a versão atual.`
              : `, ${result.conflicts} conflito(s) — alguém alterou o registro enquanto você estava offline.`
            : ''
        setSyncMessage(`${result.synced} sincronizada(s), ${result.failed} falha(s)${conflictPart}`)
        // Some sozinho depois de um tempo — mas só quando não há conflito pra resolver
        // (esse fica na tela até a pessoa recarregar/navegar, de propósito: é o único
        // caso onde alguém precisa realmente fazer alguma coisa a respeito).
        if (result.conflicts === 0) {
          window.setTimeout(() => { if (!cancelled) setSyncMessage(null) }, 6000)
        }
      }
    }
    const handleOffline = () => setOnline(false)
    const handleOnline = () => {
      setOnline(true)
      setShowBackOnline(true)
      void syncCurrentScope()
      window.setTimeout(() => setShowBackOnline(false), 3000)
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    void syncCurrentScope()
    return () => {
      cancelled = true
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  if (online && !showBackOnline && !syncMessage) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[100] px-4 py-2 text-center text-xs font-medium shadow-lg ${online ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'}`}
    >
      {!online ? 'Você está offline. Os dados reais exibidos podem estar desatualizados; ações externas exigem conexão.' : syncMessage || 'Conexão restabelecida.'}
    </div>
  )
}

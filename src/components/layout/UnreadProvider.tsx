'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sumUnread } from '@/lib/inbox/unread'

interface UnreadContextValue {
  /** conversa → quantidade de não lidas. Conversa sem nenhuma fica fora do mapa. */
  counts: Record<string, number>
  /** Soma de tudo — é o número na bolinha de "Conversas" na barra inferior. */
  total: number
  /**
   * Zera o aviso desta conversa (chamado ao abri-la). Seguro chamar repetidamente.
   * @param seenUpTo data da mensagem mais recente já vista — quem chama sabe qual é. Antes
   * isso era deduzido de uma cópia local de TODAS as mensagens, que é justamente o que
   * deixou de ser carregado.
   */
  markRead: (conversationId: string, seenUpTo: string | null | undefined) => void
}

const UnreadContext = createContext<UnreadContextValue>({
  counts: {},
  total: 0,
  markRead: () => {},
})

/**
 * Estado de "não lido" do app inteiro, num lugar só.
 *
 * Vive no layout, e não dentro do Inbox, por um motivo concreto: quando a vendedora está no
 * Funil ou nas Tarefas, o Inbox não está montado. Se a contagem morasse lá, a bolinha da
 * barra inferior ficaria vazia exatamente quando ela é mais útil — com a pessoa em outra
 * tela e uma mensagem nova chegando.
 *
 * Falha sempre pro lado silencioso: qualquer erro deixa a contagem zerada em vez de
 * derrubar a navegação. Um aviso que não aparece é um incômodo; um app que não abre, não.
 */
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [userId, setUserId] = useState<string | null>(null)
  // Última data já gravada por conversa, pra não reescrever a mesma coisa — ver markRead.
  const lastWrittenRef = useRef<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setCounts({})
        return
      }
      setUserId(user.id)

      // Uma linha por conversa que tem não lida, contada no banco (ver get_unread_counts
      // na migração 20260819120000). Antes isto baixava TODAS as mensagens da organização
      // só pra comparar datas no navegador — ~1,5 MB a cada atualização, contra ~2 KB agora.
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: Array<{ conversation_id: string; unread_count: number }> | null; error: unknown }>
      }).rpc('get_unread_counts')

      if (error) {
        setCounts({})
        return
      }

      const mapa: Record<string, number> = {}
      for (const linha of data || []) {
        if (linha.unread_count > 0) mapa[linha.conversation_id] = Number(linha.unread_count)
      }
      setCounts(mapa)
    } catch {
      // Sem sessão, offline, ou Supabase indisponível — ver comentário no topo.
      setCounts({})
    }
  }, [])

  // setTimeout(0) e não a chamada direta: mesmo padrão do Inbox, do Funil e das Tarefas.
  // Chamar algo que faz setState direto no corpo do efeito dispara renderização em cascata
  // (regra react-hooks/set-state-in-effect) — adiar por um tique tira isso do caminho da
  // primeira pintura, que é justamente onde não se quer trabalho extra.
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timer)
  }, [refresh])

  // Mensagem nova (ou marca de leitura feita em outro aparelho) atualiza a contagem sem
  // recarregar a página. Mesmo debounce do Inbox: uma mensagem que chega mexe em mais de
  // uma tabela quase ao mesmo tempo, e basta uma releitura pra isso.
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 400)
    }

    const channel = supabase
      .channel('unread-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_reads' }, schedule)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [refresh])

  // Rede de segurança pro socket do Realtime morrer em silêncio (tela apagada, troca de
  // Wi-Fi) — mesmo padrão já usado no Inbox.
  useEffect(() => {
    const resync = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', resync)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', resync)
    }
  }, [refresh])

  const markRead = useCallback(
    (conversationId: string, seenUpTo: string | null | undefined) => {
      // Some da tela na hora. Abrir a conversa e ver o aviso demorar a sumir passa a
      // impressão de que o toque não pegou; se a gravação falhar, o refresh seguinte (ou o
      // realtime) traz a verdade de volta.
      setCounts((prev) => {
        if (!prev[conversationId]) return prev
        const next = { ...prev }
        delete next[conversationId]
        return next
      })

      if (!userId || !seenUpTo) return

      // Nada mudou desde a última gravação desta conversa: não escreve de novo. Sem isso,
      // toda releitura de dados do Inbox (que refaz os objetos de conversa e redispara o
      // efeito) mandaria um upsert idêntico ao banco — e cada um deles dispararia o
      // realtime de conversation_reads, gerando trabalho em cima de trabalho à toa.
      if (lastWrittenRef.current[conversationId] === seenUpTo) return
      lastWrittenRef.current[conversationId] = seenUpTo

      void (async () => {
        try {
          const supabase = createClient()
          await (supabase as unknown as {
            from: (t: string) => {
              upsert: (d: unknown, o: { onConflict: string }) => Promise<{ error: unknown }>
            }
          })
            .from('conversation_reads')
            .upsert(
              { conversation_id: conversationId, user_id: userId, last_read_at: seenUpTo },
              { onConflict: 'conversation_id,user_id' }
            )
        } catch {
          // Silencioso de propósito: marcar como lida é acessório ao que a pessoa veio
          // fazer (responder o cliente). Errar aqui não pode interromper isso.
        }
      })()
    },
    [userId]
  )

  const value = useMemo(
    () => ({ counts, total: sumUnread(counts), markRead }),
    [counts, markRead]
  )

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>
}

export function useUnread(): UnreadContextValue {
  return useContext(UnreadContext)
}

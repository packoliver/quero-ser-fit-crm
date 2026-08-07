'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Search,
  Send,
  User,
  Tag,
  AlertCircle,
  FileText,
  UserPlus,
  ArrowRightLeft,
  Info,
  Sparkles,
  Phone,
  Database,
  Loader2,
  Inbox as InboxIcon,
} from 'lucide-react'
import { InstagramIcon as Instagram } from '@/components/icons/InstagramIcon'
import { demoAttendants } from '@/lib/demo'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'

interface UiMessage {
  id: string
  senderType: 'contact' | 'user' | 'system'
  senderName: string
  content: string
  time: string
  status?: 'sent' | 'delivered' | 'read' | 'failed'
}

interface UiConversation {
  id: string
  contactName: string
  contactPhone: string
  channel: 'whatsapp' | 'instagram'
  lastMessage: string
  lastMessageTime: string
  status: 'open' | 'assigned' | 'closed' | 'archived'
  currentAssigneeId: string | null
  currentAssigneeName: string | null
  tags: string[]
  notes: Array<{ id: string; author: string; text: string; date: string }>
  messages: UiMessage[]
}

interface RealTeamMember {
  id: string
  fullName: string
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function InboxPage() {
  const {
    conversations: storedConversations,
    addMessage,
    addInternalNote,
    updateAssignee,
  } = useDemoStorage()

  const [viewMode, setViewMode] = useState<'demo' | 'real'>(
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' ? 'demo' : 'real'
  )

  // Real-mode data
  const [realConversations, setRealConversations] = useState<UiConversation[]>([])
  const [loadingReal, setLoadingReal] = useState(false)
  const [realTeamMembers, setRealTeamMembers] = useState<RealTeamMember[]>([])
  const [currentUserRealId, setCurrentUserRealId] = useState<string | null>(null)

  // Filters State
  const [selectedConvId, setSelectedConvId] = useState<string>('conv-1')
  const [filterQueue, setFilterQueue] = useState<'all' | 'mine' | 'unassigned'>('all')
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'instagram'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Action States
  const [newMessageText, setNewMessageText] = useState('')
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [newNoteText, setNewNoteText] = useState('')
  const [activeTabRight, setActiveTabRight] = useState<'info' | 'notes'>('info')
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [targetAttendantId, setTargetAttendantId] = useState('att-2')

  // Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const currentUserId = 'att-1'

  const conversations: UiConversation[] = viewMode === 'real' ? realConversations : storedConversations
  const selectedConversation = conversations.find((c) => c.id === selectedConvId)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Fetch real conversations, their messages/notes, and who's currently logged in.
  // `silent` skips the loading spinner — used for realtime-triggered background
  // refreshes, so the Inbox doesn't flicker every time a message comes in.
  const fetchRealData = useCallback(async (silent = false) => {
    if (!silent) setLoadingReal(true)
    try {
      const supabase = createClient()
      const typed = supabase as unknown as {
        auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
        from: (t: string) => {
          select: (c: string) => {
            order?: (col: string, opt: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: unknown }>
            eq?: (col: string, val: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: unknown }> } }
          } & Promise<{ data: unknown[] | null; error: unknown }>
        }
      }

      const {
        data: { user },
      } = await typed.auth.getUser()
      setCurrentUserRealId(user?.id || null)

      const [convRes, msgRes, noteRes, membersRes] = await Promise.all([
        typed
          .from('conversations')
          .select('id, status, channel_type, current_assignee_id, last_message_at, contact_id, contacts(name, phone), profiles(full_name)')
          .order!('last_message_at', { ascending: false }),
        typed.from('messages').select('id, conversation_id, sender_type, sender_id, content, status, created_at').order!('created_at', { ascending: true }),
        typed.from('internal_notes').select('id, conversation_id, content, created_at, author_id, profiles(full_name)').order!('created_at', { ascending: false }),
        typed.from('organization_members').select('user_id, profiles(full_name)').order!('created_at', { ascending: true }),
      ])

      const convData = (convRes.data || []) as Array<{
        id: string
        status: UiConversation['status']
        channel_type: 'whatsapp' | 'instagram'
        current_assignee_id: string | null
        last_message_at: string
        contact_id: string
        contacts: { name: string | null; phone: string | null } | null
        profiles: { full_name: string | null } | null
      }>
      const msgData = (msgRes.data || []) as Array<{
        id: string
        conversation_id: string
        sender_type: 'contact' | 'user' | 'system'
        sender_id: string | null
        content: string
        status: 'sent' | 'delivered' | 'read' | 'failed' | null
        created_at: string
      }>
      const noteData = (noteRes.data || []) as Array<{
        id: string
        conversation_id: string
        content: string
        created_at: string
        profiles: { full_name: string | null } | null
      }>
      const membersData = (membersRes.data || []) as Array<{
        user_id: string
        profiles: { full_name: string | null } | null
      }>

      setRealTeamMembers(membersData.map((m) => ({ id: m.user_id, fullName: m.profiles?.full_name || 'Membro' })))

      const built: UiConversation[] = convData.map((conv) => {
        const msgs = msgData
          .filter((m) => m.conversation_id === conv.id)
          .map<UiMessage>((m) => ({
            id: m.id,
            senderType: m.sender_type,
            senderName:
              m.sender_type === 'contact'
                ? conv.contacts?.name || 'Cliente'
                : m.sender_type === 'system'
                ? 'Sistema'
                : m.sender_id === user?.id
                ? 'Você'
                : membersData.find((mm) => mm.user_id === m.sender_id)?.profiles?.full_name || 'Atendente',
            content: m.content,
            time: formatTime(m.created_at),
            status: m.status || undefined,
          }))

        const notes = noteData
          .filter((n) => n.conversation_id === conv.id)
          .map((n) => ({
            id: n.id,
            author: n.profiles?.full_name || 'Equipe',
            text: n.content,
            date: new Date(n.created_at).toLocaleDateString('pt-BR'),
          }))

        const lastMsg = msgs[msgs.length - 1]

        return {
          id: conv.id,
          contactName: conv.contacts?.name || 'Contato',
          contactPhone: conv.contacts?.phone || '-',
          channel: conv.channel_type,
          lastMessage: lastMsg?.content || '(sem mensagens)',
          lastMessageTime: lastMsg?.time || formatTime(conv.last_message_at),
          status: conv.status,
          currentAssigneeId: conv.current_assignee_id,
          currentAssigneeName: conv.profiles?.full_name || null,
          tags: [],
          notes,
          messages: msgs,
        }
      })

      setRealConversations(built)
    } catch {
      setErrorMessage('Falha ao carregar conversas reais do Supabase.')
    } finally {
      setLoadingReal(false)
    }
  }, [])

  useEffect(() => {
    if (viewMode !== 'real') return
    const timer = setTimeout(() => {
      void fetchRealData()
    }, 0)
    return () => clearTimeout(timer)
  }, [viewMode, fetchRealData])

  // Realtime: subscribe to Postgres Changes on `messages` and `conversations` so new
  // inbound messages (from the webhook) and changes made by other attendants (assume,
  // transfer, status) show up live, without a manual refresh. RLS still applies — this
  // only ever receives events for rows the logged-in user's tenant-isolation policies
  // already let them SELECT. Debounced because a single inbound message can touch both
  // tables (new message insert + conversation's last_message_at update) almost
  // simultaneously, and we only need one refetch for that.
  useEffect(() => {
    if (viewMode !== 'real') return

    const supabase = createClient()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void fetchRealData(true)
      }, 400)
    }

    const channel = supabase
      .channel('inbox-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [viewMode, fetchRealData])

  // Handle Assume Conversation
  const handleAssume = async (convId: string) => {
    setErrorMessage(null)

    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { data: success, error: rpcError } = await (supabase as unknown as {
          rpc: (fn: string, params: { p_conversation_id: string }) => Promise<{ data: boolean; error: { message: string } | null }>
        }).rpc('assume_conversation_atomic', { p_conversation_id: convId })

        if (rpcError || !success) {
          setErrorMessage('Não foi possível assumir. Esta conversa já foi assumida por outro atendente.')
          return
        }

        showToast('Conversa assumida com sucesso via RPC atômica!')
        fetchRealData()
      } catch {
        setErrorMessage('Erro ao executar a atribuição no Supabase.')
        return
      }
    } else {
      const currentUser = demoAttendants.find((a) => a.id === currentUserId)
      updateAssignee(convId, currentUserId, currentUser?.fullName || 'Você')
      showToast('Atendimento assumido!')
    }
  }

  // Handle Transfer Conversation
  const handleTransfer = async () => {
    if (!selectedConversation) return
    setErrorMessage(null)

    if (viewMode === 'real') {
      const targetMember = realTeamMembers.find((m) => m.id === targetAttendantId)
      try {
        const supabase = createClient()
        const { data: success, error: rpcError } = await (supabase as unknown as {
          rpc: (fn: string, params: { p_conversation_id: string; p_target_user_id: string }) => Promise<{ data: boolean; error: { message: string } | null }>
        }).rpc('transfer_conversation_atomic', {
          p_conversation_id: selectedConversation.id,
          p_target_user_id: targetAttendantId,
        })

        if (rpcError || !success) {
          setErrorMessage('Falha ao transferir conversa via Supabase RPC.')
          setTransferModalOpen(false)
          return
        }

        showToast(`Conversa transferida para ${targetMember?.fullName || 'o membro selecionado'}`)
        fetchRealData()
      } catch {
        setErrorMessage('Erro na transferência.')
      }
    } else {
      const targetAttendant = demoAttendants.find((a) => a.id === targetAttendantId)
      updateAssignee(selectedConversation.id, targetAttendantId, targetAttendant?.fullName || 'Atendente')
      showToast(`Conversa transferida para ${targetAttendant?.fullName}`)
    }

    setTransferModalOpen(false)
  }

  // Handle Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessageText.trim() || !selectedConversation || isSendingMessage) return

    const textToSend = newMessageText
    setNewMessageText('')
    setIsSendingMessage(true)

    if (viewMode === 'real') {
      try {
        const res = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: selectedConversation.id, content: textToSend }),
        })
        const body = await res.json()
        if (!res.ok) {
          setErrorMessage(body.error || 'Falha ao enviar mensagem.')
        }
        fetchRealData()
      } catch {
        setErrorMessage('Erro de conexão ao enviar mensagem.')
      } finally {
        setIsSendingMessage(false)
      }
      return
    }

    // Demo mode
    addMessage(selectedConversation.id, textToSend, 'user', 'Patricia Silva (Você)')
    const targetId = selectedConversation.id
    const clientName = selectedConversation.contactName

    setTimeout(() => {
      setIsSendingMessage(false)
      const replies = [
        'Certo, entendi! Obrigado pelas informações.',
        'Perfeito! Vou verificar os detalhes e te respondo por aqui.',
        'Muito obrigada pelo atendimento rápido! Gostei bastante.',
        'Excelente! Já escolhi as marmitas fit.',
      ]
      const randomReply = replies[Math.floor(Math.random() * replies.length)]
      addMessage(targetId, randomReply, 'contact', clientName)
      showToast(`Nova resposta recebida de ${clientName}`)
    }, 2500)
  }

  // Handle Add Internal Note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newNoteText.trim() || !selectedConversation) return

    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { error } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (d: unknown) => Promise<{ error: { message: string } | null }>
          }
        })
          .from('internal_notes')
          .insert({
            conversation_id: selectedConversation.id,
            content: newNoteText,
          })

        if (error) {
          setErrorMessage('Falha ao salvar nota interna no Supabase.')
          return
        }
        showToast('Nota interna privada registrada.')
        setNewNoteText('')
        fetchRealData()
      } catch {
        setErrorMessage('Erro ao salvar nota interna.')
      }
      return
    }

    addInternalNote(selectedConversation.id, newNoteText, 'Patricia Silva')
    setNewNoteText('')
    showToast('Nota interna privada registrada.')
  }

  // Apply Queue, Channel, and Search Filters
  const filteredConversations = conversations.filter((c) => {
    const effectiveCurrentUserId = viewMode === 'real' ? currentUserRealId : currentUserId
    const isMine = c.currentAssigneeId === effectiveCurrentUserId
    const isUnassigned = !c.currentAssigneeId || c.status === 'open'

    const matchesQueue =
      filterQueue === 'all' ? true : filterQueue === 'mine' ? isMine : isUnassigned

    const matchesChannel = filterChannel === 'all' || c.channel === filterChannel

    const matchesSearch =
      c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.contactPhone.includes(searchQuery) ||
      c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesQueue && matchesChannel && matchesSearch
  })

  const effectiveCurrentUserId = viewMode === 'real' ? currentUserRealId : currentUserId
  const isHandledByOther =
    selectedConversation &&
    selectedConversation.currentAssigneeId &&
    selectedConversation.currentAssigneeId !== effectiveCurrentUserId

  const transferOptions = viewMode === 'real' ? realTeamMembers.map((m) => ({ id: m.id, fullName: m.fullName })) : demoAttendants

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#0b1320] text-slate-100 overflow-hidden relative">
      {/* Header Banner & Mode Selector */}
      <div className="bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 border-b border-emerald-800/40 px-4 py-2 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          {viewMode === 'demo' ? (
            <>
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
              <span className="font-semibold text-amber-200 uppercase tracking-wide">
                Modo Demonstração Integrado
              </span>
              <span className="hidden md:inline text-slate-400">
                • Simulação de mensagens e atendimento ativo
              </span>
            </>
          ) : (
            <>
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-emerald-200 uppercase tracking-wide">
                Conversas Conectadas ao Supabase
              </span>
              {loadingReal && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />}
            </>
          )}
        </div>

        {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
          <div className="flex items-center gap-2">
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex text-[11px]">
              <button
                onClick={() => setViewMode('real')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  viewMode === 'real' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                Supabase Real
              </button>
              <button
                onClick={() => setViewMode('demo')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  viewMode === 'demo' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                Modo Demo
              </button>
            </div>
          </div>
        )}
      </div>

      {toastMessage && (
        <div className="absolute top-14 right-6 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-bounce">
          <span>{toastMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-950/80 border-b border-rose-800 text-rose-200 px-4 py-2 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3-Column Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Col 1: Conversations List & Queue Filters */}
        <div className="w-full md:w-80 lg:w-96 border-r border-slate-800 flex flex-col bg-[#0f172a] shrink-0">
          <div className="p-3 border-b border-slate-800 space-y-2.5">
            <Input
              type="text"
              placeholder="Buscar cliente ou mensagem..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />

            {/* Queue Filter Tabs: Minhas, Fila de Espera, Todas */}
            <div className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setFilterQueue('all')}
                className={`py-1.5 px-2 rounded-lg font-medium text-center transition ${
                  filterQueue === 'all' ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
                suppressHydrationWarning
              >
                Todas ({conversations.length})
              </button>
              <button
                onClick={() => setFilterQueue('mine')}
                className={`py-1.5 px-2 rounded-lg font-medium text-center transition ${
                  filterQueue === 'mine' ? 'bg-emerald-950/80 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Minhas
              </button>
              <button
                onClick={() => setFilterQueue('unassigned')}
                className={`py-1.5 px-2 rounded-lg font-medium text-center transition ${
                  filterQueue === 'unassigned' ? 'bg-amber-950/80 text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
                suppressHydrationWarning
              >
                Fila ({conversations.filter((c) => !c.currentAssigneeId || c.status === 'open').length})
              </button>
            </div>

            {/* Channel Filters: All, WhatsApp, Instagram */}
            <div className="flex gap-1 bg-slate-900/60 p-1 rounded-lg border border-slate-800/80 text-[11px]">
              <button
                onClick={() => setFilterChannel('all')}
                className={`flex-1 py-1 px-2 rounded-md font-medium text-center transition ${
                  filterChannel === 'all' ? 'bg-slate-800 text-slate-200 font-semibold' : 'text-slate-400'
                }`}
              >
                Todos Canais
              </button>
              <button
                onClick={() => setFilterChannel('whatsapp')}
                className={`flex-1 py-1 px-2 rounded-md font-medium flex items-center justify-center gap-1 transition ${
                  filterChannel === 'whatsapp' ? 'bg-emerald-950/80 text-emerald-400 font-semibold' : 'text-slate-400'
                }`}
              >
                <Phone className="w-3 h-3 text-emerald-400" />
                <span>WhatsApp</span>
              </button>
              <button
                onClick={() => setFilterChannel('instagram')}
                className={`flex-1 py-1 px-2 rounded-md font-medium flex items-center justify-center gap-1 transition ${
                  filterChannel === 'instagram' ? 'bg-pink-950/80 text-pink-400 font-semibold' : 'text-slate-400'
                }`}
              >
                <Instagram className="w-3 h-3 text-pink-400" />
                <span>Instagram</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {filteredConversations.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<Search className="w-5 h-5" />}
                  title="Nenhuma conversa"
                  description={
                    viewMode === 'real'
                      ? 'Nenhuma conversa real ainda. Elas aparecem aqui assim que uma mensagem chegar por uma conexão configurada.'
                      : 'Ajuste a busca ou troque o filtro de fila/canal.'
                  }
                />
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = selectedConversation && conv.id === selectedConversation.id
                const isWhatsApp = conv.channel === 'whatsapp'

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`p-3.5 cursor-pointer transition flex items-start gap-3 ${
                      isSelected ? 'bg-slate-800/90 border-l-4 border-l-emerald-400' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <Avatar name={conv.contactName} size="md" />

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1">
                        <h3 className="text-xs font-semibold text-slate-200 truncate">{conv.contactName}</h3>
                        <span className="text-[10px] text-slate-500">{conv.lastMessageTime}</span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mb-1.5">{conv.lastMessage}</p>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {isWhatsApp ? (
                          <Badge variant="emerald" icon={<Phone className="w-3 h-3" />}>
                            WhatsApp
                          </Badge>
                        ) : (
                          <Badge variant="pink" icon={<Instagram className="w-3 h-3" />}>
                            Instagram
                          </Badge>
                        )}

                        {!conv.currentAssigneeId || conv.status === 'open' ? (
                          <Badge variant="amber">Fila de Espera</Badge>
                        ) : (
                          <Badge variant="teal" icon={<User className="w-3 h-3" />}>
                            {conv.currentAssigneeName}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Col 2: Chat Thread */}
        {selectedConversation ? (
          <div className="flex-1 flex flex-col bg-[#0b1320] min-w-0">
            {/* Thread Header */}
            <div className="p-3.5 border-b border-slate-800 bg-[#0f172a]/90 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={selectedConversation.contactName} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-100 truncate">{selectedConversation.contactName}</h2>
                    <Badge variant={selectedConversation.channel === 'whatsapp' ? 'emerald' : 'pink'}>
                      {selectedConversation.channel === 'whatsapp' ? 'WhatsApp' : 'Instagram Direct'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">{selectedConversation.contactPhone}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selectedConversation.currentAssigneeId !== effectiveCurrentUserId && (
                  <Button onClick={() => handleAssume(selectedConversation.id)} size="sm" variant="primary">
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Assumir</span>
                  </Button>
                )}

                <Button onClick={() => setTransferModalOpen(true)} size="sm" variant="secondary">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Transferir</span>
                </Button>
              </div>
            </div>

            {isHandledByOther && (
              <div className="bg-amber-950/60 border-b border-amber-800/60 px-4 py-2 text-xs text-amber-300 flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Atenção: Esta conversa está atribuída a{' '}
                  <strong className="text-amber-200">{selectedConversation.currentAssigneeName}</strong>.
                </span>
              </div>
            )}

            {/* Thread Messages */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-[#080e18]">
              {selectedConversation.messages.map((msg) => {
                if (msg.senderType === 'system') {
                  return (
                    <div key={msg.id} className="flex justify-center my-2">
                      <span className="text-[11px] bg-slate-800/80 text-slate-400 px-3 py-1 rounded-full border border-slate-700/60 font-mono">
                        {msg.content} ({msg.time})
                      </span>
                    </div>
                  )
                }

                const isMe = msg.senderType === 'user'
                const isFailed = msg.status === 'failed'

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[80%] md:max-w-[70%] ${
                      isMe ? 'ml-auto items-end' : 'mr-auto items-start'
                    }`}
                  >
                    <span className="text-[10px] text-slate-500 mb-1 px-1">{msg.senderName}</span>
                    <div
                      className={`p-3 rounded-2xl text-xs leading-relaxed ${
                        isFailed
                          ? 'bg-rose-950/50 text-rose-100 border border-rose-800/70 rounded-tr-none'
                          : isMe
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-tr-none shadow-md'
                          : 'bg-[#131f37] text-slate-200 border border-slate-700/80 rounded-tl-none'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <span className={`text-[9px] block text-right mt-1.5 ${isFailed ? 'text-rose-300' : isMe ? 'text-emerald-200' : 'text-slate-400'}`}>
                        {msg.time}
                      </span>
                    </div>
                    {isFailed && (
                      <span className="text-[10px] text-rose-400 flex items-center gap-1 mt-1 px-1">
                        <AlertCircle className="w-3 h-3" />
                        Falha ao enviar
                      </span>
                    )}
                  </div>
                )
              })}

              {/* Sending / Auto-reply Indicator */}
              {isSendingMessage && (
                <div className="flex justify-start my-2">
                  <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-2xl text-slate-400 text-xs flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>
                      {viewMode === 'real' ? 'Enviando...' : `${selectedConversation.contactName} está digitando uma resposta...`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Message Input Form */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-[#0f172a] shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Digite sua resposta..."
                  value={newMessageText}
                  onChange={(e) => setNewMessageText(e.target.value)}
                  disabled={isSendingMessage}
                  className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <Button type="submit" disabled={!newMessageText.trim() || isSendingMessage} size="md" variant="primary">
                  {isSendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </form>
          </div>
        ) : (
          /* Empty State when no conversation selected */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 bg-[#080e18]">
            <InboxIcon className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
            <h3 className="text-base font-bold text-slate-200">Nenhuma conversa selecionada</h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1">
              Selecione um contato na lista lateral para iniciar ou continuar o atendimento.
            </p>
          </div>
        )}

        {/* Col 3: Contact Profile & Internal Notes */}
        {selectedConversation && (
          <div className="hidden lg:flex w-72 lg:w-80 border-l border-slate-800 bg-[#0f172a] flex-col shrink-0">
            <div className="flex border-b border-slate-800 text-xs">
              <button
                onClick={() => setActiveTabRight('info')}
                className={`flex-1 py-3 font-semibold flex items-center justify-center gap-1.5 border-b-2 transition ${
                  activeTabRight === 'info' ? 'border-emerald-400 text-emerald-400 bg-slate-800/50' : 'text-slate-400'
                }`}
              >
                <Info className="w-3.5 h-3.5" />
                <span>Perfil</span>
              </button>
              <button
                onClick={() => setActiveTabRight('notes')}
                className={`flex-1 py-3 font-semibold flex items-center justify-center gap-1.5 border-b-2 transition ${
                  activeTabRight === 'notes' ? 'border-emerald-400 text-emerald-400 bg-slate-800/50' : 'text-slate-400'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Notas Internas</span>
              </button>
            </div>

            {activeTabRight === 'info' && (
              <div className="p-4 space-y-5 overflow-y-auto flex-1 text-xs">
                <div>
                  <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-2">
                    Informações do Cliente
                  </h3>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-2">
                    <div>
                      <span className="text-slate-500 text-[10px]">Nome Completo</span>
                      <p className="font-semibold text-slate-200">{selectedConversation.contactName}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px]">Contato</span>
                      <p className="font-semibold text-slate-200">{selectedConversation.contactPhone}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedConversation.tags.length === 0 ? (
                      <span className="text-slate-500 text-[11px]">Nenhuma tag.</span>
                    ) : (
                      selectedConversation.tags.map((t, idx) => (
                        <Badge key={idx} variant="emerald" icon={<Tag className="w-3 h-3" />}>
                          {t}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTabRight === 'notes' && (
              <div className="p-4 flex flex-col flex-1 text-xs">
                <div className="flex-1 overflow-y-auto space-y-3 mb-3">
                  {selectedConversation.notes.length === 0 ? (
                    <p className="text-slate-500 text-center py-6 text-xs">
                      Nenhuma nota interna registrada.
                    </p>
                  ) : (
                    selectedConversation.notes.map((note) => (
                      <div key={note.id} className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-1">
                        <div className="flex justify-between items-center text-[10px] text-slate-400">
                          <span className="font-semibold text-emerald-400">{note.author}</span>
                          <span>{note.date}</span>
                        </div>
                        <p className="text-slate-300 text-xs">{note.text}</p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleAddNote} className="space-y-2 border-t border-slate-800 pt-3">
                  <textarea
                    rows={2}
                    placeholder="Nota interna privada visível para a equipe..."
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <Button type="submit" disabled={!newNoteText.trim()} variant="secondary" className="w-full">
                    Adicionar Nota
                  </Button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transfer Modal */}
      <Modal
        isOpen={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        title="Transferir Atendimento"
        icon={<ArrowRightLeft className="w-5 h-5" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-400">
            Selecione o atendente que assumirá a conversa com{' '}
            <strong className="text-slate-200">{selectedConversation?.contactName}</strong>:
          </p>

          <select
            value={targetAttendantId}
            onChange={(e) => setTargetAttendantId(e.target.value)}
            className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            {transferOptions.map((att) => (
              <option key={att.id} value={att.id}>
                {att.fullName}
              </option>
            ))}
          </select>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setTransferModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleTransfer}>
              Confirmar Transferência
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

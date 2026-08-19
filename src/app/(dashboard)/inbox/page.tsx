'use client'

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
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
  Paperclip,
  Download,
  File as FileIcon,
  Check,
  CheckCheck,
  Bell,
  BellOff,
  Users,
  Camera,
  Kanban,
  DollarSign,
  Plus,
  ArrowLeft,
  Trash2,
  Archive,
  RotateCcw,
  Zap,
  Star,
  MoreVertical,
  Clock,
} from 'lucide-react'
import { InstagramIcon as Instagram } from '@/components/icons/InstagramIcon'
import { demoAttendants } from '@/lib/demo'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { BottomSheet, BottomSheetItem } from '@/components/ui/BottomSheet'
import { Toast } from '@/components/ui/Toast'
import { useImmersiveMobile } from '@/components/layout/MobileChromeProvider'
import { useUnread } from '@/components/layout/UnreadProvider'
import { formatUnreadBadge } from '@/lib/inbox/unread'
import { createClient } from '@/lib/supabase/client'
import { subscribeToPush, unsubscribeFromPush } from '@/lib/pwa/subscribe'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { DealStage, UserRole, CustomPermissions } from '@/types/database'
import { hasPermission } from '@/lib/security/permissions'
import { cacheEntity, readCachedEntity, queueEntityMutation } from '@/lib/offline/repository'
import { getOfflineScope } from '@/lib/offline/scope'
import { PipelineStage, PipelineStageRow, DEFAULT_PIPELINE_STAGES, mapPipelineStageRow, STAGE_DOT_CLASS } from '@/lib/pipeline/stages'
import { compressImageIfLarge, compressVideo, CompressProgress } from '@/lib/media/compress'

type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

// O bucket chat-media no Supabase está configurado com file_size_limit = 26214400 (exatos
// 25MB) — e é também o teto real do Instagram Direct pra anexos de vídeo, então não dá
// pra simplesmente aumentar esse número (a Meta rejeitaria o envio de qualquer forma).
// A checagem no navegador fica um pouco ABAIXO do limite do bucket (24MB, não 25MB) de
// propósito: o upload em si carrega alguns bytes de overhead além do tamanho puro do
// arquivo, então um arquivo que passa num `size > 25MB` local pode ainda assim estourar
// o limite de 25MB do lado do Supabase — sem essa margem, isso resultava no erro técnico
// cru do Supabase aparecendo pro usuário em vez da mensagem amigável de "reduza o tamanho".
const MAX_MEDIA_SIZE_BYTES = 24 * 1024 * 1024 // 24MB — margem de segurança abaixo do limite de 25MB do bucket/Instagram

function detectMediaType(mime: string): MediaType {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

interface UiMessage {
  id: string
  senderType: 'contact' | 'user' | 'system'
  senderName: string
  content: string
  time: string
  status?: 'sent' | 'delivered' | 'read' | 'failed'
  mediaUrl?: string | null
  mediaType?: MediaType | null
  /** Only meaningful for a contact message inside a group — that specific member's photo, when we have it cached. */
  senderAvatarUrl?: string | null
}

interface UiConversation {
  id: string
  /** Only present in real (Supabase) mode — needed for the media upload path prefix. */
  organizationId?: string
  /** Only present in real (Supabase) mode — needed to attach a Pedido (Funil) to this contact. */
  contactId?: string
  contactName: string
  contactPhone: string
  contactAvatarUrl?: string | null
  /** Only meaningful for whatsapp — a uazapi group thread rather than a 1:1 contact. */
  isGroup?: boolean
  channel: 'whatsapp' | 'instagram'
  lastMessage: string
  lastMessageTime: string
  /** Timestamp bruto (ISO) da última mensagem — `lastMessageTime` já vem formatado
   * ("HH:mm") pra exibição, sem dado suficiente pra calcular "faz quanto tempo".
   * Ausente em modo demo (o aviso de SLA só aparece em modo real). */
  lastMessageAtIso?: string
  /** De quem foi a última mensagem — só interessa quando é 'contact': significa que a
   * conversa está esperando resposta da equipe agora (usado no aviso de SLA). */
  lastMessageSenderType?: 'contact' | 'user' | 'system'
  /** Nota 1-5 dada pelo cliente (CSAT) — null enquanto não avaliado, ou se CSAT nunca
   * foi pedido pra essa conversa. */
  csatScore?: number | null
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

interface QuickReplyOption {
  id: string
  shortcut: string | null
  title: string
  content: string
}

interface InlineDeal {
  id: string
  title: string
  contact_id: string
  stage: DealStage
  value: number | null
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

// Rótulo do cabeçalho de data que separa a lista de conversas em grupos (Hoje, Ontem,
// dia da semana, ou data completa) — puramente pra facilitar achar uma conversa de
// relance, sem mudar a ordenação (que já vem por last_message_at, mais recente primeiro).
const formatDateHeader = (iso: string | undefined): string => {
  if (!iso) return 'Sem data'
  const date = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'Hoje'
  if (diffDays === 1) return 'Ontem'
  if (diffDays > 1 && diffDays < 7) {
    const label = date.toLocaleDateString('pt-BR', { weekday: 'long' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

/**
 * Prazos prontos pro lembrete de retorno.
 *
 * São opções fixas em vez de um seletor de data porque a pergunta real é "quando eu volto
 * a falar com essa pessoa?", e a resposta quase sempre é uma dessas quatro. Abrir um
 * calendário no celular pra marcar "amanhã" custa muito mais toques do que a decisão vale
 * — e prazo que dá trabalho de marcar simplesmente não é marcado.
 *
 * As datas são calculadas na hora do clique (função, não valor), senão ficariam congeladas
 * no momento em que a página carregou.
 */
interface ReminderOption {
  label: string
  hint: string
  dueDate: () => Date
}

const atHour = (daysFromNow: number, hour: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, 0, 0, 0)
  return d
}

const REMINDER_OPTIONS: ReminderOption[] = [
  { label: 'Daqui a 2 horas', hint: 'Ainda hoje', dueDate: () => new Date(Date.now() + 2 * 60 * 60 * 1000) },
  { label: 'Amanhã de manhã', hint: '09:00', dueDate: () => atHour(1, 9) },
  { label: 'Em 3 dias', hint: '09:00', dueDate: () => atHour(3, 9) },
  { label: 'Semana que vem', hint: '09:00', dueDate: () => atHour(7, 9) },
]

function InboxPageInner({ requestedConvId }: { requestedConvId: string | null }) {
  // Vem de links externos (ex: um card da aba Follow-up "Abrir conversa") — assim que a
  // lista real carrega, seleciona essa conversa automaticamente em vez de deixar o
  // usuário procurar ela na lista de novo.
  const appliedRequestedConvRef = useRef(false)

  const {
    conversations: storedConversations,
    addMessage,
    addInternalNote,
    updateAssignee,
    updateConversationStatus,
  } = useDemoStorage()

  const [viewMode, setViewMode] = useState<'demo' | 'real'>(
    process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' ? 'demo' : 'real'
  )

  // Contagem de não lidas — mora no layout (ver UnreadProvider) pra bolinha da navegação
  // continuar valendo com o Inbox fechado.
  const { counts: unreadCounts, markRead } = useUnread()

  // Real-mode data
  const [realConversations, setRealConversations] = useState<UiConversation[]>([])
  const [loadingReal, setLoadingReal] = useState(false)
  const [realTeamMembers, setRealTeamMembers] = useState<RealTeamMember[]>([])
  const [currentUserRealId, setCurrentUserRealId] = useState<string | null>(null)
  // Papel + overrides de permissão do usuário logado — determina, por ex., se o botão de
  // excluir mensagem aparece. Carregado uma vez junto com o resto dos dados reais;
  // default 'attendant' (o menos privilegiado) enquanto ainda não chegou, mesma lógica
  // de "falha pro lado seguro" usada em (dashboard)/layout.tsx pro role do menu.
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null)
  const [currentUserPermissions, setCurrentUserPermissions] = useState<CustomPermissions | null>(null)

  // Filters State
  const [selectedConvId, setSelectedConvId] = useState<string>('conv-1')
  // 'details' = a coluna de Perfil/Notas/Pedido — em telas grandes ela sempre aparece do
  // lado do chat (3 colunas ao mesmo tempo); no celular vira uma tela própria, senão
  // ficava impossível abrir a aba "Pedido" (mover pra funil) de dentro do Inbox no celular.
  const [mobilePane, setMobilePane] = useState<'list' | 'chat' | 'details'>('list')
  const [filterQueue, setFilterQueue] = useState<'all' | 'mine' | 'unassigned'>('all')
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'instagram'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Notifications: sound + browser Notification + tab title badge for new inbound
  // messages that arrive while the attendant isn't looking (tab hidden, or a different
  // conversation open). selectedConvIdRef exists because the realtime callback below is
  // registered once and would otherwise close over a stale selectedConvId.
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('inbox_notifications_enabled') === 'true'
  )
  const [unreadCount, setUnreadCount] = useState(0)
  const selectedConvIdRef = useRef(selectedConvId)
  const originalTitleRef = useRef<string>('')
  // Trava síncrona contra clique/toque duplo no "Enviar" — `isSendingMessage` (estado do
  // React) só reflete no DOM depois de um re-render, então dois cliques bem rápidos (ou
  // um duplo-toque no celular) podiam os dois passar pela checagem de `isSendingMessage`
  // antes do primeiro clique desabilitar o botão, mandando a mesma mensagem 2x pro
  // cliente. Um ref muda na hora, sem esperar re-render, então cobre essa janela de corrida.
  const isSendingRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    selectedConvIdRef.current = selectedConvId
  }, [selectedConvId])

  // Action States
  const [newMessageText, setNewMessageText] = useState('')
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  // Progresso da compressão de foto/vídeo grande demais pro limite de 24MB (ver
  // src/lib/media/compress.ts) — null quando não está comprimindo nada.
  const [compressionProgress, setCompressionProgress] = useState<CompressProgress | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [newNoteText, setNewNoteText] = useState('')
  const [activeTabRight, setActiveTabRight] = useState<'info' | 'notes' | 'pedido'>('info')
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  // Painéis de ação da conversa. O menu "⋮" concentra o que antes eram até 4 botões
  // disputando o cabeçalho; o de etapa é o atalho pra classificar no funil sem sair do
  // chat — hoje o caminho pra isso é longo o bastante pra que ninguém faça (0 pedidos
  // registrados com 24 conversas em andamento).
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false)
  const [stageSheetOpen, setStageSheetOpen] = useState(false)
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false)
  const [savingReminder, setSavingReminder] = useState(false)
  const [targetAttendantId, setTargetAttendantId] = useState('att-2')
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null)
  const [deletingMessage, setDeletingMessage] = useState(false)

  // Respostas rápidas — biblioteca compartilhada da organização (ver
  // /configuracoes/respostas-rapidas). Carregada uma vez (muda raramente) em vez de
  // entrar no polling de fetchRealData.
  const [quickReplies, setQuickReplies] = useState<QuickReplyOption[]>([])
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false)
  const quickRepliesRef = useRef<HTMLDivElement>(null)

  // Carrega a biblioteca de respostas rápidas uma vez (muda raramente, então não entra
  // no polling/realtime de fetchRealData).
  useEffect(() => {
    if (viewMode !== 'real') return
    let cancelled = false
    const timer = setTimeout(() => {
      const supabase = createClient()
      ;(supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: QuickReplyOption[] | null }>
          }
        }
      })
        .from('quick_replies')
        .select('id, shortcut, title, content')
        .order('title', { ascending: true })
        .then(({ data }) => {
          if (!cancelled) setQuickReplies(data || [])
        })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [viewMode])

  // Fecha o dropdown de respostas rápidas ao clicar fora dele.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (quickRepliesRef.current && !quickRepliesRef.current.contains(e.target as Node)) {
        setQuickRepliesOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Pedido (funil) inline na própria conversa — pra vendedora não precisar sair do
  // Inbox pra separar "já vendeu, vai pra entrega" etc. Real-mode only: precisa de um
  // contact_id de verdade pra anexar o pedido a alguém.
  const [realDeals, setRealDeals] = useState<InlineDeal[]>([])
  // Etapas do funil configuradas pelo admin em Configurações > Etapas do Funil (ver
  // src/lib/pipeline/stages.ts) — DEFAULT_PIPELINE_STAGES é só rede de segurança
  // enquanto isso ainda não carregou.
  const [dealStages, setDealStages] = useState<PipelineStage[]>(DEFAULT_PIPELINE_STAGES)
  const [newDealTitle, setNewDealTitle] = useState('')
  const [newDealStage, setNewDealStage] = useState<DealStage>('lead')
  const [newDealValue, setNewDealValue] = useState('')
  const [savingDeal, setSavingDeal] = useState(false)

  // Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const currentUserId = 'att-1'

  const conversations: UiConversation[] = viewMode === 'real' ? realConversations : storedConversations
  const selectedConversation = conversations.find((c) => c.id === selectedConvId)
  const showMobileList = mobilePane === 'list' || !selectedConversation
  const showMobileChat = mobilePane === 'chat' && !!selectedConversation
  const showMobileDetails = mobilePane === 'details' && !!selectedConversation

  // Conversa aberta no celular toma a tela inteira: sem o cabeçalho global nem a barra
  // inferior, que aqui só disputariam altura com as mensagens e o campo de digitar.
  useImmersiveMobile(showMobileChat || showMobileDetails)

  // A thread não rolava pro fim: abrir uma conversa mostrava as mensagens MAIS ANTIGAS, e
  // mensagem nova chegando ficava fora da tela sem nenhum aviso. Nenhum app de mensagem se
  // comporta assim, e o hábito da vendedora é o do WhatsApp — ela ia responder olhando pro
  // começo do histórico.
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  // Só rola sozinho se a pessoa já estava no fim. Se ela subiu pra reler algo, puxar a
  // tela de volta a cada mensagem que chega seria pior do que não rolar nada.
  const isNearBottomRef = useRef(true)

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // Troca de conversa (ou o painel do chat aparecendo no celular): pula pro fim na hora,
  // sem animação — é o estado inicial esperado, não uma transição que valha mostrar.
  // `showMobileChat` entra aqui porque enquanto o painel está `hidden` sua altura é zero,
  // então rolar antes dele aparecer não faria nada.
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    isNearBottomRef.current = true
  }, [selectedConvId, showMobileChat])

  const selectedMessageCount = selectedConversation?.messages.length ?? 0
  useEffect(() => {
    if (!isNearBottomRef.current) return
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [selectedMessageCount])

  // Marca como lida enquanto a conversa está aberta e a pessoa está de fato olhando.
  //
  // Cobre os dois casos que o clique na lista não pega: conversa aberta por link (o card
  // "Abrir conversa" do Follow-up e das Tarefas, que seleciona sozinho) e mensagem que
  // chega com a conversa JÁ na tela — sem isso ela apareceria como não lida na frente de
  // quem acabou de recebê-la.
  //
  // `document.hidden` importa: com a aba em segundo plano ninguém viu nada, e zerar o
  // aviso aí faria a mensagem passar despercebida — que é o oposto do que a bolinha serve.
  useEffect(() => {
    if (viewMode !== 'real' || !selectedConversation || selectedMessageCount === 0) return
    if (typeof document !== 'undefined' && document.hidden) return
    markRead(selectedConversation.id)
  }, [viewMode, selectedConversation, selectedMessageCount, markRead])


  const showToast = (msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null)
      toastTimerRef.current = null
    }, 3500)
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

      const [convRes, msgRes, noteRes, membersRes, profilesRes, dealsRes, stagesRes, myMembershipRes] = await Promise.all([
        typed
          .from('conversations')
          .select('id, organization_id, status, channel_type, current_assignee_id, last_message_at, contact_id, csat_score, contacts(name, phone, is_group, avatar_url), profiles(full_name)')
          .order!('last_message_at', { ascending: false }),
        typed.from('messages').select('id, conversation_id, sender_type, sender_id, content, media_url, media_type, status, metadata, created_at').order!('created_at', { ascending: true }),
        typed.from('internal_notes').select('id, conversation_id, content, created_at, author_id, profiles(full_name)').order!('created_at', { ascending: false }),
        typed.from('organization_members').select('user_id, profiles(full_name)').order!('created_at', { ascending: true }),
        // Fotos de participantes de grupo (cacheadas pelo webhook em whatsapp_profiles) —
        // ver comentário na migração 20260807070000_whatsapp_profiles.sql pro porquê disso
        // não vive em `contacts`.
        typed.from('whatsapp_profiles').select('external_id, name, avatar_url').order!('updated_at', { ascending: false }),
        // Pedidos (Funil) — pra mostrar/gerenciar o pedido de um contato direto na aba
        // "Pedido" do próprio Inbox, sem precisar abrir o Funil.
        typed.from('deals').select('id, title, contact_id, stage, value').order!('created_at', { ascending: false }),
        // Etapas do funil configuradas pelo admin — ver comentário na declaração de
        // dealStages logo acima, no topo do componente.
        typed.from('pipeline_stages').select('id, key, label, color, position, is_won, is_lost').order!('position', { ascending: true }),
        // Papel + overrides de permissão do próprio usuário logado — controla, por ex., se
        // o botão de excluir mensagem aparece (a API confere de novo no servidor de
        // qualquer forma; isso aqui é só pra não mostrar um botão que vai dar 403).
        typed.from('organization_members').select('role, permissions').eq!('user_id', user?.id || '').limit(1).maybeSingle(),
      ])

      const convData = (convRes.data || []) as Array<{
        id: string
        organization_id: string
        status: UiConversation['status']
        channel_type: 'whatsapp' | 'instagram'
        current_assignee_id: string | null
        last_message_at: string
        contact_id: string
        csat_score: number | null
        contacts: { name: string | null; phone: string | null; is_group: boolean | null; avatar_url: string | null } | null
        profiles: { full_name: string | null } | null
      }>
      const msgData = (msgRes.data || []) as Array<{
        id: string
        conversation_id: string
        sender_type: 'contact' | 'user' | 'system'
        sender_id: string | null
        content: string
        media_url: string | null
        media_type: MediaType | null
        status: 'sent' | 'delivered' | 'read' | 'failed' | null
        metadata: { group_sender_name?: string | null; group_sender_id?: string | null } | null
        created_at: string
      }>
      const profilesData = (profilesRes.data || []) as Array<{ external_id: string; name: string | null; avatar_url: string | null }>
      const profileByExternalId = new Map(profilesData.map((p) => [p.external_id, p]))
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
      setRealDeals((dealsRes.data || []) as InlineDeal[])
      const stagesData = (stagesRes.data || []) as PipelineStageRow[]
      if (stagesData.length) {
        const mapped = stagesData.map(mapPipelineStageRow)
        setDealStages(mapped)
        setNewDealStage((prev) => (mapped.some((s) => s.key === prev) ? prev : mapped[0].key))
      }

      const myMembership = myMembershipRes.data as { role: UserRole; permissions: CustomPermissions | null } | null
      setCurrentUserRole(myMembership?.role || null)
      setCurrentUserPermissions(myMembership?.permissions || null)

      const built: UiConversation[] = convData.map((conv) => {
        const msgs = msgData
          .filter((m) => m.conversation_id === conv.id)
          .map<UiMessage>((m) => ({
            id: m.id,
            senderType: m.sender_type,
            senderName:
              m.sender_type === 'contact'
                // Numa conversa de grupo, quem "fala" varia mensagem a mensagem — o
                // nome do membro específico (guardado em metadata na hora de receber)
                // tem prioridade sobre o nome do contato (que aqui é o nome do grupo).
                ? m.metadata?.group_sender_name || conv.contacts?.name || 'Cliente'
                : m.sender_type === 'system'
                ? 'Sistema'
                : m.sender_id === user?.id
                ? 'Você'
                : membersData.find((mm) => mm.user_id === m.sender_id)?.profiles?.full_name || 'Atendente',
            content: m.content,
            time: formatTime(m.created_at),
            status: m.status || undefined,
            mediaUrl: m.media_url,
            mediaType: m.media_type,
            senderAvatarUrl:
              m.sender_type === 'contact' && m.metadata?.group_sender_id
                ? profileByExternalId.get(m.metadata.group_sender_id)?.avatar_url || null
                : null,
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
        // `lastMsg.time` já vem formatado ("HH:mm") — pro aviso de SLA (calcula "há
        // quanto tempo" em minutos) precisamos do created_at bruto de novo.
        const lastRawMsg = msgData.filter((m) => m.conversation_id === conv.id).slice(-1)[0]
        const mediaLabel = (t?: MediaType | null) =>
          t === 'image' ? '📷 Imagem' : t === 'video' ? '🎥 Vídeo' : t === 'audio' ? '🎤 Áudio' : t === 'sticker' ? '🌟 Figurinha' : '📎 Arquivo'

        return {
          id: conv.id,
          organizationId: conv.organization_id,
          contactId: conv.contact_id,
          contactName: conv.contacts?.name || 'Contato',
          contactPhone: conv.contacts?.phone || '-',
          contactAvatarUrl: conv.contacts?.avatar_url || null,
          isGroup: !!conv.contacts?.is_group,
          channel: conv.channel_type,
          lastMessage: lastMsg ? lastMsg.content || mediaLabel(lastMsg.mediaType) : '(sem mensagens)',
          lastMessageTime: lastMsg?.time || formatTime(conv.last_message_at),
          lastMessageAtIso: lastRawMsg?.created_at || conv.last_message_at,
          lastMessageSenderType: lastRawMsg?.sender_type,
          csatScore: conv.csat_score,
          status: conv.status,
          currentAssigneeId: conv.current_assignee_id,
          currentAssigneeName: conv.profiles?.full_name || null,
          tags: [],
          notes,
          messages: msgs,
        }
      })

      setRealConversations(built)
      const offlineScope = user ? await getOfflineScope() : null
      if (offlineScope) await cacheEntity(offlineScope, 'inbox', built)

      if (requestedConvId && !appliedRequestedConvRef.current && built.some((c) => c.id === requestedConvId)) {
        appliedRequestedConvRef.current = true
        setSelectedConvId(requestedConvId)
        setMobilePane('chat')
      }
    } catch {
      const offlineScope = await getOfflineScope().catch(() => null)
      const cachedInbox = offlineScope ? await readCachedEntity<UiConversation[]>(offlineScope, 'inbox').catch(() => null) : null
      if (cachedInbox) {
        setRealConversations(cachedInbox)
        setErrorMessage('Você está offline. Exibindo conversas armazenadas neste dispositivo.')
      } else {
        setErrorMessage('Falha ao carregar conversas reais do Supabase.')
      }
    } finally {
      setLoadingReal(false)
    }
  }, [requestedConvId])

  useEffect(() => {
    if (viewMode !== 'real') return
    const timer = setTimeout(() => {
      void fetchRealData()
    }, 0)
    return () => clearTimeout(timer)
  }, [viewMode, fetchRealData])

  // One-time setup: remember the tab's original title (to restore after a "(3) " unread
  // badge) and clear the unread badge whenever the tab regains focus (best-effort proxy
  // for "the attendant saw it" — not per-conversation granular, just "you're back
  // looking at the Inbox").
  useEffect(() => {
    originalTitleRef.current = document.title

    const handleVisibility = () => {
      if (!document.hidden) {
        setUnreadCount(0)
        document.title = originalTitleRef.current
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${originalTitleRef.current}` : originalTitleRef.current
  }, [unreadCount])

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      const unsubscribed = await unsubscribeFromPush()
      if (!unsubscribed) {
        showToast('Não foi possível desativar as notificações neste dispositivo.')
        return
      }
      setNotificationsEnabled(false)
      localStorage.setItem('inbox_notifications_enabled', 'false')
      showToast('Notificações desativadas.')
      return
    }
    const pushSubscribed = await subscribeToPush()
    if (!pushSubscribed) {
      showToast('Não foi possível ativar as notificações neste dispositivo.')
      return
    }
    setNotificationsEnabled(true)
    localStorage.setItem('inbox_notifications_enabled', 'true')
    showToast('Notificações de novas mensagens ativadas.')
  }

  // Short two-tone "ding" via Web Audio API — no external asset/CORS to worry about.
  // Browsers block audio that isn't tied to a user gesture until the page has seen at
  // least one click; the try/catch below just swallows that instead of erroring out.
  const playNotificationSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = audioContextRef.current || new AudioCtx()
      audioContextRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()
      const now = ctx.currentTime
      ;[880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = freq
        osc.connect(gain)
        gain.connect(ctx.destination)
        const start = now + i * 0.12
        gain.gain.setValueAtTime(0.15, start)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15)
        osc.start(start)
        osc.stop(start + 0.16)
      })
    } catch {
      // Autoplay blocked or unsupported — silently skip, the visual badge still works.
    }
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      const context = audioContextRef.current
      audioContextRef.current = null
      if (context && context.state !== 'closed') void context.close()
    }
  }, [])

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

    // Separate listener (same channel) purely for the notification side-effects — needs
    // the raw inserted row, which the generic scheduleRefresh above doesn't inspect.
    const handleNewMessage = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new
      if (row.sender_type !== 'contact') return

      const isDifferentConversation = row.conversation_id !== selectedConvIdRef.current
      const tabHidden = typeof document !== 'undefined' && document.hidden
      if (!isDifferentConversation && !tabHidden) return

      setUnreadCount((n) => n + 1)
      if (notificationsEnabled) {
        playNotificationSound()
        if (tabHidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notif = new Notification('Nova mensagem — Quero Ser Fit CRM', {
            body: typeof row.content === 'string' && row.content ? row.content : 'Você recebeu uma nova mensagem.',
          })
          notif.onclick = () => window.focus()
        }
      }
    }

    const channel = supabase
      .channel('inbox-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, handleNewMessage)
      .subscribe()

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [viewMode, fetchRealData, notificationsEnabled])

  // Rede de segurança pra quando o socket do Realtime morre em silêncio — celular com a
  // tela apagada, notebook que dormiu, troca de Wi-Fi — e não volta sozinho a tempo. O
  // navegador não avisa esse app quando isso acontece, então em vez de tentar detectar o
  // socket morto, força uma busca silenciosa toda vez que a aba volta a ficar visível,
  // a janela recupera o foco, ou a conexão volta — cobrindo exatamente "abri o
  // celular/computador de novo e a mensagem não tinha aparecido" sem precisar de F5 manual.
  useEffect(() => {
    if (viewMode !== 'real') return
    const resync = () => void fetchRealData(true)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', resync)
    window.addEventListener('online', resync)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', resync)
      window.removeEventListener('online', resync)
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

  // Handle Close/Reopen Conversation. A closed conversation reopens on its own the
  // moment the client writes again (persist-event.ts forces status back to 'open' on
  // every inbound message) — these two are for the attendant side: closing to get it
  // off the active queue, or reopening by hand (closed by mistake, or to send one more
  // message before the client replies).
  const handleCloseConversation = async (convId: string) => {
    setErrorMessage(null)
    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { data: success, error: rpcError } = await (supabase as unknown as {
          rpc: (fn: string, params: { p_conversation_id: string }) => Promise<{ data: boolean; error: { message: string } | null }>
        }).rpc('close_conversation_atomic', { p_conversation_id: convId })

        if (rpcError || !success) {
          setErrorMessage('Não foi possível encerrar a conversa.')
          return
        }
        showToast('Conversa encerrada.')
        // Melhor esforço: só dispara se a organização tiver CSAT ligado (a rota decide
        // isso sozinha) — nunca bloqueia nem mostra erro pro atendente se falhar, o
        // fechamento da conversa já aconteceu de qualquer forma.
        fetch(`/api/conversations/${convId}/request-csat`, { method: 'POST' }).catch(() => {})
        fetchRealData()
      } catch {
        setErrorMessage('Erro ao encerrar a conversa.')
      }
    } else {
      updateConversationStatus(convId, 'closed')
      showToast('Conversa encerrada!')
    }
  }

  const handleReopenConversation = async (convId: string) => {
    setErrorMessage(null)
    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { data: success, error: rpcError } = await (supabase as unknown as {
          rpc: (fn: string, params: { p_conversation_id: string }) => Promise<{ data: boolean; error: { message: string } | null }>
        }).rpc('reopen_conversation_atomic', { p_conversation_id: convId })

        if (rpcError || !success) {
          setErrorMessage('Não foi possível reabrir a conversa.')
          return
        }
        showToast('Conversa reaberta.')
        fetchRealData()
      } catch {
        setErrorMessage('Erro ao reabrir a conversa.')
      }
    } else {
      updateConversationStatus(convId, 'open')
      showToast('Conversa reaberta!')
    }
  }

  // Handle Delete Message — confirmation happens via the modal (deleteMessageId set),
  // the actual deletion is server-side (checks `delete_messages` permission again,
  // never trusts `canDeleteMessages` alone) at DELETE /api/messages/[id].
  const confirmDeleteMessage = async () => {
    if (!deleteMessageId) return
    setDeletingMessage(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/messages/${deleteMessageId}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMessage(body.error || 'Falha ao excluir mensagem.')
        return
      }
      showToast('Mensagem excluída.')
      setDeleteMessageId(null)
      fetchRealData()
    } catch {
      setErrorMessage('Erro de conexão ao excluir mensagem.')
    } finally {
      setDeletingMessage(false)
    }
  }

  // Sends a message in real mode — text-only or with an already-uploaded media URL attached.
  const sendRealMessage = async (content: string, mediaUrl?: string, mediaType?: MediaType) => {
    if (!selectedConversation) return
    // Ver comentário de isSendingRef acima: se uma segunda chamada já entrou aqui
    // enquanto a primeira ainda está em voo, aborta esta em vez de mandar em duplicado.
    if (isSendingRef.current) return
    isSendingRef.current = true
    setIsSendingMessage(true)
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selectedConversation.id, content, mediaUrl, mediaType, idempotencyKey: crypto.randomUUID() }),
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
      isSendingRef.current = false
    }
  }

  // Handle attaching a file — uploads straight from the browser to Supabase Storage
  // (respecting the org-scoped RLS policy on the chat-media bucket, not going through
  // our own API routes, since a large video could blow past a serverless function's
  // request body limit), then sends the message with the resulting public URL. Shared
  // by both the paperclip (any file) and the camera (photo capture) inputs.
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selectedConversation || viewMode !== 'real' || !selectedConversation.organizationId) return

    setErrorMessage(null)

    // Foto grande (câmera moderna facilmente passa de 8-15MB): comprime sempre que valer
    // a pena, rápido via Canvas — não é exclusivo de quando estoura o limite, também
    // deixa o envio mais rápido numa conexão de dados fraca.
    if (file.type.startsWith('image/')) {
      file = await compressImageIfLarge(file)
    }

    // Vídeo grande demais pro limite: tenta comprimir com ffmpeg.wasm (mais pesado — só
    // entra em ação quando realmente precisa). Mostra o progresso porque isso pode levar
    // de alguns segundos a mais de um minuto, dependendo do aparelho e do tamanho do vídeo.
    if (file.type.startsWith('video/') && file.size > MAX_MEDIA_SIZE_BYTES) {
      try {
        const compressed = await compressVideo(file, MAX_MEDIA_SIZE_BYTES, setCompressionProgress)
        if (compressed) {
          file = compressed
        } else {
          setErrorMessage(
            'Não foi possível comprimir esse vídeo o suficiente pra caber no limite de 24MB — tente um vídeo mais curto ou grave em qualidade menor.'
          )
          setCompressionProgress(null)
          return
        }
      } finally {
        setCompressionProgress(null)
      }
    }

    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      setErrorMessage('Arquivo maior que 24MB — esse é o limite de anexo do Instagram/WhatsApp. Comprima o vídeo/foto e tente de novo.')
      return
    }

    setUploadingMedia(true)
    try {
      const supabase = createClient()
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      // IDs are generated only after a user selects a file, never during render.
      const path = `${selectedConversation.organizationId}/${selectedConversation.id}/${crypto.randomUUID()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(path, file, { contentType: file.type || undefined })

      if (uploadError) {
        // O Supabase devolve um texto técnico cru ("Attachment size exceeds allowable
        // limit... upload the file in chunks") quando o arquivo passa pela checagem de
        // 24MB acima mas ainda assim estoura o limite de 25MB do bucket (o upload real
        // carrega um pouco de overhead além do tamanho puro do arquivo) — troca por uma
        // mensagem amigável igual à checagem local em vez de mostrar o texto cru.
        const isSizeError = /size|limit|large|chunk/i.test(uploadError.message)
        console.error('[Inbox] Falha ao enviar anexo:', uploadError.message)
        setErrorMessage(
          isSizeError
            ? 'Arquivo grande demais para o limite de anexo (24MB) — comprima o vídeo/foto e tente de novo.'
            : 'Falha ao enviar arquivo. Tente novamente em alguns instantes.'
        )
        return
      }

      const { data: publicUrlData } = supabase.storage.from('chat-media').getPublicUrl(path)
      const mediaType = detectMediaType(file.type || '')
      const caption = newMessageText.trim()
      setNewMessageText('')
      await sendRealMessage(caption, publicUrlData.publicUrl, mediaType)
    } catch {
      setErrorMessage('Erro inesperado ao enviar arquivo.')
    } finally {
      setUploadingMedia(false)
    }
  }

  // Insere o conteúdo de uma resposta rápida no campo de texto — acrescenta numa nova
  // linha se já tiver algo digitado, em vez de sobrescrever o que o atendente começou a
  // escrever.
  const handleInsertQuickReply = (reply: QuickReplyOption) => {
    setNewMessageText((prev) => (prev.trim() ? `${prev}\n${reply.content}` : reply.content))
    setQuickRepliesOpen(false)
  }

  // Handle Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessageText.trim() || !selectedConversation || isSendingMessage || isSendingRef.current) return

    const textToSend = newMessageText
    setNewMessageText('')

    if (viewMode === 'real') {
      await sendRealMessage(textToSend)
      return
    }

    isSendingRef.current = true
    setIsSendingMessage(true)

    // Demo mode
    addMessage(selectedConversation.id, textToSend, 'user', 'Patricia Silva (Você)')
    const targetId = selectedConversation.id
    const clientName = selectedConversation.contactName

    setTimeout(() => {
      setIsSendingMessage(false)
      isSendingRef.current = false
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
      if (!navigator.onLine) {
        const offlineScope = await getOfflineScope()
        if (!offlineScope) {
          setErrorMessage('Sessão indisponível. Conecte-se para salvar a nota.')
          return
        }
        await queueEntityMutation(offlineScope, 'note.create', {
          conversationId: selectedConversation.id,
          content: newNoteText.trim(),
        })
        setNewNoteText('')
        showToast('Nota salva localmente e aguardando sincronização.')
        return
      }
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

  // Cria um pedido (Funil) já anexado ao contato desta conversa — a vendedora não
  // precisa sair do Inbox e ir até o Funil pra registrar "isso virou venda". Compartilhado
  // entre a classificação rápida de um clique (handleQuickClassify, sem formulário) e o
  // formulário detalhado (handleCreateInlineDeal, pra quando ela quer registrar valor ou
  // um título específico).
  const createInlineDeal = async (title: string, stage: DealStage, value: number | null): Promise<boolean> => {
    if (!selectedConversation?.contactId) return false

    setSavingDeal(true)
    setErrorMessage(null)
    try {
      const supabase = createClient()

      const { data: created, error } = await (supabase as unknown as {
        from: (t: string) => {
          insert: (d: unknown) => {
            select: (c: string) => { single: () => Promise<{ data: InlineDeal | null; error: { message: string } | null }> }
          }
        }
      })
        .from('deals')
        .insert({
          title,
          contact_id: selectedConversation.contactId,
          stage,
          value,
          ...(dealStages.find((s) => s.key === stage)?.isWon ? { closed_at: new Date().toISOString() } : {}),
        })
        .select('id, title, contact_id, stage, value')
        .single()

      if (error || !created) {
        setErrorMessage('Não foi possível criar o pedido no Supabase.')
        return false
      }

      setRealDeals((prev) => [created, ...prev])
      showToast('Pedido criado no Funil!')
      return true
    } catch {
      setErrorMessage('Erro ao criar o pedido.')
      return false
    } finally {
      setSavingDeal(false)
    }
  }

  // Classificação de um clique só — usa o nome do contato como título automático, sem
  // formulário nenhum. Pra quando a vendedora só quer marcar rápido "isso virou X", sem
  // se preocupar em digitar título/valor.
  const handleQuickClassify = async (stage: DealStage) => {
    if (!selectedConversation) return
    await createInlineDeal(selectedConversation.contactName, stage, null)
  }

  const handleCreateInlineDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDealTitle.trim()) return
    const parsedValue = newDealValue.trim() ? Number(newDealValue.replace(',', '.')) : null
    const ok = await createInlineDeal(newDealTitle, newDealStage, parsedValue)
    if (ok) {
      setNewDealTitle('')
      setNewDealValue('')
      setNewDealStage(dealStages[0]?.key || 'lead')
    }
  }

  const handleMoveInlineDeal = async (dealId: string, stage: DealStage) => {
    try {
      const supabase = createClient()
      const updates: Record<string, unknown> = { stage }
      if (dealStages.find((s) => s.key === stage)?.isWon) updates.closed_at = new Date().toISOString()

      const { error } = await (supabase as unknown as {
        from: (t: string) => {
          update: (d: unknown) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> }
        }
      })
        .from('deals')
        .update(updates)
        .eq('id', dealId)

      if (error) {
        setErrorMessage('Não foi possível mover o pedido.')
        return
      }

      setRealDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)))
      showToast(`Pedido movido para "${dealStages.find((s) => s.key === stage)?.label}"!`)
    } catch {
      setErrorMessage('Erro ao mover o pedido.')
    }
  }

  // O pedido em aberto deste contato, se existir. realDeals vem ordenado por created_at
  // desc, então o primeiro encontrado é o mais recente — é ele que representa "em que pé
  // está esse cliente" no cabeçalho da conversa.
  const selectedContactDeal = selectedConversation?.contactId
    ? realDeals.find((d) => d.contact_id === selectedConversation.contactId)
    : undefined
  const selectedContactStage = selectedContactDeal
    ? dealStages.find((s) => s.key === selectedContactDeal.stage)
    : undefined

  // Mover a etapa do funil de dentro da conversa. Se o contato ainda não tem pedido, o
  // primeiro toque CRIA um já na etapa escolhida, em vez de exigir que a vendedora vá até
  // o Funil preencher um formulário antes de poder classificar — que é exatamente o passo
  // onde o registro de pedido deixava de acontecer na prática.
  const handleSelectStage = async (stage: DealStage) => {
    if (!selectedConversation?.contactId) return
    setStageSheetOpen(false)
    if (selectedContactDeal) {
      await handleMoveInlineDeal(selectedContactDeal.id, stage)
    } else {
      await createInlineDeal(selectedConversation.contactName, stage, null)
    }
  }

  /**
   * Cria um lembrete (tarefa) já amarrado a este cliente E a esta conversa.
   *
   * `conversation_id` e `contact_id` são colunas que a tabela `tasks` sempre teve e que
   * ninguém preenchia — a tela de Tarefas só sabia criar tarefa solta, escolhendo o cliente
   * num seletor. Preenchendo aqui, a tarefa vira um caminho de volta: a lista de Tarefas
   * ganha um botão que abre exatamente esta conversa.
   *
   * A organização não vai no insert de propósito: o trigger trg_autofill_org_tasks a
   * preenche a partir de quem está chamando, mesmo padrão do insert de pedidos.
   */
  const handleCreateReminder = async (option: ReminderOption) => {
    if (!selectedConversation?.contactId) return
    setReminderSheetOpen(false)
    setSavingReminder(true)
    setErrorMessage(null)
    try {
      const supabase = createClient()
      const { error } = await (supabase as unknown as {
        from: (t: string) => { insert: (d: unknown) => Promise<{ error: { message: string } | null }> }
      })
        .from('tasks')
        .insert({
          title: `Retornar contato com ${selectedConversation.contactName}`,
          due_date: option.dueDate().toISOString(),
          status: 'pending',
          priority: 'media',
          contact_id: selectedConversation.contactId,
          conversation_id: selectedConversation.id,
          assigned_to_id: currentUserRealId,
        })

      if (error) {
        console.error('[Inbox] Falha ao criar lembrete:', error.message)
        setErrorMessage('Não foi possível criar o lembrete.')
        return
      }
      showToast(`Lembrete criado para ${option.label.toLowerCase()}.`)
    } catch {
      setErrorMessage('Erro ao criar o lembrete.')
    } finally {
      setSavingReminder(false)
    }
  }

  // Apply Queue, Channel, and Search Filters
  const filteredConversations = conversations.filter((c) => {
    const effectiveCurrentUserId = viewMode === 'real' ? currentUserRealId : currentUserId
    const isMine = c.currentAssigneeId === effectiveCurrentUserId
    // Só "currentAssigneeId ausente" conta como não-atribuída. Não usar `status === 'open'`
    // aqui: persist-event.ts força status de volta pra 'open' a cada mensagem nova do
    // cliente, mesmo numa conversa já atribuída — usar isso pra decidir "fila" fazia uma
    // conversa que já é de uma vendedora reaparecer como "Fila de Espera" pro time
    // inteiro assim que o cliente mandasse qualquer mensagem de acompanhamento.
    const isUnassigned = !c.currentAssigneeId

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

  // Só no modo real — o modo demo não tem um papel de verdade por trás, e a API que
  // realmente apaga a mensagem não existe nesse modo de qualquer forma. Antes do papel
  // carregar, `currentUserRole` é null → hasPermission trata como 'attendant' (o menos
  // privilegiado), então o botão não pisca aparecendo e sumindo pra quem não pode usá-lo.
  const canDeleteMessages =
    viewMode === 'real' && hasPermission(currentUserRole || 'attendant', currentUserPermissions, 'delete_messages')
  const canCloseConversations =
    viewMode === 'real' && hasPermission(currentUserRole || 'attendant', currentUserPermissions, 'close_conversations')
  // Espelha a checagem real feita agora dentro de transfer_conversation_atomic (ver
  // migration 20260818000000) — só pra não mostrar um botão que vai dar erro no clique;
  // a permissão de verdade continua sendo garantida no banco, não aqui.
  const canTransferConversations =
    viewMode !== 'real' || hasPermission(currentUserRole || 'attendant', currentUserPermissions, 'transfer_conversations')
  const isConversationClosed = selectedConversation?.status === 'closed'

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b1320] text-slate-100 overflow-hidden relative">
      {/* Header Banner & Mode Selector — some no celular: dizia "Conversas Conectadas ao
          Supabase", que é informação de quem monta o sistema, não de quem atende, e comia
          uma faixa inteira da tela. O que era útil aqui (ligar/desligar notificação) foi
          pro cabeçalho da própria lista, ver abaixo. */}
      <div className="hidden lg:flex bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 border-b border-emerald-800/40 px-4 py-2 items-center justify-between text-xs shrink-0">
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

        <div className="flex items-center gap-2">
          {viewMode === 'real' && (
            <button
              onClick={toggleNotifications}
              title={notificationsEnabled ? 'Notificações ativadas — clique pra desativar' : 'Ativar som e notificação de novas mensagens'}
              className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                notificationsEnabled
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {notificationsEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            </button>
          )}

          {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
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
          )}
        </div>
      </div>

      <Toast message={toastMessage} />

      {errorMessage && (
        <div className="bg-rose-950/80 border-b border-rose-800 text-rose-200 px-4 py-2 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3-Column Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Col 1: Conversations List & Queue Filters */}
        <div className={`w-full md:w-80 lg:w-96 border-r border-slate-800 flex flex-col bg-[#0f172a] shrink-0 ${
          showMobileList ? 'flex' : 'hidden lg:flex'
        }`}>
          <div className="p-3 border-b border-slate-800 space-y-2.5">
            {/* Título + notificações, só no celular: aqui o cabeçalho global mostra a marca,
                não onde a pessoa está. No desktop a barra lateral já responde isso. */}
            <div className="lg:hidden flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold text-slate-100">Conversas</h1>
              {viewMode === 'real' && (
                <button
                  onClick={toggleNotifications}
                  aria-label={notificationsEnabled ? 'Desativar notificações de novas mensagens' : 'Ativar notificações de novas mensagens'}
                  className={`p-2 rounded-xl border transition ${
                    notificationsEnabled
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  {notificationsEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                </button>
              )}
            </div>

            <Input
              type="text"
              placeholder="Buscar cliente ou mensagem..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />

            {/* Filtros numa faixa só, rolável na horizontal. Eram DUAS faixas empilhadas
                (fila e canal), ~80px gastos antes da primeira conversa aparecer. São duas
                dimensões independentes de verdade, então continuam separadas por um traço
                em vez de viverem misturadas na mesma lista de opções. */}
            <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([
                { key: 'all', label: `Todas (${conversations.length})` },
                { key: 'unassigned', label: `Sem responsável (${conversations.filter((c) => !c.currentAssigneeId).length})` },
                { key: 'mine', label: 'Minhas' },
              ] as const).map((chip) => (
                <button
                  key={chip.key}
                  onClick={() => setFilterQueue(chip.key)}
                  aria-pressed={filterQueue === chip.key}
                  suppressHydrationWarning
                  className={`shrink-0 px-3 py-1.5 rounded-full font-medium border transition whitespace-nowrap ${
                    filterQueue === chip.key
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 font-semibold'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {chip.label}
                </button>
              ))}

              <span className="shrink-0 w-px h-5 bg-slate-800 mx-0.5" aria-hidden="true" />

              {([
                { key: 'whatsapp', label: 'WhatsApp', Icon: Phone },
                { key: 'instagram', label: 'Instagram', Icon: Instagram },
              ] as const).map(({ key, label, Icon }) => {
                const active = filterChannel === key
                return (
                  <button
                    key={key}
                    // Age como interruptor: tocar no canal já ativo volta pra "todos os
                    // canais", em vez de exigir um terceiro botão só pra desfazer.
                    onClick={() => setFilterChannel(active ? 'all' : key)}
                    aria-pressed={active}
                    className={`shrink-0 px-3 py-1.5 rounded-full font-medium border transition whitespace-nowrap flex items-center gap-1.5 ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 font-semibold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {viewMode === 'real' && loadingReal && realConversations.length === 0 ? (
              // Esqueleto no formato real da lista, em vez do spinner genérico ou do
              // "Nenhuma conversa" piscando por um instante antes do primeiro carregamento
              // terminar — evita o falso alarme de "não tem nada aqui" logo ao abrir o Inbox.
              <div className="p-3 space-y-4" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-2.5 w-8" />
                      </div>
                      <Skeleton className="h-2.5 w-4/5" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
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
              filteredConversations.map((conv, index) => {
                const isSelected = selectedConversation && conv.id === selectedConversation.id
                const isWhatsApp = conv.channel === 'whatsapp'
                // Cabeçalho de data só aparece quando muda em relação à conversa anterior
                // da lista (que já vem ordenada mais recente primeiro) — não reordena nada,
                // só agrupa visualmente o que já está na ordem certa.
                const dateLabel = formatDateHeader(conv.lastMessageAtIso)
                const showDateHeader = index === 0 || dateLabel !== formatDateHeader(filteredConversations[index - 1].lastMessageAtIso)
                // Vem do UnreadProvider (layout), não daqui: a mesma contagem alimenta a
                // bolinha da barra de navegação, que precisa funcionar com o Inbox fechado.
                const unreadCount = unreadCounts[conv.id] || 0

                return (
                  <Fragment key={conv.id}>
                  {showDateHeader && (
                    <div className="px-3.5 pt-3 pb-1.5 bg-[#0f172a] sticky top-0 z-10">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{dateLabel}</span>
                    </div>
                  )}
                  {/* Linha no formato que a vendedora já lê sem pensar: foto, nome, o que a
                      pessoa falou por último, horário. O canal virou um selo pequeno na
                      quina da foto e o estado do atendimento virou uma linha de texto
                      discreta — antes eram até TRÊS etiquetas coloridas por linha (canal +
                      grupo + fila/responsável), o que transformava a lista num mosaico e
                      empurrava a última mensagem, que é o que realmente importa, pra
                      terceiro plano. */}
                  <div
                    onClick={() => {
                      setSelectedConvId(conv.id)
                      setMobilePane('chat')
                      markRead(conv.id)
                    }}
                    className={`px-3.5 py-3 cursor-pointer transition flex items-center gap-3 ${
                      isSelected ? 'bg-slate-800/90 lg:border-l-4 lg:border-l-emerald-400' : 'hover:bg-slate-800/40 active:bg-slate-800/60'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar name={conv.contactName} src={conv.contactAvatarUrl} size="md" />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-[#0f172a] ${
                          isWhatsApp ? 'bg-emerald-500 text-slate-950' : 'bg-pink-500 text-white'
                        }`}
                        title={isWhatsApp ? 'WhatsApp' : 'Instagram'}
                      >
                        {isWhatsApp ? <Phone className="w-2 h-2" /> : <Instagram className="w-2 h-2" />}
                        <span className="sr-only">{isWhatsApp ? 'WhatsApp' : 'Instagram'}</span>
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline gap-2">
                        <h3 className="text-sm font-semibold text-slate-100 truncate flex items-center gap-1.5">
                          <span className="truncate">{conv.contactName}</span>
                          {conv.isGroup && <Users className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                        </h3>
                        <span
                          className={`text-[10px] shrink-0 tabular-nums ${
                            unreadCount > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-500'
                          }`}
                        >
                          {conv.lastMessageTime}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p
                          className={`text-xs truncate flex-1 ${
                            unreadCount > 0 ? 'text-slate-200 font-medium' : 'text-slate-400'
                          }`}
                        >
                          {conv.lastMessage}
                        </p>
                        {/* A bolinha na linha da última mensagem, como em qualquer app de
                            mensagem. O horário e a prévia também escurecem/clareiam junto:
                            depender só da bolinha deixaria a distinção invisível pra quem
                            não enxerga bem a diferença entre verde e cinza. */}
                        {unreadCount > 0 && (
                          <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center tabular-nums">
                            {formatUnreadBadge(unreadCount)}
                            <span className="sr-only"> não lidas</span>
                          </span>
                        )}
                      </div>

                      {/* Só aparece quando diz algo: conversa encerrada, ninguém atendendo,
                          ou quem está atendendo. Nunca as três coisas ao mesmo tempo. */}
                      {conv.status === 'closed' ? (
                        <span className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
                          <Archive className="w-3 h-3 shrink-0" />
                          Encerrada
                        </span>
                      ) : !conv.currentAssigneeId ? (
                        <span className="flex items-center gap-1.5 text-[10px] text-amber-400/90 mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
                          Sem responsável
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-slate-500 mt-1 truncate">
                          <User className="w-3 h-3 shrink-0" />
                          <span className="truncate">{conv.currentAssigneeName}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  </Fragment>
                )
              })
            )}
          </div>
        </div>

        {/* Col 2: Chat Thread */}
        {selectedConversation ? (
          <div className={`flex-1 flex flex-col bg-[#0b1320] min-w-0 ${
            showMobileChat ? 'flex' : 'hidden lg:flex'
          }`}>
            {/* Thread Header — voltar, quem é o cliente, e um menu. Antes havia até quatro
                botões com texto ("Assumir", "Transferir", "Encerrar" + um ícone de Kanban)
                brigando por espaço com o nome numa tela de 375px. Só "Assumir" continua
                visível: é a ação de abrir a conversa, e some assim que ela é feita. */}
            {/* pt com --safe-top: com a conversa aberta no celular o cabeçalho global sai de
                cena (modo imersivo) e ESTE passa a ser o primeiro elemento da tela. Como o
                app declara statusBarStyle 'black-translucent' + viewport-fit=cover, sem esse
                recuo ele sobe pra debaixo da barra de status do iPhone — e o botão de voltar
                fica embaixo do relógio do sistema, onde o toque não chega nele. */}
            <div className="px-2 pb-2 pt-[calc(0.5rem+var(--safe-top))] lg:px-3.5 lg:pb-3 lg:pt-3 border-b border-slate-800 bg-[#0f172a]/90 flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setMobilePane('list')}
                className="lg:hidden p-2 -mr-0.5 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition shrink-0"
                aria-label="Voltar para a lista de conversas"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Tocar no avatar/nome abre a ficha do cliente — é o gesto que a pessoa já
                  traz do WhatsApp. Antes o único caminho era um ícone de Kanban sem rótulo
                  no canto, que ninguém associa a "dados do contato". */}
              <button
                type="button"
                onClick={() => {
                  setActiveTabRight('info')
                  setMobilePane('details')
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left py-1 pr-1 rounded-lg hover:bg-slate-800/50 transition focus:outline-none focus-visible:bg-slate-800/60"
                aria-label={`Ver ficha de ${selectedConversation.contactName}`}
              >
                <Avatar name={selectedConversation.contactName} src={selectedConversation.contactAvatarUrl} size="md" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-100 truncate">
                      {selectedConversation.contactName}
                    </span>
                    {selectedConversation.isGroup && <Users className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                  </span>
                  {/* Linha de contexto comercial: a etapa do funil quando existe pedido
                      (o que a vendedora precisa saber pra conduzir a conversa), e o canal
                      como recurso quando ainda não existe. */}
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                    {selectedContactStage ? (
                      <>
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_DOT_CLASS[selectedContactStage.color]}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{selectedContactStage.label}</span>
                      </>
                    ) : (
                      <span className="truncate">
                        {selectedConversation.channel === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                        {selectedConversation.contactPhone && selectedConversation.contactPhone !== '-'
                          ? ` · ${selectedConversation.contactPhone}`
                          : ''}
                      </span>
                    )}
                  </span>
                </span>
              </button>

              {selectedConversation.currentAssigneeId !== effectiveCurrentUserId && (
                <Button onClick={() => handleAssume(selectedConversation.id)} size="sm" variant="primary" className="shrink-0">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Assumir</span>
                </Button>
              )}

              <button
                type="button"
                onClick={() => setActionsSheetOpen(true)}
                className="p-2 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition shrink-0"
                aria-label="Mais ações desta conversa"
                title="Mais ações"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            {isConversationClosed && (
              <div className="bg-slate-800/60 border-b border-slate-700 px-4 py-2 text-xs text-slate-300 flex items-center gap-2 shrink-0">
                <Archive className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Esta conversa está encerrada. Ela reabre sozinha se o cliente escrever de novo.</span>
              </div>
            )}

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
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 min-h-0 p-4 overflow-y-auto space-y-3.5 bg-[#080e18]"
            >
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
                // Numa conversa de grupo, várias pessoas diferentes mandam mensagem —
                // a fotinha ao lado (estilo WhatsApp) ajuda a equipe não se perder em
                // quem é quem sem precisar reler o nome de cada mensagem.
                const showGroupAvatar = selectedConversation.isGroup && msg.senderType === 'contact'

                return (
                  <div
                    key={msg.id}
                    className={`group flex gap-2 max-w-[80%] md:max-w-[70%] ${isMe ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                  >
                    {showGroupAvatar && <Avatar name={msg.senderName} src={msg.senderAvatarUrl} size="sm" className="mt-4" />}
                    <div className={`flex flex-col min-w-0 ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-center gap-1.5 mb-1 px-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <span className="text-[10px] text-slate-500">{msg.senderName}</span>
                      {canDeleteMessages && (
                        <button
                          type="button"
                          onClick={() => setDeleteMessageId(msg.id)}
                          title="Excluir mensagem"
                          aria-label={`Excluir mensagem de ${msg.senderName}`}
                          // Sempre visível no celular, revelado no hover só a partir do lg.
                          // Antes era `opacity-0 group-hover:opacity-100` puro — e como
                          // aparelho de toque não tem "passar o mouse por cima", o botão
                          // ficava invisível pra sempre no celular. A permissão existia, a
                          // rota existia, e a função simplesmente não tinha como ser
                          // alcançada onde o CRM mais é usado.
                          //
                          // p-2 -my-2 aumenta a área de toque de 12px pra ~28px sem crescer
                          // a linha (a margem negativa devolve no vertical o que o padding
                          // tomou). Fica abaixo dos 44px recomendados de propósito: é uma
                          // ação destrutiva ao lado do nome em TODA mensagem, e um alvo
                          // generoso demais aqui convidaria ao toque errado. O modal de
                          // confirmação continua sendo a rede de segurança.
                          className="p-2 -my-2 lg:p-0 lg:my-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition text-slate-500 hover:text-rose-400 active:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5 lg:w-3 lg:h-3" />
                        </button>
                      )}
                    </div>
                    <div
                      className={`p-3 rounded-2xl text-xs leading-relaxed ${
                        isFailed
                          ? 'bg-rose-950/50 text-rose-100 border border-rose-800/70 rounded-tr-none'
                          : isMe
                          // Verde escuro chapado, não degradê. Dois motivos: degradê de duas
                          // cores é a marca registrada de maquete gerada por IA (foi o que
                          // você pediu pra tirar do resto do app), e o texto tem 12px — sobre
                          // emerald-600 o branco fica em ~3,5:1 de contraste, abaixo do
                          // mínimo legível. Sobre emerald-800 passa de 7:1.
                          ? 'bg-emerald-800 text-white rounded-tr-none shadow-sm'
                          : 'bg-[#131f37] text-slate-200 border border-slate-700/80 rounded-tl-none'
                      }`}
                    >
                      {msg.mediaUrl && (
                        <div className="mb-1.5">
                          {msg.mediaType === 'image' || msg.mediaType === 'sticker' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={msg.mediaUrl}
                              alt="Mídia enviada"
                              className="rounded-xl max-w-full max-h-72 object-contain bg-black/20 cursor-pointer"
                              onClick={() => window.open(msg.mediaUrl!, '_blank')}
                            />
                          ) : msg.mediaType === 'video' ? (
                            <video src={msg.mediaUrl} controls className="rounded-xl max-w-full max-h-72" />
                          ) : msg.mediaType === 'audio' ? (
                            <audio src={msg.mediaUrl} controls className="w-full" />
                          ) : (
                            <a
                              href={msg.mediaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition rounded-xl px-3 py-2"
                            >
                              <FileIcon className="w-4 h-4 shrink-0" />
                              <span className="truncate flex-1">Documento anexado</span>
                              <Download className="w-3.5 h-3.5 shrink-0" />
                            </a>
                          )}
                        </div>
                      )}
                      {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                      <span className={`text-[9px] flex items-center justify-end gap-1 mt-1.5 ${isFailed ? 'text-rose-300' : isMe ? 'text-emerald-200' : 'text-slate-400'}`}>
                        {msg.time}
                        {isMe && !isFailed && (
                          msg.status === 'read' ? (
                            <CheckCheck className="w-3 h-3 text-sky-300" />
                          ) : msg.status === 'delivered' ? (
                            <CheckCheck className="w-3 h-3" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )
                        )}
                      </span>
                    </div>
                    {isFailed && (
                      <span className="text-[10px] text-rose-400 flex items-center gap-1 mt-1 px-1">
                        <AlertCircle className="w-3 h-3" />
                        Falha ao enviar
                      </span>
                    )}
                    </div>
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

              {/* Video Compression Progress — pode levar de segundos a mais de um minuto
                  num vídeo grande/aparelho mais fraco, então mostra progresso em vez de
                  só um spinner genérico. */}
              {compressionProgress && (
                <div className="flex justify-start my-2">
                  <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-2xl text-slate-400 text-xs flex items-center gap-2 min-w-[220px]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
                    <div className="flex-1">
                      <span>
                        {compressionProgress.stage === 'loading'
                          ? 'Preparando compressão de vídeo...'
                          : `Comprimindo vídeo... ${Math.round(compressionProgress.ratio * 100)}%`}
                      </span>
                      {compressionProgress.stage === 'compressing' && (
                        <div className="mt-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${Math.round(compressionProgress.ratio * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Message Input Form — closed conversations require an explicit reopen
                before typing again, so "encerrar" actually takes it off the active
                queue instead of just being a label nobody notices. */}
            {isConversationClosed ? (
              <div className="p-3 border-t border-slate-800 bg-[#0f172a] shrink-0 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Conversa encerrada — reabra pra continuar respondendo.</span>
                <Button
                  onClick={() => handleReopenConversation(selectedConversation.id)}
                  size="sm"
                  variant="secondary"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reabrir</span>
                </Button>
              </div>
            ) : (
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-[#0f172a] shrink-0">
              <div className="flex items-center gap-2">
                {viewMode === 'real' && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                      onChange={handleFileSelected}
                      disabled={uploadingMedia || isSendingMessage || !!compressionProgress}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingMedia || isSendingMessage || !!compressionProgress}
                      title="Anexar imagem, vídeo, áudio ou documento"
                      className="p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-700 transition disabled:opacity-50 shrink-0"
                    >
                      {uploadingMedia ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                    </button>

                    {/* `capture` abre a câmera do celular direto (em vez do seletor de
                        arquivos) — em desktop sem câmera, cai de volta pro seletor normal. */}
                    <input
                      ref={cameraInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileSelected}
                      disabled={uploadingMedia || isSendingMessage || !!compressionProgress}
                    />
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={uploadingMedia || isSendingMessage || !!compressionProgress}
                      title="Tirar foto"
                      className="p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-700 transition disabled:opacity-50 shrink-0"
                    >
                      <Camera className="w-4 h-4" />
                    </button>

                    <div className="relative shrink-0" ref={quickRepliesRef}>
                      <button
                        type="button"
                        onClick={() => setQuickRepliesOpen((v) => !v)}
                        disabled={isSendingMessage || uploadingMedia || !!compressionProgress}
                        title="Respostas rápidas"
                        className="p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-700 transition disabled:opacity-50"
                      >
                        <Zap className="w-4 h-4" />
                      </button>

                      {quickRepliesOpen && (
                        <div className="absolute bottom-full mb-2 left-0 w-72 max-h-64 overflow-y-auto bg-[#131f37] border border-slate-700 rounded-2xl shadow-2xl py-2 z-50 text-xs">
                          {quickReplies.length === 0 ? (
                            <div className="px-4 py-3 text-slate-400">
                              Nenhuma resposta rápida cadastrada.{' '}
                              <Link href="/configuracoes/respostas-rapidas" className="text-emerald-400 hover:underline">
                                Criar agora
                              </Link>
                            </div>
                          ) : (
                            quickReplies.map((reply) => (
                              <button
                                key={reply.id}
                                type="button"
                                onClick={() => handleInsertQuickReply(reply)}
                                className="w-full text-left px-4 py-2 hover:bg-slate-800 transition"
                              >
                                <p className="font-semibold text-slate-200">{reply.title}</p>
                                <p className="text-slate-400 line-clamp-1">{reply.content}</p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
                <input
                  type="text"
                  placeholder="Mensagem"
                  value={newMessageText}
                  onChange={(e) => setNewMessageText(e.target.value)}
                  disabled={isSendingMessage || uploadingMedia || !!compressionProgress}
                  // text-base no celular pelo mesmo motivo do componente Input: fonte menor
                  // que 16px faz o Safari do iPhone dar zoom ao focar. Num campo que é
                  // focado o tempo todo, esse seria o incômodo mais repetido do app.
                  className="flex-1 min-w-0 px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-base lg:text-xs text-slate-100 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <Button type="submit" disabled={!newMessageText.trim() || isSendingMessage || uploadingMedia || !!compressionProgress} size="md" variant="primary">
                  {isSendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </form>
            )}
          </div>
        ) : (
          /* Empty State when no conversation selected — `hidden lg:flex` porque no celular
             quem manda é a lista, que já ocupa a tela toda. Sem isso, esta coluna entrava
             na mesma linha flex que ela e disputava largura com a lista. */
          <div className="hidden lg:flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-400 bg-[#080e18]">
            <InboxIcon className="w-12 h-12 text-slate-600 mb-3" />
            <h3 className="text-base font-bold text-slate-200">Nenhuma conversa selecionada</h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1">
              Escolha um contato na lista ao lado para começar ou continuar o atendimento.
            </p>
          </div>
        )}

        {/* Col 3: Contact Profile & Internal Notes */}
        {selectedConversation && (
          <div className={`w-full lg:w-80 border-l border-slate-800 bg-[#0f172a] flex-col shrink-0 ${
            showMobileDetails ? 'flex' : 'hidden lg:flex'
          }`}>
            {/* Mesmo recuo do cabeçalho da conversa: este painel também ocupa a tela toda no
                celular, então também encosta na barra de status. */}
            <div className="flex items-center border-b border-slate-800 text-xs pt-[var(--safe-top)] lg:pt-0">
              <button
                type="button"
                onClick={() => setMobilePane('chat')}
                className="lg:hidden p-3 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition shrink-0"
                aria-label="Voltar para a conversa"
                title="Voltar para a conversa"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
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
                <span>Notas</span>
              </button>
              <button
                onClick={() => setActiveTabRight('pedido')}
                className={`flex-1 py-3 font-semibold flex items-center justify-center gap-1.5 border-b-2 transition ${
                  activeTabRight === 'pedido' ? 'border-emerald-400 text-emerald-400 bg-slate-800/50' : 'text-slate-400'
                }`}
              >
                <Kanban className="w-3.5 h-3.5" />
                <span>Pedido</span>
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

                {typeof selectedConversation.csatScore === 'number' && (
                  <div>
                    <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-2">
                      Avaliação do Cliente
                    </h3>
                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`w-4 h-4 ${n <= selectedConversation.csatScore! ? 'text-amber-400 fill-amber-400' : 'text-slate-700'}`}
                        />
                      ))}
                      <span className="text-slate-300 font-semibold ml-1">{selectedConversation.csatScore}/5</span>
                    </div>
                  </div>
                )}

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
                    className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-base lg:text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <Button type="submit" disabled={!newNoteText.trim()} variant="secondary" className="w-full">
                    Adicionar Nota
                  </Button>
                </form>
              </div>
            )}

            {activeTabRight === 'pedido' && (
              <div className="p-4 flex flex-col flex-1 text-xs overflow-y-auto space-y-4">
                {viewMode !== 'real' || !selectedConversation.contactId ? (
                  <p className="text-slate-500 text-center py-6 text-xs">
                    Disponível no modo com dados reais.
                  </p>
                ) : (
                  <>
                    <div>
                      <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-2">
                        Pedidos deste cliente
                      </h3>
                      {realDeals.filter((d) => d.contact_id === selectedConversation.contactId).length === 0 ? (
                        <p className="text-slate-500 text-xs bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                          Nenhum pedido ainda. Se essa conversa virou venda, separa aqui embaixo — sem precisar ir até o Funil.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {realDeals
                            .filter((d) => d.contact_id === selectedConversation.contactId)
                            .map((deal) => {
                              const stageInfo = dealStages.find((s) => s.key === deal.stage)
                              return (
                                <div key={deal.id} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="font-semibold text-slate-200 leading-snug">{deal.title}</span>
                                    <Badge variant={stageInfo?.color}>{stageInfo?.label || deal.stage}</Badge>
                                  </div>
                                  {deal.value != null && (
                                    <span className="flex items-center gap-1 text-emerald-400 font-semibold text-[11px] font-mono tabular-nums">
                                      <DollarSign className="w-3 h-3" />
                                      {deal.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </span>
                                  )}
                                  <select
                                    value={deal.stage}
                                    onChange={(e) => void handleMoveInlineDeal(deal.id, e.target.value as DealStage)}
                                    className="w-full bg-slate-950 border border-slate-800 text-slate-300 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-emerald-500"
                                    aria-label="Mover pedido para outra etapa"
                                  >
                                    {dealStages.map((s) => (
                                      <option key={s.key} value={s.key}>
                                        Mover: {s.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )
                            })}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
                        Classificar rápido
                      </h3>
                      <p className="text-slate-500 text-[11px] -mt-1">
                        Um clique cria o pedido nessa etapa (sem precisar preencher nada).
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {dealStages.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => void handleQuickClassify(s.key)}
                            disabled={savingDeal}
                            className="disabled:opacity-50 disabled:cursor-not-allowed transition hover:brightness-110"
                          >
                            <Badge variant={s.color}>{s.label}</Badge>
                          </button>
                        ))}
                      </div>
                    </div>

                    <form onSubmit={handleCreateInlineDeal} className="space-y-2 border-t border-slate-800 pt-3">
                      <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
                        Ou com detalhes (título/valor)
                      </h3>
                      <input
                        placeholder="Ex: Kit marmitas fit semanal"
                        value={newDealTitle}
                        onChange={(e) => setNewDealTitle(e.target.value)}
                        className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
                      />
                      <input
                        placeholder="Valor (R$) — opcional"
                        inputMode="decimal"
                        value={newDealValue}
                        onChange={(e) => setNewDealValue(e.target.value)}
                        className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
                      />
                      <select
                        value={newDealStage}
                        onChange={(e) => setNewDealStage(e.target.value as DealStage)}
                        className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-base lg:text-xs"
                      >
                        {dealStages.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" disabled={!newDealTitle.trim() || savingDeal} variant="primary" className="w-full">
                        <Plus className="w-3.5 h-3.5" />
                        <span>{savingDeal ? 'Salvando...' : 'Criar Pedido'}</span>
                      </Button>
                    </form>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Menu "⋮" da conversa — o que antes eram botões soltos no cabeçalho, mais os
          caminhos que só existiam escondidos atrás de um ícone (ficha, notas, pedido). */}
      <BottomSheet
        isOpen={actionsSheetOpen}
        onClose={() => setActionsSheetOpen(false)}
        title="Ações da conversa"
        description={selectedConversation?.contactName}
      >
        <BottomSheetItem
          icon={<Info className="w-[18px] h-[18px]" />}
          label="Ver ficha do cliente"
          onClick={() => {
            setActionsSheetOpen(false)
            setActiveTabRight('info')
            setMobilePane('details')
          }}
        />
        <BottomSheetItem
          icon={<Kanban className="w-[18px] h-[18px]" />}
          label={selectedContactStage ? 'Mover no funil' : 'Classificar no funil'}
          hint={
            viewMode !== 'real' || !selectedConversation?.contactId
              ? 'Disponível no modo com dados reais'
              : selectedContactStage
              ? `Agora em "${selectedContactStage.label}"`
              : 'Este cliente ainda não tem pedido'
          }
          disabled={viewMode !== 'real' || !selectedConversation?.contactId}
          onClick={() => {
            setActionsSheetOpen(false)
            setStageSheetOpen(true)
          }}
        />
        <BottomSheetItem
          icon={<Clock className="w-[18px] h-[18px]" />}
          label="Criar lembrete de retorno"
          hint={
            viewMode !== 'real' || !selectedConversation?.contactId
              ? 'Disponível no modo com dados reais'
              : 'Vira uma tarefa ligada a esta conversa'
          }
          disabled={viewMode !== 'real' || !selectedConversation?.contactId || savingReminder}
          onClick={() => {
            setActionsSheetOpen(false)
            setReminderSheetOpen(true)
          }}
        />
        <BottomSheetItem
          icon={<FileText className="w-[18px] h-[18px]" />}
          label="Notas internas"
          hint="Só a equipe vê"
          onClick={() => {
            setActionsSheetOpen(false)
            setActiveTabRight('notes')
            setMobilePane('details')
          }}
        />
        {canTransferConversations && (
          <BottomSheetItem
            icon={<ArrowRightLeft className="w-[18px] h-[18px]" />}
            label="Transferir atendimento"
            onClick={() => {
              setActionsSheetOpen(false)
              setTransferModalOpen(true)
            }}
          />
        )}
        {canCloseConversations && selectedConversation && (
          <BottomSheetItem
            icon={
              isConversationClosed ? (
                <RotateCcw className="w-[18px] h-[18px]" />
              ) : (
                <Archive className="w-[18px] h-[18px]" />
              )
            }
            label={isConversationClosed ? 'Reabrir conversa' : 'Encerrar conversa'}
            hint={isConversationClosed ? undefined : 'Reabre sozinha se o cliente escrever'}
            onClick={() => {
              setActionsSheetOpen(false)
              if (isConversationClosed) {
                void handleReopenConversation(selectedConversation.id)
              } else {
                void handleCloseConversation(selectedConversation.id)
              }
            }}
          />
        )}
      </BottomSheet>

      {/* Etapa do funil sem sair da conversa. Se o cliente ainda não tem pedido, escolher
          uma etapa aqui já cria — ver handleSelectStage. */}
      <BottomSheet
        isOpen={stageSheetOpen}
        onClose={() => setStageSheetOpen(false)}
        title={selectedContactDeal ? 'Mover para a etapa' : 'Classificar neste cliente'}
        description={selectedConversation?.contactName}
      >
        {dealStages.map((stage) => (
          <BottomSheetItem
            key={stage.key}
            icon={<span className={`w-2.5 h-2.5 rounded-full ${STAGE_DOT_CLASS[stage.color]}`} aria-hidden="true" />}
            label={stage.label}
            selected={selectedContactDeal?.stage === stage.key}
            disabled={savingDeal}
            onClick={() => void handleSelectStage(stage.key)}
          />
        ))}
        {!selectedContactDeal && (
          <p className="px-3 pt-2 text-[11px] text-slate-500 leading-relaxed">
            Isso cria o pedido já nessa etapa, usando o nome do cliente como título. Dá pra
            ajustar título e valor depois, na aba Pedido ou no Funil.
          </p>
        )}
      </BottomSheet>

      {/* Lembrete de retorno — prazos prontos, um toque cada. Ver REMINDER_OPTIONS. */}
      <BottomSheet
        isOpen={reminderSheetOpen}
        onClose={() => setReminderSheetOpen(false)}
        title="Lembrar de retornar"
        description={selectedConversation?.contactName}
      >
        {REMINDER_OPTIONS.map((option) => (
          <BottomSheetItem
            key={option.label}
            icon={<Clock className="w-[18px] h-[18px]" />}
            label={option.label}
            hint={option.hint}
            disabled={savingReminder}
            onClick={() => void handleCreateReminder(option)}
          />
        ))}
        <p className="px-3 pt-2 text-[11px] text-slate-500 leading-relaxed">
          A tarefa aparece em Tarefas com um atalho de volta pra esta conversa.
        </p>
      </BottomSheet>

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
            className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-base lg:text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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

      {/* Delete Message Confirmation Modal */}
      <Modal
        isOpen={!!deleteMessageId}
        onClose={() => setDeleteMessageId(null)}
        title="Excluir Mensagem"
        icon={<Trash2 className="w-5 h-5" />}
      >
        <div className="space-y-3 text-xs">
          <p className="text-slate-300 leading-relaxed">
            A mensagem some da conversa pra toda a equipe aqui no CRM, e não dá pra desfazer.
          </p>
          {/* O mal-entendido mais provável desta tela, dito antes de acontecer: excluir aqui
              não desfaz o envio. A Meta não oferece como apagar uma mensagem já entregue no
              Instagram, então prometer isso seria mentira — melhor ser explícito e dizer
              onde a pessoa consegue resolver de verdade. */}
          <p className="text-amber-300 bg-amber-950/30 border border-amber-800/40 p-3 rounded-xl leading-relaxed">
            O cliente continua vendo a mensagem no {selectedConversation?.channel === 'whatsapp' ? 'WhatsApp' : 'Instagram'} dele.
            Isso apaga só o seu histórico. Pra sumir pro cliente, apague pelo aplicativo do
            {selectedConversation?.channel === 'whatsapp' ? ' WhatsApp' : ' Instagram'} no celular.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeleteMessageId(null)} disabled={deletingMessage}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDeleteMessage} isLoading={deletingMessage}>
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// useSearchParams exige um Suspense boundary acima dele em builds estáticos — em vez de
// envolver a página inteira (que ficaria presa atrás do fallback até isso resolver),
// isolamos a leitura do parâmetro nesse componente minúsculo, que não renderiza nada
// visível. O resto da página (InboxPageInner, com toda a UI de verdade) fica FORA do
// Suspense e sempre monta imediatamente.
function ConversaParamReader({ onParam }: { onParam: (id: string | null) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    onParam(searchParams.get('conversa'))
  }, [searchParams, onParam])
  return null
}

export default function InboxPage() {
  // Vem de links externos (ex: um card da aba Follow-up "Abrir conversa") — assim que a
  // lista real carrega, InboxPageInner seleciona essa conversa automaticamente.
  const [requestedConvId, setRequestedConvId] = useState<string | null>(null)

  return (
    <>
      <Suspense fallback={null}>
        <ConversaParamReader onParam={setRequestedConvId} />
      </Suspense>
      <InboxPageInner requestedConvId={requestedConvId} />
    </>
  )
}

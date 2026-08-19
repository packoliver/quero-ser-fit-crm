/**
 * Recortes da lista de conversas.
 *
 * Todos saem de dado que existe de verdade. A coluna `conversations.status` aceita quatro
 * valores, mas só um deles serve pra filtrar:
 *
 * - `closed`  — confiável. Só vira isso por ação explícita (close_conversation_atomic), e
 *               volta pra `open` sozinha quando o cliente escreve de novo.
 * - `open`    — não é um estado, é a ausência de `closed`.
 * - `assigned`— NÃO serve: persist-event.ts joga o status de volta pra `open` a cada
 *               mensagem recebida, mesmo numa conversa que já tem responsável. Quem
 *               responde "de quem é essa conversa" é `current_assignee_id`, não isto.
 * - `archived`— o schema permite, mas nenhum ponto do código grava. Valor morto.
 *
 * Por isso as abas são: não encerradas (padrão), não lidas, sem responsável, minhas e
 * encerradas — e não uma aba por valor da coluna.
 */

export type ConversationQueueFilter = 'active' | 'unread' | 'unassigned' | 'mine' | 'closed'
export type ConversationChannelFilter = 'all' | 'whatsapp' | 'instagram'

export interface FilterableConversation {
  id: string
  status: string
  currentAssigneeId: string | null
  channel: string
  contactName: string
  contactPhone: string
  lastMessage: string
}

export interface ConversationFilterOptions {
  queue: ConversationQueueFilter
  channel: ConversationChannelFilter
  search: string
  /** Quem está usando o CRM agora — define o que é "Minhas". null enquanto não resolveu. */
  currentUserId: string | null
  /** Quantidade de não lidas desta conversa (ver @/lib/inbox/unread). */
  unreadCount: number
}

function matchesSearch(conv: FilterableConversation, search: string): boolean {
  const termo = search.trim().toLowerCase()
  if (!termo) return true
  return (
    conv.contactName.toLowerCase().includes(termo) ||
    conv.contactPhone.includes(search.trim()) ||
    conv.lastMessage.toLowerCase().includes(termo)
  )
}

export function matchesConversationFilters(
  conv: FilterableConversation,
  { queue, channel, search, currentUserId, unreadCount }: ConversationFilterOptions
): boolean {
  const matchesChannel = channel === 'all' || conv.channel === channel
  if (!matchesChannel) return false
  if (!matchesSearch(conv, search)) return false

  const isClosed = conv.status === 'closed'
  // `currentUserId` nulo não pode fazer conversa sem responsável virar "minha" — sem esta
  // guarda, null === null daria verdadeiro e a aba "Minhas" mostraria a fila inteira
  // enquanto a sessão ainda está carregando.
  const isMine = !!currentUserId && conv.currentAssigneeId === currentUserId
  const isUnassigned = !conv.currentAssigneeId

  // Buscando, a divisão encerrada/ativa é ignorada: procurar um cliente pelo nome e não
  // achar porque a conversa foi encerrada é um beco sem saída. Responsável e canal
  // continuam valendo — quem pediu "minhas" quer as suas mesmo enquanto busca.
  if (search.trim()) {
    if (queue === 'mine') return isMine
    if (queue === 'unassigned') return isUnassigned
    return true
  }

  if (queue === 'closed') return isClosed
  // Encerrada não aparece em nenhuma outra aba. Antes ficava na lista ativa pra sempre:
  // "Encerrar" trocava o rótulo do cartão e mais nada, então a conversa seguia ocupando
  // espaço no meio das que ainda precisam de resposta.
  if (isClosed) return false

  if (queue === 'unread') return unreadCount > 0
  if (queue === 'mine') return isMine
  if (queue === 'unassigned') return isUnassigned
  return true // 'active'
}

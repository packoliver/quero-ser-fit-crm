/**
 * Contagem de mensagens não lidas por conversa.
 *
 * Só mensagem DO CLIENTE conta. O que a própria equipe mandou nunca é "não lido" — seria
 * absurdo o CRM cobrar a vendedora de ler o que ela mesma escreveu.
 *
 * Sem marca de leitura (`lastReadAt` ausente), tudo que o cliente mandou conta como não
 * lido: é o estado de quem nunca abriu aquela conversa, exatamente o caso que o aviso
 * existe pra mostrar.
 */

/** O mínimo que a contagem precisa saber de uma mensagem. */
export interface UnreadMessageInput {
  conversation_id: string
  sender_type: string
  created_at: string
}

export interface ConversationReadInput {
  conversation_id: string
  last_read_at: string
}

/**
 * @returns mapa conversa → quantidade de não lidas. Conversas sem nenhuma não lida ficam
 * FORA do mapa (em vez de entrarem com zero), pra quem consome poder fazer `counts[id] > 0`
 * sem se preocupar com a diferença entre "zero" e "ausente".
 */
export function buildUnreadCounts(
  messages: UnreadMessageInput[],
  reads: ConversationReadInput[]
): Record<string, number> {
  const readAtByConversation = new Map<string, number>()
  for (const read of reads) {
    const parsed = new Date(read.last_read_at).getTime()
    if (!isNaN(parsed)) readAtByConversation.set(read.conversation_id, parsed)
  }

  const counts: Record<string, number> = {}
  for (const message of messages) {
    if (message.sender_type !== 'contact') continue

    const readAt = readAtByConversation.get(message.conversation_id)
    const sentAt = new Date(message.created_at).getTime()
    if (isNaN(sentAt)) continue
    // `>` e não `>=`: last_read_at é gravado como a data da mensagem mais recente já vista
    // (ver markRead), então a própria mensagem que marcou a leitura não pode se contar.
    if (readAt !== undefined && sentAt <= readAt) continue

    counts[message.conversation_id] = (counts[message.conversation_id] || 0) + 1
  }
  return counts
}

export function sumUnread(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, n) => total + n, 0)
}

/**
 * Até quando marcar como visto ao abrir uma conversa: a data da mensagem mais recente dela.
 *
 * Deliberadamente NÃO usa "agora". O relógio do aparelho é do usuário e pode estar errado —
 * um celular adiantado gravaria uma data no futuro e silenciaria pra sempre as próximas
 * mensagens daquela conversa. A data da última mensagem vem do servidor e não depende disso.
 *
 * @returns null quando a conversa não tem mensagem nenhuma — aí não há o que marcar.
 */
export function lastMessageTimestamp(
  messages: UnreadMessageInput[],
  conversationId: string
): string | null {
  let latest: string | null = null
  let latestMs = -Infinity
  for (const message of messages) {
    if (message.conversation_id !== conversationId) continue
    const ms = new Date(message.created_at).getTime()
    if (isNaN(ms) || ms <= latestMs) continue
    latestMs = ms
    latest = message.created_at
  }
  return latest
}

/** Rótulo do aviso. Acima de 99 vira "99+" — o número exato deixa de importar e um valor
 * de 3 dígitos estouraria a bolinha. */
export function formatUnreadBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}

// SLA (tempo de resposta) — usado tanto em Relatórios (métricas agregadas) quanto no
// Inbox (aviso por conversa individual), por isso vive num módulo compartilhado em vez
// de dentro da página de relatórios.

/** Minutos a partir dos quais uma conversa sem resposta é considerada "SLA estourado". */
export const SLA_BREACH_MINUTES = 30

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`
}

/**
 * Calcula, a partir de todas as mensagens da organização (em ordem cronológica):
 * - o tempo médio até a primeira resposta da equipe (só conta conversas já respondidas
 *   ao menos uma vez — uma conversa nova sem resposta ainda não "conta contra a média",
 *   ela entra em slaBreachedCount se demorar demais);
 * - quantas conversas estão com a ÚLTIMA mensagem vinda do cliente há mais de
 *   SLA_BREACH_MINUTES (aguardando resposta agora, além do prazo).
 */
export function computeSlaMetrics(
  messages: Array<{ conversation_id: string; sender_type: 'contact' | 'user' | 'system'; created_at: string }>
): { avgFirstResponseMinutes: number | null; slaBreachedCount: number } {
  const byConversation = new Map<string, typeof messages>()
  for (const msg of messages) {
    const list = byConversation.get(msg.conversation_id)
    if (list) list.push(msg)
    else byConversation.set(msg.conversation_id, [msg])
  }

  let totalMinutes = 0
  let respondedConversations = 0
  let slaBreachedCount = 0
  const now = Date.now()

  for (const list of byConversation.values()) {
    const firstContactMsg = list.find((m) => m.sender_type === 'contact')
    if (!firstContactMsg) continue

    const firstUserMsgAfter = list.find(
      (m) => m.sender_type === 'user' && new Date(m.created_at).getTime() >= new Date(firstContactMsg.created_at).getTime()
    )

    if (firstUserMsgAfter) {
      const minutes = (new Date(firstUserMsgAfter.created_at).getTime() - new Date(firstContactMsg.created_at).getTime()) / 60000
      totalMinutes += minutes
      respondedConversations += 1
    }

    const lastMsg = list[list.length - 1]
    if (lastMsg.sender_type === 'contact') {
      const waitingMinutes = (now - new Date(lastMsg.created_at).getTime()) / 60000
      if (waitingMinutes > SLA_BREACH_MINUTES) slaBreachedCount += 1
    }
  }

  return {
    avgFirstResponseMinutes: respondedConversations > 0 ? Math.round(totalMinutes / respondedConversations) : null,
    slaBreachedCount,
  }
}

/** Minutos desde `isoTimestamp` até agora. */
export function minutesSince(isoTimestamp: string): number {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 60000
}

import { describe, it, expect } from 'vitest'

interface ConversationState {
  id: string
  status: 'open' | 'assigned' | 'closed'
  currentAssigneeId: string | null
  assignmentsHistory: Array<{ from: string | null; to: string }>
}

function assumeConversation(conv: ConversationState, attendantId: string): ConversationState {
  return {
    ...conv,
    status: 'assigned',
    currentAssigneeId: attendantId,
    assignmentsHistory: [
      ...conv.assignmentsHistory,
      { from: conv.currentAssigneeId, to: attendantId },
    ],
  }
}

function transferConversation(
  conv: ConversationState,
  currentAttendantId: string,
  newAttendantId: string
): ConversationState {
  if (conv.currentAssigneeId !== currentAttendantId) {
    throw new Error('Apenas o responsável atual ou um administrador pode transferir a conversa.')
  }

  return {
    ...conv,
    status: 'assigned',
    currentAssigneeId: newAttendantId,
    assignmentsHistory: [
      ...conv.assignmentsHistory,
      { from: currentAttendantId, to: newAttendantId },
    ],
  }
}

describe('Fluxo de Atribuição e Transferência de Atendimento', () => {
  it('deve permitir que um atendente assuma uma conversa aberta', () => {
    const initialConv: ConversationState = {
      id: 'c-1',
      status: 'open',
      currentAssigneeId: null,
      assignmentsHistory: [],
    }

    const updated = assumeConversation(initialConv, 'att-1')

    expect(updated.status).toBe('assigned')
    expect(updated.currentAssigneeId).toBe('att-1')
    expect(updated.assignmentsHistory.length).toBe(1)
  })

  it('deve registrar o histórico correto ao transferir de att-1 para att-2', () => {
    const initialConv: ConversationState = {
      id: 'c-1',
      status: 'assigned',
      currentAssigneeId: 'att-1',
      assignmentsHistory: [{ from: null, to: 'att-1' }],
    }

    const transferred = transferConversation(initialConv, 'att-1', 'att-2')

    expect(transferred.currentAssigneeId).toBe('att-2')
    expect(transferred.assignmentsHistory.length).toBe(2)
    expect(transferred.assignmentsHistory[1]).toEqual({ from: 'att-1', to: 'att-2' })
  })
})

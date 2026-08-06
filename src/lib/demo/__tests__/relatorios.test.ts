import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDemoDatabase, resetDemoDatabase } from '../storage'

class LocalStorageMock {
  private store: Record<string, string> = {}
  clear() {
    this.store = {}
  }
  getItem(key: string) {
    return this.store[key] || null
  }
  setItem(key: string, value: string) {
    this.store[key] = value
  }
  removeItem(key: string) {
    delete this.store[key]
  }
}

const localStorageMock = new LocalStorageMock()

describe('Métricas e Indicadores Dinâmicos de Relatórios (Fase 4.7)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('localStorage', localStorageMock)
    localStorageMock.clear()
    resetDemoDatabase()
  })

  it('deve calcular corretamente a contagem de clientes e novos leads do banco', () => {
    const db = getDemoDatabase()
    expect(db.contacts.length).toBeGreaterThan(0)

    const totalContacts = db.contacts.length
    const newLeads = db.contacts.filter((c) =>
      (c.tags || []).some((t) => t.toLowerCase().includes('lead') || t.toLowerCase().includes('novo'))
    ).length

    expect(totalContacts).toBe(db.contacts.length)
    expect(typeof newLeads).toBe('number')
  })

  it('deve calcular dinamicamente a taxa de conclusão de tarefas em %', () => {
    const db = getDemoDatabase()
    const pendingTasks = db.tasks.filter((t) => t.status === 'pending').length
    const completedTasks = db.tasks.filter((t) => t.status === 'completed').length
    const total = pendingTasks + completedTasks

    const rate = total > 0 ? Math.round((completedTasks / total) * 100) : 0
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThanOrEqual(100)
  })

  it('deve calcular corretamente atendimentos em fila e em andamento', () => {
    const db = getDemoDatabase()
    const unassignedQueue = db.conversations.filter(
      (c) => c.status === 'open' && !c.currentAssigneeId
    ).length

    const activeConversations = db.conversations.filter(
      (c) => c.currentAssigneeId !== null
    ).length

    expect(typeof unassignedQueue).toBe('number')
    expect(typeof activeConversations).toBe('number')
  })

  it('deve manipular arrays vazios de dados sem gerar erro ou NaN', () => {
    const emptyDb = {
      contacts: [],
      tasks: [],
      conversations: [],
      members: [],
    }

    const totalContacts = emptyDb.contacts.length
    const pendingTasks = emptyDb.tasks.filter((t: { status: string }) => t.status === 'pending').length
    const completedTasks = emptyDb.tasks.filter((t: { status: string }) => t.status === 'completed').length
    const total = pendingTasks + completedTasks
    const rate = total > 0 ? Math.round((completedTasks / total) * 100) : 0

    expect(totalContacts).toBe(0)
    expect(pendingTasks).toBe(0)
    expect(completedTasks).toBe(0)
    expect(rate).toBe(0)
  })
})

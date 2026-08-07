import { DealStage } from '@/types/database'
import {
  DemoContact,
  DemoConversation,
  DemoDeal,
  DemoTask,
  DemoTeamMember,
  demoAttendants,
  demoContacts,
  demoConversations,
  demoDeals,
  demoTasks,
} from './index'

export const DEMO_STORAGE_KEY = 'quero-ser-fit-crm:demo:v1'
export const DEMO_STORAGE_VERSION = 1
export const DEMO_STORAGE_EVENT = 'demo-storage-change'

export interface DemoDatabase {
  version: number
  contacts: DemoContact[]
  tasks: DemoTask[]
  deals: DemoDeal[]
  conversations: DemoConversation[]
  members: DemoTeamMember[]
  updatedAt: string
}

export const initialSeedDatabase: DemoDatabase = {
  version: DEMO_STORAGE_VERSION,
  contacts: demoContacts,
  tasks: demoTasks,
  deals: demoDeals,
  conversations: demoConversations,
  members: demoAttendants,
  updatedAt: new Date().toISOString(),
}

/**
 * Returns the current DemoDatabase from localStorage or initializes it with seed defaults.
 */
export function getDemoDatabase(): DemoDatabase {
  if (typeof window === 'undefined') {
    return initialSeedDatabase
  }

  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY)
    if (!raw) {
      saveDemoDatabase(initialSeedDatabase)
      return initialSeedDatabase
    }

    const parsed = JSON.parse(raw) as Partial<DemoDatabase>
    if (!parsed || parsed.version !== DEMO_STORAGE_VERSION || !Array.isArray(parsed.contacts)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DemoStorage] Versão incompatível ou JSON corrompido. Restaurando dados padrão.')
      }
      saveDemoDatabase(initialSeedDatabase)
      return initialSeedDatabase
    }

    // `deals` is newer than the rest of this schema — a localStorage blob saved before
    // this feature shipped won't have the key at all (still version 1, since the shape
    // change didn't bump DEMO_STORAGE_VERSION). Backfill it from the seed data instead of
    // defaulting to an empty array, so returning demo users see the example pipeline too
    // instead of a permanently empty Funil.
    return {
      version: DEMO_STORAGE_VERSION,
      contacts: parsed.contacts || [],
      tasks: parsed.tasks || [],
      deals: parsed.deals || demoDeals,
      conversations: parsed.conversations || [],
      members: parsed.members || [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    }
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[DemoStorage] Erro ao carregar localStorage:', err)
    }
    saveDemoDatabase(initialSeedDatabase)
    return initialSeedDatabase
  }
}

/**
 * Saves DemoDatabase to localStorage and triggers storage change event for UI reactivity.
 */
export function saveDemoDatabase(db: DemoDatabase): void {
  if (typeof window === 'undefined') return

  try {
    const updatedDb: DemoDatabase = {
      ...db,
      version: DEMO_STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(updatedDb))

    window.dispatchEvent(new CustomEvent(DEMO_STORAGE_EVENT, { detail: updatedDb }))
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[DemoStorage] Erro ao salvar no localStorage:', err)
    }
  }
}

/**
 * Resets local demo storage back to seed defaults.
 */
export function resetDemoDatabase(): DemoDatabase {
  saveDemoDatabase(initialSeedDatabase)
  return initialSeedDatabase
}

// ==========================================
// Contact Helpers
// ==========================================

export function getStoredContacts(): DemoContact[] {
  return getDemoDatabase().contacts
}

export function saveStoredContact(contact: Omit<DemoContact, 'id' | 'createdAt' | 'isDemo'>): DemoContact {
  const db = getDemoDatabase()
  const newContact: DemoContact = {
    ...contact,
    id: `c-${Date.now()}`,
    createdAt: new Date().toLocaleDateString('pt-BR'),
    isDemo: true,
  }

  const updatedContacts = [newContact, ...db.contacts]
  saveDemoDatabase({ ...db, contacts: updatedContacts })
  return newContact
}

export function updateStoredContact(
  contactId: string,
  updates: Partial<Omit<DemoContact, 'id' | 'createdAt' | 'isDemo'>>
): DemoContact | null {
  const db = getDemoDatabase()
  let updatedContact: DemoContact | null = null
  let oldName = ''

  const updatedContacts = db.contacts.map((c) => {
    if (c.id === contactId) {
      oldName = c.name
      updatedContact = { ...c, ...updates }
      return updatedContact
    }
    return c
  })

  if (updatedContact) {
    const targetContact = updatedContact as DemoContact
    // Omnichannel Cascade: sync contact name/phone in conversations and tasks
    const updatedConversations = db.conversations.map((conv) => {
      if (conv.contactId === contactId || (oldName && conv.contactName === oldName)) {
        return {
          ...conv,
          contactName: targetContact.name,
          contactPhone: targetContact.phone || conv.contactPhone,
        }
      }
      return conv
    })

    const updatedTasks = db.tasks.map((task) => {
      if (oldName && task.clientName === oldName) {
        return {
          ...task,
          clientName: targetContact.name,
        }
      }
      return task
    })

    saveDemoDatabase({
      ...db,
      contacts: updatedContacts,
      conversations: updatedConversations,
      tasks: updatedTasks,
    })
  }
  return updatedContact
}

export function deleteStoredContact(contactId: string): boolean {
  const db = getDemoDatabase()
  const targetContact = db.contacts.find((c) => c.id === contactId)
  if (!targetContact) return false

  const updatedContacts = db.contacts.filter((c) => c.id !== contactId)

  // Omnichannel Cascade: clean up conversations referencing deleted contact to avoid orphan state
  const updatedConversations = db.conversations.filter(
    (conv) => conv.contactId !== contactId && conv.contactName !== targetContact.name
  )

  saveDemoDatabase({
    ...db,
    contacts: updatedContacts,
    conversations: updatedConversations,
  })
  return true
}

// ==========================================
// Task Helpers
// ==========================================

export function getStoredTasks(): DemoTask[] {
  return getDemoDatabase().tasks
}

export function saveStoredTask(task: Omit<DemoTask, 'id' | 'isDemo'>): DemoTask {
  const db = getDemoDatabase()
  const newTask: DemoTask = {
    ...task,
    id: `t-${Date.now()}`,
    isDemo: true,
  }

  const updatedTasks = [newTask, ...db.tasks]
  saveDemoDatabase({ ...db, tasks: updatedTasks })
  return newTask
}

export function updateStoredTaskStatus(taskId: string, newStatus: DemoTask['status']): DemoTask | null {
  const db = getDemoDatabase()
  let updatedTask: DemoTask | null = null

  const updatedTasks = db.tasks.map((task) => {
    if (task.id === taskId) {
      updatedTask = { ...task, status: newStatus }
      return updatedTask
    }
    return task
  })

  if (updatedTask) {
    saveDemoDatabase({ ...db, tasks: updatedTasks })
  }
  return updatedTask
}

export function updateStoredTask(
  taskId: string,
  updates: Partial<Omit<DemoTask, 'id' | 'isDemo'>>
): DemoTask | null {
  const db = getDemoDatabase()
  let updatedTask: DemoTask | null = null

  const updatedTasks = db.tasks.map((task) => {
    if (task.id === taskId) {
      updatedTask = { ...task, ...updates }
      return updatedTask
    }
    return task
  })

  if (updatedTask) {
    saveDemoDatabase({ ...db, tasks: updatedTasks })
  }
  return updatedTask
}

export function deleteStoredTask(taskId: string): boolean {
  const db = getDemoDatabase()
  const initialLength = db.tasks.length
  const updatedTasks = db.tasks.filter((t) => t.id !== taskId)

  if (updatedTasks.length < initialLength) {
    saveDemoDatabase({ ...db, tasks: updatedTasks })
    return true
  }
  return false
}

// ==========================================
// Deal (Funil) Helpers
// ==========================================

export function getStoredDeals(): DemoDeal[] {
  return getDemoDatabase().deals
}

export function saveStoredDeal(deal: Omit<DemoDeal, 'id' | 'createdAt' | 'isDemo'>): DemoDeal {
  const db = getDemoDatabase()
  const newDeal: DemoDeal = {
    ...deal,
    id: `d-${Date.now()}`,
    createdAt: new Date().toLocaleDateString('pt-BR'),
    isDemo: true,
  }

  const updatedDeals = [newDeal, ...db.deals]
  saveDemoDatabase({ ...db, deals: updatedDeals })
  return newDeal
}

export function updateStoredDealStage(dealId: string, newStage: DealStage): DemoDeal | null {
  const db = getDemoDatabase()
  let updatedDeal: DemoDeal | null = null

  const updatedDeals = db.deals.map((deal) => {
    if (deal.id === dealId) {
      updatedDeal = { ...deal, stage: newStage }
      return updatedDeal
    }
    return deal
  })

  if (updatedDeal) {
    saveDemoDatabase({ ...db, deals: updatedDeals })
  }
  return updatedDeal
}

export function updateStoredDeal(
  dealId: string,
  updates: Partial<Omit<DemoDeal, 'id' | 'createdAt' | 'isDemo'>>
): DemoDeal | null {
  const db = getDemoDatabase()
  let updatedDeal: DemoDeal | null = null

  const updatedDeals = db.deals.map((deal) => {
    if (deal.id === dealId) {
      updatedDeal = { ...deal, ...updates }
      return updatedDeal
    }
    return deal
  })

  if (updatedDeal) {
    saveDemoDatabase({ ...db, deals: updatedDeals })
  }
  return updatedDeal
}

export function deleteStoredDeal(dealId: string): boolean {
  const db = getDemoDatabase()
  const initialLength = db.deals.length
  const updatedDeals = db.deals.filter((d) => d.id !== dealId)

  if (updatedDeals.length < initialLength) {
    saveDemoDatabase({ ...db, deals: updatedDeals })
    return true
  }
  return false
}

// ==========================================
// Conversation & Notes Helpers
// ==========================================

export function getStoredConversations(): DemoConversation[] {
  return getDemoDatabase().conversations
}

export function addMessageToConversation(
  convId: string,
  content: string,
  senderType: 'user' | 'contact' | 'system' = 'user',
  senderName: string = 'Você'
): DemoConversation | null {
  const db = getDemoDatabase()
  let updatedConv: DemoConversation | null = null

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const updatedConversations = db.conversations.map((conv) => {
    if (conv.id === convId) {
      const newMessage = {
        id: `msg-${Date.now()}`,
        senderType,
        senderName,
        content,
        time: nowTime,
      }

      updatedConv = {
        ...conv,
        lastMessage: content,
        lastMessageTime: nowTime,
        messages: [...conv.messages, newMessage],
      }
      return updatedConv
    }
    return conv
  })

  if (updatedConv) {
    saveDemoDatabase({ ...db, conversations: updatedConversations })
  }
  return updatedConv
}

export function addInternalNoteToConversation(
  convId: string,
  text: string,
  author: string = 'Patricia Silva'
): DemoConversation | null {
  const db = getDemoDatabase()
  let updatedConv: DemoConversation | null = null

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const updatedConversations = db.conversations.map((conv) => {
    if (conv.id === convId) {
      const newNote = {
        id: `note-${Date.now()}`,
        author,
        text,
        date: nowTime,
      }

      updatedConv = {
        ...conv,
        notes: [...(conv.notes || []), newNote],
      }
      return updatedConv
    }
    return conv
  })

  if (updatedConv) {
    saveDemoDatabase({ ...db, conversations: updatedConversations })
  }
  return updatedConv
}

export function updateConversationAssignee(
  convId: string,
  assigneeId: string | null,
  assigneeName: string | null
): DemoConversation | null {
  const db = getDemoDatabase()
  let updatedConv: DemoConversation | null = null
  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const updatedConversations = db.conversations.map((conv) => {
    if (conv.id === convId) {
      const systemContent = assigneeId
        ? `Atendimento atribuído para ${assigneeName}.`
        : 'Atendimento liberado (sem responsável).'

      const systemMsg = {
        id: `sys-${Date.now()}`,
        senderType: 'system' as const,
        senderName: 'Sistema',
        content: systemContent,
        time: nowTime,
      }

      updatedConv = {
        ...conv,
        status: assigneeId ? ('assigned' as const) : ('open' as const),
        currentAssigneeId: assigneeId,
        currentAssigneeName: assigneeName,
        messages: [...conv.messages, systemMsg],
      }
      return updatedConv
    }
    return conv
  })

  if (updatedConv) {
    saveDemoDatabase({ ...db, conversations: updatedConversations })
  }
  return updatedConv
}

// ==========================================
// Member Helpers
// ==========================================

export function getStoredMembers(): DemoTeamMember[] {
  return getDemoDatabase().members
}

export function saveStoredMember(member: Omit<DemoTeamMember, 'id' | 'joinedAt' | 'isDemo'>): DemoTeamMember {
  const db = getDemoDatabase()
  const newMember: DemoTeamMember = {
    ...member,
    id: `att-${Date.now()}`,
    joinedAt: new Date().toLocaleDateString('pt-BR'),
    isDemo: true,
  }

  const updatedMembers = [...db.members, newMember]
  saveDemoDatabase({ ...db, members: updatedMembers })
  return newMember
}

export function updateStoredMemberRole(memberId: string, newRole: DemoTeamMember['role']): DemoTeamMember | null {
  const db = getDemoDatabase()
  let updatedMember: DemoTeamMember | null = null

  // Last active admin safeguard
  if (newRole === 'attendant') {
    const adminCount = db.members.filter((m) => m.role === 'admin' && m.status === 'active').length
    const target = db.members.find((m) => m.id === memberId)
    if (target && target.role === 'admin' && adminCount <= 1) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DemoStorage] Operação negada: não é permitido alterar o único admin ativo.')
      }
      return null
    }
  }

  const updatedMembers = db.members.map((m) => {
    if (m.id === memberId) {
      updatedMember = { ...m, role: newRole }
      return updatedMember
    }
    return m
  })

  if (updatedMember) {
    saveDemoDatabase({ ...db, members: updatedMembers })
  }
  return updatedMember
}

export function updateStoredMemberStatus(
  memberId: string,
  newStatus: DemoTeamMember['status']
): DemoTeamMember | null {
  const db = getDemoDatabase()
  let updatedMember: DemoTeamMember | null = null

  // Last active admin safeguard
  if (newStatus !== 'active') {
    const adminCount = db.members.filter((m) => m.role === 'admin' && m.status === 'active').length
    const target = db.members.find((m) => m.id === memberId)
    if (target && target.role === 'admin' && target.status === 'active' && adminCount <= 1) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DemoStorage] Operação negada: não é permitido desativar o único admin ativo.')
      }
      return null
    }
  }

  const updatedMembers = db.members.map((m) => {
    if (m.id === memberId) {
      updatedMember = { ...m, status: newStatus }
      return updatedMember
    }
    return m
  })

  if (updatedMember) {
    saveDemoDatabase({ ...db, members: updatedMembers })
  }
  return updatedMember
}

export function deleteStoredMember(memberId: string): boolean {
  const db = getDemoDatabase()
  const target = db.members.find((m) => m.id === memberId)
  if (!target) return false

  // Last active admin safeguard
  if (target.role === 'admin' && target.status === 'active') {
    const adminCount = db.members.filter((m) => m.role === 'admin' && m.status === 'active').length
    if (adminCount <= 1) {
      return false
    }
  }

  const updatedMembers = db.members.filter((m) => m.id !== memberId)
  if (updatedMembers.length < db.members.length) {
    saveDemoDatabase({ ...db, members: updatedMembers })
    return true
  }
  return false
}

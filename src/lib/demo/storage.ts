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
 * Validates the shape of a parsed DemoDatabase to ensure all required arrays are present.
 * Returns true if valid; logs details on failure.
 */
function validateDemoDatabase(parsed: unknown): parsed is DemoDatabase {
  if (!parsed || typeof parsed !== 'object') {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[DemoStorage] Parsed value is not an object')
    }
    return false
  }

  const db = parsed as Record<string, unknown>
  const required: (keyof DemoDatabase)[] = ['version', 'contacts', 'tasks', 'deals', 'conversations', 'members', 'updatedAt']

  for (const key of required) {
    if (!(key in db)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[DemoStorage] Missing required field: ${String(key)}`)
      }
      return false
    }

    if (key !== 'version' && key !== 'updatedAt') {
      if (!Array.isArray(db[key])) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[DemoStorage] Field ${String(key)} is not an array`)
        }
        return false
      }
    }
  }

  if (db.version !== DEMO_STORAGE_VERSION) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[DemoStorage] Version mismatch: expected ${DEMO_STORAGE_VERSION}, got ${db.version}`)
    }
    return false
  }

  return true
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

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (parseErr) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DemoStorage] JSON parse error:', parseErr)
      }
      saveDemoDatabase(initialSeedDatabase)
      return initialSeedDatabase
    }

    if (!validateDemoDatabase(parsed)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DemoStorage] Schema validation failed. Restoring defaults.')
      }
      saveDemoDatabase(initialSeedDatabase)
      return initialSeedDatabase
    }

    return parsed
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[DemoStorage] Unexpected error loading localStorage:', err)
    }
    saveDemoDatabase(initialSeedDatabase)
    return initialSeedDatabase
  }
}

/**
 * Saves DemoDatabase to localStorage and triggers storage change event for UI reactivity.
 * Returns true on success; false if localStorage write failed (quota exceeded, private mode, etc.)
 */
export function saveDemoDatabase(db: DemoDatabase): boolean {
  if (typeof window === 'undefined') return false

  try {
    const updatedDb: DemoDatabase = {
      ...db,
      version: DEMO_STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(updatedDb))

    window.dispatchEvent(new CustomEvent(DEMO_STORAGE_EVENT, { detail: updatedDb }))
    return true
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[DemoStorage] Failed to write to localStorage:', err)
    }
    return false
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
    id: `c-${crypto.randomUUID().slice(0, 8)}`,
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

  const updatedContacts = db.contacts.map((c) => {
    if (c.id === contactId) {
      updatedContact = { ...c, ...updates }
      return updatedContact
    }
    return c
  })

  if (updatedContact) {
    const targetContact = updatedContact as DemoContact
    // Cascade by ID only — never match by name (names are mutable and non-unique)
    const updatedConversations = db.conversations.map((conv) => {
      if (conv.contactId === contactId) {
        return {
          ...conv,
          contactName: targetContact.name,
          contactPhone: targetContact.phone || conv.contactPhone,
        }
      }
      return conv
    })

    const updatedTasks = db.tasks.map((task) => {
      if (task.contactId === contactId) {
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

  // Cascade by ID only — never match by name
  const updatedConversations = db.conversations.filter(
    (conv) => conv.contactId !== contactId
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
    id: `t-${crypto.randomUUID().slice(0, 8)}`,
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
    id: `d-${crypto.randomUUID().slice(0, 8)}`,
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
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
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
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
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
        id: `sys-${crypto.randomUUID().slice(0, 8)}`,
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

/**
 * Checks if changing a member's admin status would violate the single-active-admin rule.
 * Returns true if the change is safe to proceed; false if it would be disallowed.
 */
function canChangeAdminStatus(
  memberId: string,
  newRole: DemoTeamMember['role'] | null,
  newStatus: DemoTeamMember['status'] | null
): boolean {
  const db = getDemoDatabase()
  const target = db.members.find((m) => m.id === memberId)
  if (!target) return true

  // Only restrict if target is currently an active admin
  if (target.role !== 'admin' || target.status !== 'active') {
    return true
  }

  // Count active admins excluding this member
  const activeAdminCount = db.members.filter(
    (m) => m.id !== memberId && m.role === 'admin' && m.status === 'active'
  ).length

  // If there are other active admins, this one can be changed
  if (activeAdminCount > 0) {
    return true
  }

  // This is the sole active admin. Check if the proposed change would remove that status.
  const wouldRemoveAdminStatus =
    (newRole !== null && newRole !== 'admin') || (newStatus !== null && newStatus !== 'active')

  return !wouldRemoveAdminStatus
}

export function getStoredMembers(): DemoTeamMember[] {
  return getDemoDatabase().members
}

export function saveStoredMember(member: Omit<DemoTeamMember, 'id' | 'joinedAt' | 'isDemo'>): DemoTeamMember {
  const db = getDemoDatabase()
  const newMember: DemoTeamMember = {
    ...member,
    id: `att-${crypto.randomUUID().slice(0, 8)}`,
    joinedAt: new Date().toLocaleDateString('pt-BR'),
    isDemo: true,
  }

  const updatedMembers = [...db.members, newMember]
  saveDemoDatabase({ ...db, members: updatedMembers })
  return newMember
}

export function updateStoredMemberRole(memberId: string, newRole: DemoTeamMember['role']): DemoTeamMember | null {
  if (!canChangeAdminStatus(memberId, newRole, null)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[DemoStorage] Operation denied: cannot demote the sole active admin.')
    }
    return null
  }

  const db = getDemoDatabase()
  let updatedMember: DemoTeamMember | null = null

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
  if (!canChangeAdminStatus(memberId, null, newStatus)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[DemoStorage] Operation denied: cannot deactivate the sole active admin.')
    }
    return null
  }

  const db = getDemoDatabase()
  let updatedMember: DemoTeamMember | null = null

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
  if (!canChangeAdminStatus(memberId, 'attendant', 'inactive')) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[DemoStorage] Operation denied: cannot delete the sole active admin.')
    }
    return false
  }

  const db = getDemoDatabase()
  const target = db.members.find((m) => m.id === memberId)
  if (!target) return false

  const updatedMembers = db.members.filter((m) => m.id !== memberId)
  if (updatedMembers.length < db.members.length) {
    saveDemoDatabase({ ...db, members: updatedMembers })
    return true
  }
  return false
}

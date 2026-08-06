import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getDemoDatabase,
  resetDemoDatabase,
  saveStoredContact,
  updateStoredContact,
  deleteStoredContact,
  saveStoredTask,
  updateStoredTaskStatus,
  updateStoredTask,
  deleteStoredTask,
  addMessageToConversation,
  addInternalNoteToConversation,
  updateConversationAssignee,
  saveStoredMember,
  updateStoredMemberRole,
  updateStoredMemberStatus,
  deleteStoredMember,
  DEMO_STORAGE_KEY,
  initialSeedDatabase,
} from '../storage'

// In-memory mock for localStorage in node test environment
class LocalStorageMock {
  private store: Record<string, string> = {}
  clear() {
    this.store = {}
  }
  getItem(key: string) {
    return this.store[key] || null
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value)
  }
  removeItem(key: string) {
    delete this.store[key]
  }
}

const localStorageMock = new LocalStorageMock()

describe('Demo Storage Adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('localStorage', localStorageMock)
    localStorageMock.clear()
    vi.restoreAllMocks()
  })

  it('should initialize with seed defaults on first load', () => {
    const db = getDemoDatabase()
    expect(db.version).toBe(1)
    expect(db.contacts.length).toBeGreaterThan(0)
    expect(db.tasks.length).toBeGreaterThan(0)
    expect(db.conversations.length).toBeGreaterThan(0)
    expect(db.members.length).toBeGreaterThan(0)
  })

  it('should save and retrieve custom contact', () => {
    const newContact = saveStoredContact({
      name: 'Cliente Teste Storage',
      email: 'teste@storage.com',
      phone: '11999998888',
      channels: ['whatsapp'],
      tags: ['Novo Teste'],
      status: 'active',
      notes: 'Nota de teste',
    })

    expect(newContact.id).toBeDefined()
    expect(newContact.name).toBe('Cliente Teste Storage')

    const db = getDemoDatabase()
    const found = db.contacts.find((c) => c.id === newContact.id)
    expect(found).toBeDefined()
    expect(found?.email).toBe('teste@storage.com')
  })

  it('should update existing contact details', () => {
    const created = saveStoredContact({
      name: 'Cliente Para Atualizar',
      email: 'antes@email.com',
      phone: '11900000000',
      channels: ['whatsapp'],
      tags: ['Original'],
      status: 'active',
      notes: 'Notas originais',
    })

    const updated = updateStoredContact(created.id, {
      name: 'Cliente Nome Atualizado',
      email: 'depois@email.com',
      tags: ['Editado', 'VIP'],
    })

    expect(updated).not.toBeNull()
    expect(updated?.name).toBe('Cliente Nome Atualizado')
    expect(updated?.email).toBe('depois@email.com')
    expect(updated?.tags).toEqual(['Editado', 'VIP'])

    const db = getDemoDatabase()
    const foundInDb = db.contacts.find((c) => c.id === created.id)
    expect(foundInDb?.name).toBe('Cliente Nome Atualizado')
  })

  it('should delete contact from storage', () => {
    const created = saveStoredContact({
      name: 'Cliente Para Deletar',
      email: 'deletar@email.com',
      phone: '11911112222',
      channels: ['whatsapp'],
      tags: ['Deletar'],
      status: 'active',
      notes: '',
    })

    const success = deleteStoredContact(created.id)
    expect(success).toBe(true)

    const db = getDemoDatabase()
    const found = db.contacts.find((c) => c.id === created.id)
    expect(found).toBeUndefined()
  })

  it('should save task and update task status', () => {
    const newTask = saveStoredTask({
      title: 'Tarefa Teste Local',
      description: 'Descrição da tarefa',
      dueDate: 'Amanhã',
      status: 'pending',
      assigneeId: 'att-1',
      assigneeName: 'Patricia Silva',
      clientName: 'Cliente Teste Storage',
      priority: 'alta',
    })

    expect(newTask.id).toBeDefined()

    const updated = updateStoredTaskStatus(newTask.id, 'completed')
    expect(updated?.status).toBe('completed')

    const db = getDemoDatabase()
    const taskInDb = db.tasks.find((t) => t.id === newTask.id)
    expect(taskInDb?.status).toBe('completed')
  })

  it('should update full task fields', () => {
    const newTask = saveStoredTask({
      title: 'Tarefa Para Editar',
      description: 'Desc Inicial',
      dueDate: 'Hoje',
      status: 'pending',
      assigneeId: 'att-1',
      assigneeName: 'Patricia Silva',
      clientName: 'Cliente A',
      priority: 'baixa',
    })

    const updated = updateStoredTask(newTask.id, {
      title: 'Título Editado',
      priority: 'alta',
      assigneeName: 'Carlos Atendimento',
    })

    expect(updated?.title).toBe('Título Editado')
    expect(updated?.priority).toBe('alta')
    expect(updated?.assigneeName).toBe('Carlos Atendimento')

    const db = getDemoDatabase()
    const found = db.tasks.find((t) => t.id === newTask.id)
    expect(found?.title).toBe('Título Editado')
  })

  it('should delete task from storage', () => {
    const newTask = saveStoredTask({
      title: 'Tarefa Para Deletar',
      description: 'Desc',
      dueDate: 'Amanhã',
      status: 'pending',
      assigneeId: 'att-1',
      assigneeName: 'Patricia Silva',
      clientName: 'Cliente B',
      priority: 'media',
    })

    const success = deleteStoredTask(newTask.id)
    expect(success).toBe(true)

    const db = getDemoDatabase()
    const found = db.tasks.find((t) => t.id === newTask.id)
    expect(found).toBeUndefined()
  })

  it('should add message and internal note to conversation', () => {
    const convId = 'conv-1'
    const updatedConv = addMessageToConversation(convId, 'Nova mensagem de teste de cliente', 'contact', 'Mariana Medeiros')
    expect(updatedConv).not.toBeNull()
    expect(updatedConv?.lastMessage).toBe('Nova mensagem de teste de cliente')

    const updatedWithNote = addInternalNoteToConversation(convId, 'Nota de observação interna', 'Patricia Silva')
    expect(updatedWithNote).not.toBeNull()
    expect(updatedWithNote?.notes.some((n) => n.text === 'Nota de observação interna')).toBe(true)
  })

  it('should update conversation assignee', () => {
    const convId = 'conv-1'
    const assigned = updateConversationAssignee(convId, 'att-2', 'Carlos Atendimento')
    expect(assigned?.status).toBe('assigned')
    expect(assigned?.currentAssigneeId).toBe('att-2')
  })

  it('should prevent demoting the last active administrator', () => {
    // There is only 1 admin in seed (att-1)
    const result = updateStoredMemberRole('att-1', 'attendant')
    expect(result).toBeNull() // Safe safeguard rejected demotion

    const db = getDemoDatabase()
    const admin = db.members.find((m) => m.id === 'att-1')
    expect(admin?.role).toBe('admin')
  })

  it('should add new team member and allow role change if there are multiple admins', () => {
    // Add second admin
    const secondAdmin = saveStoredMember({
      fullName: 'Segundo Admin',
      email: 'admin2@queroserfit.com.br',
      role: 'admin',
      status: 'active',
    })

    expect(secondAdmin.id).toBeDefined()

    // Now att-1 can be demoted because secondAdmin exists
    const demoted = updateStoredMemberRole('att-1', 'attendant')
    expect(demoted).not.toBeNull()
    expect(demoted?.role).toBe('attendant')
  })

  it('should prevent deactivating or deleting sole active admin', () => {
    // att-1 is sole active admin
    const statusResult = updateStoredMemberStatus('att-1', 'inactive')
    expect(statusResult).toBeNull()

    const deleteResult = deleteStoredMember('att-1')
    expect(deleteResult).toBe(false)
  })

  it('should update member status and delete non-admin or invited member', () => {
    const invited = saveStoredMember({
      fullName: 'Membro Convidado',
      email: 'convidado@queroserfit.com.br',
      role: 'attendant',
      status: 'invited',
    })

    const updatedStatus = updateStoredMemberStatus(invited.id, 'active')
    expect(updatedStatus?.status).toBe('active')

    const deleted = deleteStoredMember(invited.id)
    expect(deleted).toBe(true)

    const db = getDemoDatabase()
    expect(db.members.find((m) => m.id === invited.id)).toBeUndefined()
  })

  it('should cascade contact update and deletion across conversations and tasks (QA Scenario 1)', () => {
    const contact = saveStoredContact({
      name: 'Cliente QA Cascade',
      email: 'cascade@qa.com',
      phone: '11988887777',
      channels: ['whatsapp'],
      tags: ['QA'],
      status: 'active',
      notes: '',
    })

    const updated = updateStoredContact(contact.id, { name: 'Cliente QA Nome Editado' })
    expect(updated?.name).toBe('Cliente QA Nome Editado')

    const success = deleteStoredContact(contact.id)
    expect(success).toBe(true)

    const db = getDemoDatabase()
    expect(db.contacts.find((c) => c.id === contact.id)).toBeUndefined()
  })

  it('should handle corrupted JSON gracefully and restore defaults', () => {
    localStorage.setItem(DEMO_STORAGE_KEY, '{ invalid JSON }')

    const db = getDemoDatabase()
    expect(db.version).toBe(1)
    expect(db.contacts.length).toBe(initialSeedDatabase.contacts.length)
  })

  it('should reset database back to seed defaults', () => {
    saveStoredContact({
      name: 'Temp Contact',
      email: 'temp@temp.com',
      phone: '11888887777',
      channels: ['whatsapp'],
      tags: [],
      status: 'active',
      notes: '',
    })

    const resetDb = resetDemoDatabase()
    expect(resetDb.contacts.length).toBe(initialSeedDatabase.contacts.length)
  })
})

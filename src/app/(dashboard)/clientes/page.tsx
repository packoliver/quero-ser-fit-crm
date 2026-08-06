'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  UserPlus,
  Phone,
  Tag,
  Calendar,
  Mail,
  ChevronRight,
  Sparkles,
  Database,
  AlertCircle,
  RefreshCw,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react'
import { DemoContact } from '@/lib/demo'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/client'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'

export interface RealContact {
  id: string
  name: string
  email: string | null
  phone: string | null
  normalized_phone?: string | null
  tags: string[]
  notes: string | null
  created_at: string
}

export default function ClientesPage() {
  const {
    contacts: storedDemoContacts,
    addContact: saveDemoContact,
    updateContact: updateDemoContact,
    deleteContact: deleteDemoContact,
  } = useDemoStorage()

  const [viewMode, setViewMode] = useState<'demo' | 'real'>('real')
  const [realContacts, setRealContacts] = useState<RealContact[]>([])
  const [search, setSearch] = useState('')
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null)
  const [selectedContact, setSelectedContact] = useState<RealContact | DemoContact | null>(null)

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  // Feedback & Loading State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Form States
  const [newContact, setNewContact] = useState({ name: '', phone: '', email: '', notes: '', tags: 'Novo Cliente' })
  const [editContact, setEditContact] = useState({ id: '', name: '', phone: '', email: '', notes: '', tags: '' })

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  // Function to normalize phone digits
  const normalizePhoneString = (phone: string) => phone.replace(/\D/g, '')

  const fetchRealContacts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: RealContact[] | null; error: { message: string } | null }>
          }
        }
      })
        .from('contacts')
        .select('id, name, email, phone, tags, notes, created_at')
        .order('created_at', { ascending: false })

      if (dbError) {
        setViewMode('demo')
        setSelectedContact(storedDemoContacts[0] || null)
      } else if (data && data.length > 0) {
        setRealContacts(data)
        setSelectedContact(data[0])
      } else {
        setRealContacts([])
        setSelectedContact(null)
      }
    } catch {
      setViewMode('demo')
      setSelectedContact(storedDemoContacts[0] || null)
    } finally {
      setLoading(false)
    }
  }, [storedDemoContacts])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchRealContacts()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchRealContacts])

  // Reset tag filter when creating or editing to guarantee the contact stays visible!
  const resetFiltersForNewItem = () => {
    setSelectedTagFilter(null)
    setSearch('')
  }

  // Handle Add Contact
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!newContact.name.trim()) {
      setError('O nome do cliente é obrigatório.')
      return
    }

    const cleanPhone = normalizePhoneString(newContact.phone)

    if (viewMode === 'real') {
      try {
        const supabase = createClient()

        if (cleanPhone) {
          const { data: existing } = await (supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (col: string, val: string) => Promise<{ data: RealContact[] | null }>
              }
            }
          })
            .from('contacts')
            .select('id, name, phone')
            .eq('phone', cleanPhone)

          if (existing && existing.length > 0) {
            setError(`Já existe um cliente cadastrado nesta organização com o telefone (${newContact.phone}).`)
            return
          }
        }

        const tagsArray = newContact.tags.split(',').map((t) => t.trim()).filter(Boolean)

        const { data: created, error: insertError } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (data: unknown) => {
              select: () => {
                single: () => Promise<{ data: RealContact | null; error: { code?: string; message: string } | null }>
              }
            }
          }
        })
          .from('contacts')
          .insert({
            name: newContact.name,
            phone: cleanPhone || newContact.phone,
            email: newContact.email || null,
            notes: newContact.notes || null,
            tags: tagsArray,
          })
          .select()
          .single()

        if (insertError) {
          if (insertError.code === '23505' || insertError.message.includes('idx_contacts_org_normalized_phone')) {
            setError('Já existe um cliente cadastrado com este telefone nesta empresa.')
          } else {
            setError('Não foi possível salvar o cliente no Supabase. Verifique se as permissões foram concedidas.')
          }
          return
        }

        if (created) {
          setRealContacts([created, ...realContacts])
          setSelectedContact(created)
          showToast('Cliente cadastrado no Supabase!')
        }
      } catch {
        setError('Ocorreu um erro ao salvar o cliente.')
        return
      }
    } else {
      // Modo Demo Storage Adapter
      const item = saveDemoContact({
        name: newContact.name,
        phone: newContact.phone || '+55 11 90000-0000',
        email: newContact.email || 'cliente@email.com',
        channels: ['whatsapp'],
        tags: newContact.tags.split(',').map((t) => t.trim()).filter(Boolean),
        status: 'active',
        notes: newContact.notes || 'Cliente cadastrado no modo de demonstração.',
      })
      setSelectedContact(item)
      showToast('Cliente cadastrado com sucesso!')
    }

    resetFiltersForNewItem()
    setNewContact({ name: '', phone: '', email: '', notes: '', tags: 'Novo Cliente' })
    setCreateModalOpen(false)
  }

  // Open Edit Modal
  const openEditModal = (contact: RealContact | DemoContact) => {
    const tagString = Array.isArray(contact.tags) ? contact.tags.join(', ') : ''
    setEditContact({
      id: contact.id,
      name: contact.name,
      phone: contact.phone || '',
      email: contact.email || '',
      notes: contact.notes || '',
      tags: tagString,
    })
    setError(null)
    setEditModalOpen(true)
  }

  // Handle Edit Contact
  const handleEditContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!editContact.name.trim()) {
      setError('O nome do cliente é obrigatório.')
      return
    }

    const tagsArray = editContact.tags.split(',').map((t) => t.trim()).filter(Boolean)

    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { error: updateError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (d: unknown) => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
            }
          }
        })
          .from('contacts')
          .update({
            name: editContact.name,
            phone: editContact.phone || null,
            email: editContact.email || null,
            notes: editContact.notes || null,
            tags: tagsArray,
          })
          .eq('id', editContact.id)

        if (updateError) {
          setError('Não foi possível atualizar o cliente no Supabase.')
          return
        }

        setRealContacts((prev) =>
          prev.map((c) =>
            c.id === editContact.id
              ? {
                  ...c,
                  name: editContact.name,
                  phone: editContact.phone,
                  email: editContact.email,
                  notes: editContact.notes,
                  tags: tagsArray,
                }
              : c
          )
        )
        if (selectedContact && selectedContact.id === editContact.id) {
          setSelectedContact({
            ...selectedContact,
            name: editContact.name,
            phone: editContact.phone,
            email: editContact.email,
            notes: editContact.notes,
            tags: tagsArray,
          })
        }
        showToast('Dados do cliente atualizados no Supabase!')
      } catch {
        setError('Erro ao atualizar cliente.')
        return
      }
    } else {
      // Modo Demo Storage Adapter
      const updated = updateDemoContact(editContact.id, {
        name: editContact.name,
        phone: editContact.phone || '+55 11 90000-0000',
        email: editContact.email || 'cliente@email.com',
        notes: editContact.notes,
        tags: tagsArray,
      })

      if (updated && selectedContact && selectedContact.id === editContact.id) {
        setSelectedContact(updated)
      }
      showToast('Cliente atualizado com sucesso!')
    }

    resetFiltersForNewItem()
    setEditModalOpen(false)
  }

  // Handle Delete Contact
  const handleDeleteContact = async () => {
    if (!selectedContact) return
    setError(null)

    if (viewMode === 'real') {
      try {
        const supabase = createClient()
        const { error: deleteError } = await (supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
            }
          }
        })
          .from('contacts')
          .delete()
          .eq('id', selectedContact.id)

        if (deleteError) {
          setError('Não foi possível excluir o cliente no Supabase.')
          setDeleteModalOpen(false)
          return
        }

        const remaining = realContacts.filter((c) => c.id !== selectedContact.id)
        setRealContacts(remaining)
        setSelectedContact(remaining[0] || null)
        showToast('Cliente excluído do Supabase.')
      } catch {
        setError('Erro ao excluir cliente.')
      }
    } else {
      // Modo Demo Storage Adapter
      const deletedId = selectedContact.id
      deleteDemoContact(deletedId)
      const remaining = storedDemoContacts.filter((c) => c.id !== deletedId)
      setSelectedContact(remaining[0] || null)
      showToast('Cliente removido com sucesso!')
    }

    setDeleteModalOpen(false)
  }

  const activeContactsList = viewMode === 'real' ? realContacts : storedDemoContacts

  // Available unique tags for filtering
  const allUniqueTags = Array.from(
    new Set(activeContactsList.flatMap((c) => c.tags || []))
  )

  const filteredContacts = activeContactsList.filter((c) => {
    const nameMatch = c.name.toLowerCase().includes(search.toLowerCase())
    const phoneMatch = (c.phone || '').includes(search)
    const emailMatch = (c.email || '').toLowerCase().includes(search.toLowerCase())
    const matchesSearch = nameMatch || phoneMatch || emailMatch

    const matchesTag = selectedTagFilter ? (c.tags || []).includes(selectedTagFilter) : true

    return matchesSearch && matchesTag
  })

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-bounce border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-100">Gestão de Clientes</h1>
            {viewMode === 'real' ? (
              <Badge variant="emerald" icon={<Database className="w-3 h-3" />}>
                Supabase Real
              </Badge>
            ) : (
              <Badge variant="amber" icon={<Sparkles className="w-3 h-3" />}>
                Modo Demonstração
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Cadastre, edite, organize e acompanhe sua base de clientes Quero Ser Fit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex text-xs">
              <button
                onClick={() => {
                  setViewMode('real')
                  void fetchRealContacts()
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  viewMode === 'real' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dados Reais (Supabase)
              </button>
              <button
                onClick={() => {
                  setViewMode('demo')
                  setSelectedContact(storedDemoContacts[0] || null)
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  viewMode === 'demo' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Modo Demo
              </button>
            </div>
          )}

          {viewMode === 'real' && (
            <Button variant="secondary" onClick={fetchRealContacts}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}

          <Button variant="primary" onClick={() => { setError(null); setCreateModalOpen(true) }}>
            <UserPlus className="w-4 h-4" />
            <span>Novo Cliente</span>
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Search & Tag Filter Bar */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar clientes por nome, telefone ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Tag Filters */}
        {allUniqueTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-slate-400 font-medium text-[11px] mr-1 flex items-center gap-1">
              <Tag className="w-3 h-3 text-emerald-400" /> Filtrar Tag:
            </span>
            <button
              onClick={() => setSelectedTagFilter(null)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                selectedTagFilter === null
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Todas ({activeContactsList.length})
            </button>
            {allUniqueTags.map((tag) => {
              const count = activeContactsList.filter((c) => (c.tags || []).includes(tag)).length
              const isActive = selectedTagFilter === tag
              return (
                <button
                  key={tag}
                  onClick={() => setSelectedTagFilter(isActive ? null : tag)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 ${
                    isActive
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span>{tag}</span>
                  <span className="text-[10px] opacity-75">({count})</span>
                </button>
              )
            })}
            {selectedTagFilter && (
              <button
                onClick={() => setSelectedTagFilter(null)}
                className="text-[11px] text-rose-400 hover:underline ml-2 flex items-center gap-0.5"
              >
                <X className="w-3 h-3" /> Limpar Filtro
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Grid: Contact List + Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Contact List */}
        <div className="lg:col-span-2 space-y-3">
          {filteredContacts.length === 0 ? (
            <EmptyState
              icon={<Search className="w-6 h-6" />}
              title="Nenhum cliente encontrado"
              description="Tente ajustar sua pesquisa de texto ou limpar os filtros de tag ativos."
            />
          ) : (
            <div className="space-y-2">
              {filteredContacts.map((contact) => {
                const isSelected = selectedContact?.id === contact.id
                return (
                  <div
                    key={contact.id}
                    onClick={() => setSelectedContact(contact)}
                    className={`p-4 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-4 ${
                      isSelected
                        ? 'bg-slate-800/80 border-emerald-500/60 shadow-lg'
                        : 'bg-[#0f172a] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Avatar name={contact.name} size="md" />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-slate-100 text-sm truncate">{contact.name}</h3>
                        </div>
                        <div className="flex items-center gap-4 text-slate-400 text-xs">
                          <span className="truncate">{contact.phone || 'Sem telefone'}</span>
                          <span className="truncate hidden sm:inline">{contact.email || 'Sem e-mail'}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {(contact.tags || []).map((t, i) => (
                            <Badge key={i} variant="emerald">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Col: Selected Contact Details Panel with Edit/Delete Actions */}
        {selectedContact ? (
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5 text-xs h-fit sticky top-20">
            <div className="flex items-start justify-between gap-2 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <Avatar name={selectedContact.name} size="lg" />
                <div>
                  <h2 className="text-sm font-bold text-slate-100">{selectedContact.name}</h2>
                  <Badge variant={viewMode === 'real' ? 'emerald' : 'amber'}>
                    {viewMode === 'real' ? 'Cliente no Supabase' : 'Modo Demonstração'}
                  </Badge>
                </div>
              </div>

              {/* Action Buttons: Edit & Delete */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => openEditModal(selectedContact)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-emerald-400 transition"
                  title="Editar cliente"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(true)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                  title="Excluir cliente"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-slate-300">
                <Phone className="w-4 h-4 text-emerald-400" />
                <span>{selectedContact.phone || 'Não informado'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Mail className="w-4 h-4 text-emerald-400" />
                <span>{selectedContact.email || 'Não informado'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Calendar className="w-4 h-4 text-slate-500" />
                <span>
                  Cadastrado em:{' '}
                  {'created_at' in selectedContact
                    ? new Date(selectedContact.created_at).toLocaleDateString('pt-BR')
                    : selectedContact.createdAt}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {(selectedContact.tags || []).map((t, idx) => (
                  <Badge key={idx} variant="slate" icon={<Tag className="w-3 h-3 text-emerald-400" />}>
                    {t}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-slate-400 uppercase font-semibold text-[10px] tracking-wider mb-2">Observações</h3>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-slate-300 leading-relaxed">
                {selectedContact.notes || 'Sem observações cadastradas.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 shadow-xl text-center text-slate-400 text-xs">
            Selecione um cliente para visualizar seus detalhes e ações de edição.
          </div>
        )}
      </div>

      {/* Modal Add Contact */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={viewMode === 'real' ? 'Novo Cliente (Salvar no Supabase)' : 'Novo Cliente (Modo Demo)'}
        icon={<UserPlus className="w-5 h-5" />}
      >
        <form onSubmit={handleAddContact} className="space-y-3 text-xs">
          <Input
            label="Nome Completo *"
            required
            placeholder="Ex: Mariana Medeiros"
            value={newContact.name}
            onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
          />

          <Input
            label="Telefone / WhatsApp"
            placeholder="+55 11 98877-6655"
            value={newContact.phone}
            onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
          />

          <Input
            label="E-mail"
            type="email"
            placeholder="cliente@email.com"
            value={newContact.email}
            onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
          />

          <Input
            label="Tags (separadas por vírgula)"
            placeholder="Marmita Fit, Zona Sul"
            value={newContact.tags}
            onChange={(e) => setNewContact({ ...newContact, tags: e.target.value })}
          />

          <div>
            <label className="block text-slate-300 font-medium mb-1">Observações Iniciais</label>
            <textarea
              rows={2}
              placeholder="Preferências ou dados adicionais..."
              value={newContact.notes}
              onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setCreateModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Salvar Cliente
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Edit Contact */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Editar Dados do Cliente"
        icon={<Pencil className="w-5 h-5" />}
      >
        <form onSubmit={handleEditContact} className="space-y-3 text-xs">
          <Input
            label="Nome Completo *"
            required
            placeholder="Nome do cliente"
            value={editContact.name}
            onChange={(e) => setEditContact({ ...editContact, name: e.target.value })}
          />

          <Input
            label="Telefone / WhatsApp"
            placeholder="+55 11 98877-6655"
            value={editContact.phone}
            onChange={(e) => setEditContact({ ...editContact, phone: e.target.value })}
          />

          <Input
            label="E-mail"
            type="email"
            placeholder="cliente@email.com"
            value={editContact.email}
            onChange={(e) => setEditContact({ ...editContact, email: e.target.value })}
          />

          <Input
            label="Tags (separadas por vírgula)"
            placeholder="Marmita Fit, VIP"
            value={editContact.tags}
            onChange={(e) => setEditContact({ ...editContact, tags: e.target.value })}
          />

          <div>
            <label className="block text-slate-300 font-medium mb-1">Observações</label>
            <textarea
              rows={3}
              placeholder="Histórico ou dados adicionais..."
              value={editContact.notes}
              onChange={(e) => setEditContact({ ...editContact, notes: e.target.value })}
              className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setEditModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Atualizar Cliente
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Delete Confirmation */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirmar Exclusão de Cliente"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300 leading-relaxed">
            Tem certeza que deseja excluir o cliente{' '}
            <strong className="text-slate-100">{selectedContact?.name}</strong>?
          </p>
          <p className="text-rose-400 bg-rose-950/40 border border-rose-800/40 p-3 rounded-xl">
            Atenção: Esta ação removerá o cadastro do cliente e suas preferências salvas.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setDeleteModalOpen(false)}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleDeleteContact}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition"
            >
              Sim, Excluir Cliente
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

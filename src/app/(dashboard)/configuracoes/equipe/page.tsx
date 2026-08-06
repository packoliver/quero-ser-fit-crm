'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  UserCheck,
  ShieldCheck,
  UserPlus,
  Shield,
  CheckCircle2,
  Sparkles,
  Database,
  AlertCircle,
  RefreshCw,
  Trash2,
  UserX,
  AlertTriangle,
  Lock,
  SlidersHorizontal,
  MessageSquare,
  Users,
  CheckSquare,
  BarChart3,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { UserRole, CustomPermissions } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { DemoTeamMember } from '@/lib/demo'
import { getDefaultPermissionsForRole } from '@/lib/security/permissions'

export interface RealMember {
  user_id: string
  organization_id: string
  role: UserRole
  permissions?: CustomPermissions | null
  created_at: string
  profiles?: {
    full_name: string | null
    email: string | null
  }
}

export default function EquipeConfigPage() {
  const {
    members: storedDemoMembers,
    addMember: saveDemoMember,
    updateMemberRole: updateDemoMemberRole,
    updateMemberStatus: updateDemoMemberStatus,
    deleteMember: deleteDemoMember,
  } = useDemoStorage()

  const [viewMode, setViewMode] = useState<'demo' | 'real'>('real')
  const [realMembers, setRealMembers] = useState<RealMember[]>([])

  // Modals state
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [permissionsModalOpen, setPermissionsModalOpen] = useState(false)
  const [deletingMember, setDeletingMember] = useState<DemoTeamMember | null>(null)
  const [selectedMemberForPerms, setSelectedMemberForPerms] = useState<RealMember | DemoTeamMember | null>(null)
  const [editingPermissions, setEditingPermissions] = useState<CustomPermissions>({})

  // Feedback State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [newMember, setNewMember] = useState({ fullName: '', email: '', role: 'attendant' as UserRole, password: '' })
  const [creatingMember, setCreatingMember] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  // Generates a readable-but-random temporary password (e.g. "Fit-83Kq47")
  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    let random = ''
    for (let i = 0; i < 8; i++) {
      random += chars[Math.floor(Math.random() * chars.length)]
    }
    setNewMember((prev) => ({ ...prev, password: `Fit-${random}` }))
  }

  const fetchRealMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: dbError } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opt: { ascending: boolean }) => Promise<{ data: RealMember[] | null; error: { message: string } | null }>
          }
        }
      })
        .from('organization_members')
        .select('user_id, organization_id, role, permissions, created_at, profiles(full_name, email)')
        .order('created_at', { ascending: false })

      if (dbError) {
        setViewMode('demo')
      } else if (data && data.length > 0) {
        setRealMembers(data)
      } else {
        setViewMode('demo')
      }
    } catch {
      setViewMode('demo')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchRealMembers()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchRealMembers])

  // Count active admins in Demo mode for visual safeguard
  const activeAdminCount = storedDemoMembers.filter((m) => m.role === 'admin' && m.status === 'active').length

  // Cycle Role: attendant -> manager -> admin -> attendant
  const getNextRole = (currentRole: UserRole): UserRole => {
    if (currentRole === 'attendant') return 'manager'
    if (currentRole === 'manager') return 'admin'
    return 'attendant'
  }

  // Toggle Role Demo
  const toggleRoleDemo = (member: DemoTeamMember) => {
    setError(null)

    if (member.role === 'admin' && member.status === 'active' && activeAdminCount <= 1) {
      setError('Operação negada: Não é possível alterar ou remover o único administrador ativo do sistema.')
      return
    }

    const nextRole = getNextRole(member.role)
    const updated = updateDemoMemberRole(member.id, nextRole)

    if (!updated) {
      setError('Operação negada: Não é possível alterar ou remover o único administrador ativo do sistema.')
      return
    }

    const roleName = nextRole === 'admin' ? 'Administrador' : nextRole === 'manager' ? 'Gerente' : 'Atendente'
    showToast(`Perfil de ${updated.fullName} alterado para ${roleName}.`)
  }

  // Toggle Status Demo
  const toggleStatusDemo = (member: DemoTeamMember) => {
    setError(null)

    if (member.role === 'admin' && member.status === 'active' && activeAdminCount <= 1) {
      setError('Operação negada: Não é possível desativar o único administrador ativo do sistema.')
      return
    }

    const nextStatus = member.status === 'active' ? 'inactive' : 'active'
    const updated = updateDemoMemberStatus(member.id, nextStatus)

    if (!updated) {
      setError('Operação negada: Não é possível desativar o único administrador ativo do sistema.')
      return
    }

    showToast(`Status de ${updated.fullName} alterado para ${updated.status === 'active' ? 'Ativo' : 'Inativo'}.`)
  }

  // Delete Member Demo
  const handleDeleteMemberConfirm = () => {
    if (!deletingMember) return
    setError(null)

    if (deletingMember.role === 'admin' && deletingMember.status === 'active' && activeAdminCount <= 1) {
      setError('Operação negada: Não é possível excluir o único administrador ativo do sistema.')
      setDeleteModalOpen(false)
      return
    }

    const success = deleteDemoMember(deletingMember.id)
    if (success) {
      showToast(`Membro ${deletingMember.fullName} removido da equipe.`)
    } else {
      setError('Falha ao remover o membro da equipe.')
    }

    setDeleteModalOpen(false)
  }

  // Handle Role Toggle in Real Mode
  const toggleRoleReal = async (member: RealMember) => {
    setError(null)
    const nextRole = getNextRole(member.role)

    try {
      const supabase = createClient()
      const { error: rpcError } = await (supabase as unknown as {
        rpc: (fn: string, p: { p_org_id: string; p_target_user_id: string; p_new_role: string }) => Promise<{ error: { message: string } | null }>
      }).rpc('update_member_role_safe', {
        p_org_id: member.organization_id,
        p_target_user_id: member.user_id,
        p_new_role: nextRole,
      })

      if (rpcError) {
        if (rpcError.message.includes('ÚLTIMO ADMINISTRADOR')) {
          setError('Operação negada: Não é permitido desativar ou rebaixar o último administrador ativo da organização.')
        } else {
          setError(rpcError.message || 'Falha ao alterar perfil do usuário.')
        }
        return
      }

      const roleName = nextRole === 'admin' ? 'Administrador' : nextRole === 'manager' ? 'Gerente' : 'Atendente'
      showToast(`Perfil de ${member.profiles?.full_name || 'usuário'} alterado para ${roleName}.`)
      fetchRealMembers()
    } catch {
      setError('Erro ao executar alteração no Supabase.')
    }
  }

  // Open Permissions Modal
  const openPermissionsModal = (member: RealMember | DemoTeamMember) => {
    setSelectedMemberForPerms(member)
    const role = member.role
    const currentPerms = ('permissions' in member && member.permissions) 
      ? (member.permissions as CustomPermissions)
      : getDefaultPermissionsForRole(role)
    setEditingPermissions({ ...getDefaultPermissionsForRole(role), ...currentPerms })
    setPermissionsModalOpen(true)
  }

  // Save Permissions
  const handleSavePermissions = async () => {
    if (!selectedMemberForPerms) return
    setError(null)

    if (viewMode === 'real' && 'user_id' in selectedMemberForPerms) {
      try {
        const supabase = createClient()
        const { error: dbError } = await (supabase as unknown as {
          from: (t: string) => {
            update: (vals: { permissions: CustomPermissions }) => {
              eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
            }
          }
        })
          .from('organization_members')
          .update({ permissions: editingPermissions })
          .eq('user_id', selectedMemberForPerms.user_id)

        if (dbError) {
          setError('Falha ao salvar permissões granulares no Supabase.')
          return
        }
        showToast('Permissões granulares salvas no Supabase com sucesso!')
        fetchRealMembers()
      } catch {
        setError('Erro ao salvar permissões.')
      }
    } else {
      showToast('Permissões personalizadas atualizadas!')
    }

    setPermissionsModalOpen(false)
  }

  // Toggle Single Permission Switch
  const togglePermission = (key: keyof CustomPermissions) => {
    setEditingPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  // Handle Create Member Form Submit — registers the member directly with a temporary
  // password set by the admin, instead of sending an e-mail invite.
  const handleCreateMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!newMember.fullName || !newMember.email || !newMember.password) return

    if (viewMode === 'real') {
      setCreatingMember(true)
      try {
        const response = await fetch('/api/team/create-member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: newMember.fullName,
            email: newMember.email,
            role: newMember.role,
            password: newMember.password,
          }),
        })

        const result = await response.json()

        if (!response.ok) {
          setError(result.error || 'Falha ao cadastrar o membro.')
          setCreatingMember(false)
          return
        }

        showToast(`Membro ${newMember.fullName} cadastrado! Compartilhe a senha temporária com ele(a) de forma segura.`)
        fetchRealMembers()
      } catch {
        setError('Erro de conexão ao cadastrar o membro.')
        setCreatingMember(false)
        return
      }
      setCreatingMember(false)
    } else {
      const invitedObj: DemoTeamMember = {
        id: `member-${Date.now()}`,
        fullName: newMember.fullName,
        email: newMember.email,
        role: newMember.role,
        status: 'active',
        joinedAt: new Date().toLocaleDateString('pt-BR'),
        isDemo: true,
      }
      saveDemoMember(invitedObj)
      showToast(`Membro ${newMember.fullName} cadastrado com senha temporária (modo demo)!`)
    }

    setNewMember({ fullName: '', email: '', role: 'attendant', password: '' })
    setInviteModalOpen(false)
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto relative">
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-bounce border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          <span>{toast}</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-100">Gestão da Equipe & Permissões</h1>
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
            Gerencie Administradores, Gerentes e Atendentes com permissões granulares personalizadas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex text-xs">
              <button
                onClick={() => {
                  setViewMode('real')
                  void fetchRealMembers()
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  viewMode === 'real' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Dados Reais
              </button>
              <button
                onClick={() => setViewMode('demo')}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${
                  viewMode === 'demo' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Modo Demo
              </button>
            </div>
          )}

          <Button onClick={() => setInviteModalOpen(true)} variant="primary">
            <UserPlus className="w-4 h-4" />
            <span>Cadastrar Membro</span>
          </Button>
        </div>
      </div>

      {/* Hierarchical Roles Overview */}
      <Card className="p-4 text-xs space-y-2">
        <h2 className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span>Matriz de Cargos & Níveis de Acesso</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="p-3 bg-slate-950/60 rounded-xl border border-emerald-900/40">
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-bold text-emerald-400 uppercase tracking-wider text-[10px]">Administrador</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Acesso total às configurações, faturamento, integrações Meta e proteção contra remoção se for único.
            </p>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-900/40">
            <div className="flex items-center gap-1.5 mb-1">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-bold text-indigo-400 uppercase tracking-wider text-[10px]">Gerente (Manager)</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Supervisão gerencial da equipe, relatórios avançados, transferência de conversas e gestão de atendentes.
            </p>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-xl border border-teal-900/40">
            <div className="flex items-center gap-1.5 mb-1">
              <UserCheck className="w-3.5 h-3.5 text-teal-400" />
              <span className="font-bold text-teal-400 uppercase tracking-wider text-[10px]">Atendente</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Acesso operacional ajustável via switches de permissões personalizadas pelo Admin/Gerente.
            </p>
          </div>
        </div>
      </Card>

      {/* Members Table */}
      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Membros da Organização ({viewMode === 'real' ? 'Dados Supabase' : 'Modo Demo'})
          </h2>
          {viewMode === 'real' && (
            <Button variant="secondary" size="sm" onClick={fetchRealMembers}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </CardHeader>

        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/60">
                  <th className="py-3 px-4">Usuário</th>
                  <th className="py-3 px-4">E-mail</th>
                  <th className="py-3 px-4">Cargo / Perfil</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações & Permissões</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {viewMode === 'real'
                  ? realMembers.map((member) => (
                      <tr key={member.user_id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3.5 px-4 font-semibold text-slate-100">
                          {member.profiles?.full_name || 'Usuário Sem Nome'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400">{member.profiles?.email || 'N/A'}</td>
                        <td className="py-3.5 px-4">
                          {member.role === 'admin' ? (
                            <Badge variant="emerald" icon={<ShieldCheck className="w-3 h-3" />}>
                              Administrador
                            </Badge>
                          ) : member.role === 'manager' ? (
                            <Badge variant="indigo" icon={<Shield className="w-3 h-3" />}>
                              Gerente
                            </Badge>
                          ) : (
                            <Badge variant="teal" icon={<UserCheck className="w-3 h-3" />}>
                              Atendente
                            </Badge>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-emerald-400 font-medium">Ativo</td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button variant="secondary" size="sm" onClick={() => toggleRoleReal(member)}>
                              Alternar Cargo
                            </Button>

                            <button
                              type="button"
                              onClick={() => openPermissionsModal(member)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 transition"
                              title="Personalizar permissões granulares"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Permissões</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  : storedDemoMembers.map((member) => {
                      const isSoleAdmin = member.role === 'admin' && member.status === 'active' && activeAdminCount <= 1

                      return (
                        <tr key={member.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3.5 px-4 font-semibold text-slate-100">{member.fullName}</td>
                          <td className="py-3.5 px-4 text-slate-400">{member.email}</td>
                          <td className="py-3.5 px-4">
                            {member.role === 'admin' ? (
                              <Badge variant="emerald" icon={<ShieldCheck className="w-3 h-3" />}>
                                Administrador
                              </Badge>
                            ) : member.role === 'manager' ? (
                              <Badge variant="indigo" icon={<Shield className="w-3 h-3" />}>
                                Gerente
                              </Badge>
                            ) : (
                              <Badge variant="teal" icon={<UserCheck className="w-3 h-3" />}>
                                Atendente
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {member.status === 'active' ? (
                              <span className="text-emerald-400 font-medium">Ativo</span>
                            ) : member.status === 'invited' ? (
                              <span className="text-amber-400 font-medium">Convite Pendente</span>
                            ) : (
                              <span className="text-rose-400 font-medium">Inativo</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isSoleAdmin ? (
                                <span
                                  title="Não é possível alterar ou remover o único administrador ativo do sistema."
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 text-[11px] cursor-not-allowed"
                                >
                                  <Lock className="w-3 h-3 text-amber-500" />
                                  <span>Único Admin (Protegido)</span>
                                </span>
                              ) : (
                                <>
                                  <Button variant="secondary" size="sm" onClick={() => toggleRoleDemo(member)}>
                                    Alternar Cargo
                                  </Button>

                                  <button
                                    type="button"
                                    onClick={() => openPermissionsModal(member)}
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 transition"
                                    title="Personalizar permissões granulares"
                                  >
                                    <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Permissões</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => toggleStatusDemo(member)}
                                    className={`p-1.5 rounded-lg border text-xs transition ${
                                      member.status === 'active'
                                        ? 'bg-slate-900 border-slate-700 text-amber-400 hover:bg-slate-800'
                                        : 'bg-emerald-950/60 border-emerald-800 text-emerald-400 hover:bg-emerald-900/60'
                                    }`}
                                    title={member.status === 'active' ? 'Desativar membro' : 'Ativar membro'}
                                  >
                                    {member.status === 'active' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => { setDeletingMember(member); setDeleteModalOpen(true) }}
                                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-400 transition"
                                    title="Excluir membro"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Modal Create Member */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Cadastrar Novo Membro"
        icon={<UserPlus className="w-5 h-5" />}
      >
        <form onSubmit={handleCreateMemberSubmit} className="space-y-3 text-xs">
          <Input
            label="Nome Completo *"
            required
            placeholder="Ex: Carlos Gerente"
            value={newMember.fullName}
            onChange={(e) => setNewMember({ ...newMember, fullName: e.target.value })}
          />

          <Input
            label="E-mail Corporativo *"
            type="email"
            required
            placeholder="carlos@queroserfit.com.br"
            value={newMember.email}
            onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
          />

          <Select
            label="Cargo Inicial *"
            value={newMember.role}
            onChange={(e) => setNewMember({ ...newMember, role: e.target.value as UserRole })}
            options={[
              { value: 'attendant', label: 'Atendente / Vendedor' },
              { value: 'manager', label: 'Gerente (Manager)' },
              { value: 'admin', label: 'Administrador (Admin)' },
            ]}
          />

          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Senha Temporária *"
                  required
                  minLength={8}
                  placeholder="Mínimo 8 caracteres"
                  value={newMember.password}
                  onChange={(e) => setNewMember({ ...newMember, password: e.target.value })}
                />
              </div>
              <Button variant="secondary" type="button" onClick={generateTempPassword} className="mb-0.5">
                Gerar
              </Button>
            </div>
          </div>

          <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-300">
            O membro já é cadastrado ativo e pode fazer login imediatamente com esta senha. Compartilhe-a com
            ele(a) por um canal seguro — depois de entrar, a pessoa pode trocá-la a qualquer momento pelo menu
            de perfil.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setInviteModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" isLoading={creatingMember}>
              Cadastrar Membro
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Granular Custom Permissions */}
      <Modal
        isOpen={permissionsModalOpen}
        onClose={() => setPermissionsModalOpen(false)}
        title={`Matriz de Permissões — ${
          selectedMemberForPerms
            ? 'profiles' in selectedMemberForPerms && selectedMemberForPerms.profiles
              ? selectedMemberForPerms.profiles.full_name
              : 'fullName' in selectedMemberForPerms
              ? selectedMemberForPerms.fullName
              : 'Membro'
            : 'Membro'
        }`}
        icon={<SlidersHorizontal className="w-5 h-5 text-emerald-400" />}
      >
        <div className="space-y-5 text-xs max-h-[70vh] overflow-y-auto pr-1">
          <p className="text-slate-400">
            Ative ou desative as opções personalizadas que este membro terá permissão para executar no sistema:
          </p>

          {/* Categorized Permissions Grid */}
          <div className="space-y-4">
            {/* Category: Atendimento / Inbox */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-slate-200">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <span>Central de Conversas (Inbox)</span>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Ver conversas da equipe inteira</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.view_all_conversations}
                    onChange={() => togglePermission('view_all_conversations')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Assumir conversas da fila pública</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.assume_conversations}
                    onChange={() => togglePermission('assume_conversations')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Transferir conversas para colegas</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.transfer_conversations}
                    onChange={() => togglePermission('transfer_conversations')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Encerrar e arquivar atendimentos</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.close_conversations}
                    onChange={() => togglePermission('close_conversations')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Excluir mensagens ou notas internas</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.delete_messages}
                    onChange={() => togglePermission('delete_messages')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* Category: Clientes */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-slate-200">
                <Users className="w-4 h-4 text-teal-400" />
                <span>Gestão de Clientes (Leads)</span>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Cadastrar novos clientes</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.create_clients}
                    onChange={() => togglePermission('create_clients')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Editar dados de clientes</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.edit_clients}
                    onChange={() => togglePermission('edit_clients')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition text-rose-300">
                  <span className="font-medium">Excluir clientes do CRM</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.delete_clients}
                    onChange={() => togglePermission('delete_clients')}
                    className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition text-amber-300">
                  <span className="font-medium">Exportar lista de clientes (CSV/Excel)</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.export_clients}
                    onChange={() => togglePermission('export_clients')}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* Category: Tarefas */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-slate-200">
                <CheckSquare className="w-4 h-4 text-indigo-400" />
                <span>Gestão de Tarefas</span>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Criar tarefas</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.create_tasks}
                    onChange={() => togglePermission('create_tasks')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Atribuir tarefas para outros membros</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.assign_tasks_to_others}
                    onChange={() => togglePermission('assign_tasks_to_others')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Excluir tarefas do sistema</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.delete_tasks}
                    onChange={() => togglePermission('delete_tasks')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* Category: Relatórios & Equipe */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-slate-200">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                <span>Relatórios & Configurações</span>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Acessar dashboard de Relatórios</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.view_reports}
                    onChange={() => togglePermission('view_reports')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Gerenciar atendentes da equipe</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.manage_attendants}
                    onChange={() => togglePermission('manage_attendants')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/60 transition">
                  <span className="text-slate-300 font-medium">Gerenciar Integrações Meta (WhatsApp / Instagram)</span>
                  <input
                    type="checkbox"
                    checked={!!editingPermissions.manage_integrations}
                    onChange={() => togglePermission('manage_integrations')}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <Button variant="secondary" type="button" onClick={() => setPermissionsModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="button" onClick={handleSavePermissions}>
              Salvar Permissões
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Confirm Delete Member */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirmar Exclusão de Membro"
        icon={<AlertTriangle className="w-5 h-5 text-rose-500" />}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300 leading-relaxed">
            Tem certeza que deseja remover o membro{' '}
            <strong className="text-slate-100">{deletingMember?.fullName}</strong> ({deletingMember?.email})?
          </p>
          <p className="text-rose-400 bg-rose-950/40 border border-rose-800/40 p-3 rounded-xl">
            Atenção: Esta ação revogará os acessos e removerá o cadastro do membro na equipe.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setDeleteModalOpen(false)}>
              Cancelar
            </Button>
            <button
              type="button"
              onClick={handleDeleteMemberConfirm}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition"
            >
              Sim, Remover Membro
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

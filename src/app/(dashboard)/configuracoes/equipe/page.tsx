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
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { UserRole } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { DemoTeamMember } from '@/lib/demo'

export interface RealMember {
  user_id: string
  organization_id: string
  role: UserRole
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
  const [deletingMember, setDeletingMember] = useState<DemoTeamMember | null>(null)

  // Feedback State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [newMember, setNewMember] = useState({ fullName: '', email: '', role: 'attendant' as UserRole })

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
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
        .select('user_id, organization_id, role, created_at, profiles(full_name, email)')
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

  // Toggle Role (Admin ↔ Attendant)
  const toggleRoleDemo = (member: DemoTeamMember) => {
    setError(null)

    // Safeguard check
    if (member.role === 'admin' && member.status === 'active' && activeAdminCount <= 1) {
      setError('Operação negada: Não é possível alterar ou remover o único administrador ativo do sistema.')
      return
    }

    const nextRole: UserRole = member.role === 'admin' ? 'attendant' : 'admin'
    const updated = updateDemoMemberRole(member.id, nextRole)

    if (!updated) {
      setError('Operação negada: Não é possível alterar ou remover o único administrador ativo do sistema.')
      return
    }

    showToast(`Perfil de ${updated.fullName} alterado para ${updated.role === 'admin' ? 'Administrador' : 'Atendente'}.`)
  }

  // Toggle Status (Active ↔ Inactive)
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

  // Delete Member
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
    const nextRole: UserRole = member.role === 'admin' ? 'attendant' : 'admin'

    try {
      const supabase = createClient()
      const { error: rpcError } = await (supabase as unknown as {
        rpc: (fn: string, p: { p_org_id: string; p_target_user_id: string; p_new_role: UserRole }) => Promise<{ error: { message: string } | null }>
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

      showToast(`Perfil de ${member.profiles?.full_name || 'usuário'} alterado no Supabase.`)
      fetchRealMembers()
    } catch {
      setError('Erro ao executar alteração no Supabase.')
    }
  }

  // Handle Invite Form Submit
  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMember.fullName || !newMember.email) return

    if (viewMode === 'demo') {
      saveDemoMember({
        fullName: newMember.fullName,
        email: newMember.email,
        role: newMember.role,
        status: 'invited',
      })
      showToast(`Convite enviado com sucesso para ${newMember.email}!`)
    } else {
      showToast(`Convite registrado no Supabase para ${newMember.email}!`)
    }

    setNewMember({ fullName: '', email: '', role: 'attendant' })
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
            <h1 className="text-xl font-bold text-slate-100">Gestão da Equipe</h1>
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
            Gerencie os atendentes e administradores com salvaguarda para o único administrador ativo.
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
            <span>Convidar Membro</span>
          </Button>
        </div>
      </div>

      {/* Permissions Overview */}
      <Card className="p-4 text-xs space-y-2">
        <h2 className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span>Regras de Acesso e Salvaguarda do Último Administrador</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <span className="font-bold text-emerald-400 uppercase tracking-wider text-[10px]">Administrador</span>
            <p className="text-slate-400 text-[11px] mt-1">
              Acesso total às configurações. O único administrador ativo é protegido e não pode ser rebaixado ou excluído.
            </p>
          </div>
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
            <span className="font-bold text-teal-400 uppercase tracking-wider text-[10px]">Atendente</span>
            <p className="text-slate-400 text-[11px] mt-1">
              Acessa conversas do inbox, carteira de clientes e gerenciador de tarefas da equipe.
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
                  <th className="py-3 px-4">Perfil</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
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
                          ) : (
                            <Badge variant="teal" icon={<UserCheck className="w-3 h-3" />}>
                              Atendente
                            </Badge>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-emerald-400 font-medium">Ativo</td>
                        <td className="py-3.5 px-4 text-right">
                          <Button variant="secondary" size="sm" onClick={() => toggleRoleReal(member)}>
                            Alterar Perfil
                          </Button>
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
                              {/* Visual Safeguard for Sole Admin */}
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
                                    {member.role === 'admin' ? 'Tornar Atendente' : 'Tornar Admin'}
                                  </Button>

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

      {/* Modal Invite Member */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Convidar Novo Membro"
        icon={<UserPlus className="w-5 h-5" />}
      >
        <form onSubmit={handleInviteSubmit} className="space-y-3 text-xs">
          <Input
            label="Nome Completo *"
            required
            placeholder="Ex: Fernanda Vendas"
            value={newMember.fullName}
            onChange={(e) => setNewMember({ ...newMember, fullName: e.target.value })}
          />

          <Input
            label="E-mail Corporativo *"
            type="email"
            required
            placeholder="fernanda@queroserfit.com.br"
            value={newMember.email}
            onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
          />

          <Select
            label="Perfil de Acesso *"
            value={newMember.role}
            onChange={(e) => setNewMember({ ...newMember, role: e.target.value as UserRole })}
            options={[
              { value: 'attendant', label: 'Atendente' },
              { value: 'admin', label: 'Administrador' },
            ]}
          />

          <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-300">
            O membro receberá o convite com o status inicial &ldquo;Pendente&rdquo; para ativação.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setInviteModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Enviar Convite
            </Button>
          </div>
        </form>
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

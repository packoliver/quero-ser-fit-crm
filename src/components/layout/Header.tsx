'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dumbbell,
  LogOut,
  UserCheck,
  ShieldCheck,
  ChevronDown,
  Bell,
  User as UserIcon,
  CheckCircle2,
  Clock,
  Building,
  Shield,
  KeyRound,
  AlertCircle,
} from 'lucide-react'
import { UserRole } from '@/types/database'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useDemoStorage } from '@/lib/demo/useDemoStorage'
import { changePasswordSchema } from '@/lib/validations'
import { createClient } from '@/lib/supabase/client'
import { signOutEverywhere } from '@/lib/auth-client'

export interface HeaderProps {
  currentRole?: UserRole
  onToggleRole?: () => void
  /** The real authenticated user's name/email — when present, this is a real session and
   * every bit of demo/placeholder identity (name, email, notification tasks) is replaced
   * by the genuine thing instead. Absent only in local demo/preview usage. */
  realUser?: { fullName: string; email: string } | null
}

interface RealPendingTask {
  id: string
  title: string
  description: string | null
  due_date: string | null
}

export function Header({ currentRole = 'admin', onToggleRole, realUser }: HeaderProps) {
  const router = useRouter()
  const { tasks: demoTasks } = useDemoStorage()
  const [realPendingTasks, setRealPendingTasks] = useState<RealPendingTask[]>([])

  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Numa sessão real, o sino tem que mostrar as tarefas pendentes de verdade da
  // organização — nunca os dados de demonstração salvos no localStorage (que sobrevivem
  // entre sessões e não têm nada a ver com o que essa conta realmente tem pendente).
  useEffect(() => {
    let cancelled = false

    const fetchPendingTasks = async () => {
      if (!realUser) {
        if (!cancelled) setRealPendingTasks([])
        return
      }
      try {
        const supabase = createClient()
        const { data } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, val: string) => {
                order: (col: string, opt: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: RealPendingTask[] | null }> }
              }
            }
          }
        })
          .from('tasks')
          .select('id, title, description, due_date')
          .eq('status', 'pending')
          .order('due_date', { ascending: true })
          .limit(5)

        if (!cancelled) setRealPendingTasks(data || [])
      } catch {
        if (!cancelled) setRealPendingTasks([])
      }
    }

    void fetchPendingTasks()
    return () => {
      cancelled = true
    }
  }, [realUser])

  const pendingTasks = realUser
    ? realPendingTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description || 'Sem descrição.',
        dueDate: t.due_date ? new Date(t.due_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem prazo',
      }))
    : demoTasks.filter((t) => t.status === 'pending')

  const roleLabel = currentRole === 'admin' ? 'Administrador' : currentRole === 'manager' ? 'Gerente' : 'Atendente'
  const userName = realUser ? realUser.fullName : currentRole === 'admin' ? 'Patricia Silva (Admin, demo)' : currentRole === 'manager' ? 'Patricia Silva (Gerente, demo)' : 'Carlos Atendimento (demo)'
  const userEmail = realUser ? realUser.email : currentRole === 'admin' ? 'comercial@queroserfit.com' : currentRole === 'manager' ? 'comercial@queroserfit.com' : 'carlos@queroserfit.com.br'

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const openPasswordModal = () => {
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError(null)
    setPasswordSuccess(false)
    setPasswordModalOpen(true)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)

    const validation = changePasswordSchema.safeParse({ password: newPassword })
    if (!validation.success) {
      setPasswordError(validation.error.issues[0]?.message || 'Senha inválida.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem.')
      return
    }

    setChangingPassword(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })

      if (updateError) {
        setPasswordError(updateError.message || 'Falha ao atualizar a senha.')
        setChangingPassword(false)
        return
      }

      setPasswordSuccess(true)
    } catch {
      setPasswordError('Erro de conexão ao tentar atualizar a senha.')
    } finally {
      setChangingPassword(false)
    }
  }

  const handleLogout = async () => {
    await signOutEverywhere()
    router.push('/login')
    router.refresh()
  }

  return (
    // A altura cresce pelo tamanho do entalhe (--safe-top) e o mesmo valor vira padding
    // superior, empurrando o conteúdo pra baixo dele. Necessário porque o app declara
    // statusBarStyle 'black-translucent' + viewport-fit=cover: instalado como PWA no
    // iPhone, a página começa no topo absoluto da tela, por baixo da barra de status.
    // Em aparelho sem entalhe (e no desktop) --safe-top é 0 e nada muda.
    <header className="h-[calc(4rem+var(--safe-top))] pt-[var(--safe-top)] border-b border-slate-800 bg-[#0f172a]/90 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-6 flex items-center justify-between select-none shrink-0">
      {/* Left side brand info */}
      <div className="flex items-center gap-3">
        <div className="lg:hidden flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 shadow-md">
            <Dumbbell className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm text-slate-100">Quero Ser Fit</span>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>CRM Operacional Conectado</span>
        </div>
      </div>

      {/* Right side notification bell, role switcher & profile dropdown */}
      <div className="flex items-center gap-3">
        {/* Role Switcher Button */}
        {onToggleRole && (
          <button
            onClick={onToggleRole}
            title="Alternar Perfil Simulado (Admin vs Atendente)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {currentRole === 'admin' ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Admin</span>
              </>
            ) : currentRole === 'manager' ? (
              <>
                <Shield className="w-4 h-4 text-indigo-400" />
                <span>Gerente</span>
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4 text-teal-400" />
                <span>Atendente</span>
              </>
            )}
            <span className="text-[10px] text-slate-500 ml-1 hidden sm:inline">(Alternar Perfil)</span>
          </button>
        )}

        {/* Notifications Dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => {
              setNotifOpen(!notifOpen)
              setMenuOpen(false)
            }}
            aria-label="Notificações e Pendências"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition relative focus:outline-none focus:ring-2 focus:ring-emerald-500"
            title="Notificações e Lembretes"
          >
            <Bell className="w-4 h-4" />
            {pendingTasks.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white font-bold text-[10px] flex items-center justify-center animate-pulse">
                {pendingTasks.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-[#131f37] border border-slate-700 rounded-2xl shadow-2xl py-3 z-50 text-xs animate-in fade-in zoom-in-95">
              <div className="px-4 pb-2 border-b border-slate-800 flex items-center justify-between">
                <span className="font-bold text-slate-100 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-emerald-400" />
                  Notificações & Lembretes
                </span>
                <Badge variant="amber">{pendingTasks.length} Pendente(s)</Badge>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 my-1">
                {pendingTasks.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    Nenhuma tarefa ou pendência no momento! 🎉
                  </div>
                ) : (
                  pendingTasks.slice(0, 5).map((task) => (
                    <div
                      key={task.id}
                      onClick={() => {
                        setNotifOpen(false)
                        router.push('/tarefas')
                      }}
                      className="p-3 hover:bg-slate-800/60 transition cursor-pointer space-y-1"
                    >
                      <div className="flex justify-between items-start">
                        <p className="font-semibold text-slate-200 line-clamp-1">{task.title}</p>
                        <span className="text-[10px] text-amber-400 flex items-center gap-0.5 shrink-0 font-mono">
                          <Clock className="w-3 h-3" />
                          {task.dueDate}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1">{task.description}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 px-3 border-t border-slate-800 text-center">
                <button
                  onClick={() => {
                    setNotifOpen(false)
                    router.push('/tarefas')
                  }}
                  className="text-[11px] text-emerald-400 hover:underline font-semibold"
                >
                  Ver todas as tarefas no painel →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              setMenuOpen(!menuOpen)
              setNotifOpen(false)
            }}
            aria-expanded={menuOpen}
            aria-label="Menu do Usuário"
            className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-800 transition focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center border border-emerald-400/40 shadow-sm">
              {userName.charAt(0)}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-slate-200">{userName}</p>
              <p className="text-[10px] text-slate-400">
                {roleLabel}
              </p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-60 bg-[#131f37] border border-slate-700 rounded-2xl shadow-2xl py-2 z-50 text-xs animate-in fade-in zoom-in-95">
              <div className="px-4 py-3 border-b border-slate-800">
                <p className="font-bold text-slate-100">{userName}</p>
                <p className="text-slate-400 text-[11px] truncate">{userEmail}</p>
                <div className="mt-1.5">
                  <Badge variant={currentRole === 'admin' ? 'emerald' : currentRole === 'manager' ? 'indigo' : 'teal'}>
                    {roleLabel}
                  </Badge>
                </div>
              </div>

              <div className="py-1">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setProfileModalOpen(true)
                  }}
                  className="w-full text-left px-4 py-2 text-slate-200 hover:bg-slate-800 flex items-center gap-2 transition"
                >
                  <UserIcon className="w-4 h-4 text-emerald-400" />
                  <span>Meu Perfil</span>
                </button>

                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openPasswordModal()
                  }}
                  className="w-full text-left px-4 py-2 text-slate-200 hover:bg-slate-800 flex items-center gap-2 transition"
                >
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span>Trocar Senha</span>
                </button>
              </div>

              <div className="pt-1 border-t border-slate-800">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-rose-400 hover:bg-rose-950/40 flex items-center gap-2 font-medium transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sair da Conta (Logout)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Profile Modal */}
      <Modal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        title="Perfil do Usuário"
        icon={<UserIcon className="w-5 h-5" />}
      >
        <div className="space-y-4 text-xs">
          <div className="flex items-center gap-3.5 p-3.5 bg-slate-900 rounded-xl border border-slate-800">
            <div className="w-12 h-12 rounded-full bg-emerald-600 text-white font-extrabold text-base flex items-center justify-center shadow-lg">
              {userName.charAt(0)}
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100">{userName}</h3>
              <p className="text-slate-400">{userEmail}</p>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Building className="w-4 h-4 text-emerald-400" /> Organização Ativa:
              </span>
              <span className="font-bold text-slate-100">Quero Ser Fit</span>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-teal-400" /> Nível de Permissão:
              </span>
              <Badge variant={currentRole === 'admin' ? 'emerald' : currentRole === 'manager' ? 'indigo' : 'teal'}>
                {currentRole === 'admin' ? 'Administrador Total' : currentRole === 'manager' ? 'Supervisão Gerencial' : 'Atendimento Operacional'}
              </Badge>
            </div>

            <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Status da Conta:
              </span>
              <span className="text-emerald-400 font-semibold">Ativa e Autenticada</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setProfileModalOpen(false)}>
              Fechar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        isOpen={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        title="Trocar Senha"
        icon={<KeyRound className="w-5 h-5" />}
      >
        {passwordSuccess ? (
          <div className="text-center py-4 space-y-4 text-xs">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-slate-200 text-sm">Senha atualizada!</h3>
            <p className="text-slate-400 leading-relaxed">
              Sua senha foi trocada com sucesso. Use a nova senha no seu próximo login.
            </p>
            <Button variant="secondary" onClick={() => setPasswordModalOpen(false)}>
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
            {passwordError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{passwordError}</span>
              </div>
            )}

            <Input
              label="Nova Senha *"
              type="password"
              required
              minLength={8}
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />

            <Input
              label="Confirmar Nova Senha *"
              type="password"
              required
              minLength={8}
              placeholder="Repita a nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => setPasswordModalOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit" isLoading={changingPassword}>
                Salvar Nova Senha
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </header>
  )
}

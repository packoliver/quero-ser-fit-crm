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
  Moon,
  Sun,
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
import { useTheme } from '@/components/layout/ThemeProvider'

export interface HeaderProps {
  currentRole?: UserRole
  onToggleRole?: () => void
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
  const { theme, setTheme, resolvedTheme } = useTheme()
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

  const cycleTheme = () => {
    if (resolvedTheme === 'dark') setTheme('light')
    else setTheme('dark')
  }

  return (
    <header className="h-[calc(4rem+var(--safe-top))] pt-[var(--safe-top)] border-b sidebar-border chat-header-bg sticky top-0 z-40 px-4 lg:px-6 flex items-center justify-between select-none shrink-0 transition-colors duration-200">
      {/* Left side brand info */}
      <div className="flex items-center gap-3">
        <div className="lg:hidden flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg accent-bg flex items-center justify-center text-white shadow-md">
            <Dumbbell className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm text-[var(--foreground)]">Quero Ser Fit</span>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-xs sidebar-text">
          <span className="w-2 h-2 rounded-full accent-bg animate-pulse" />
          <span>CRM Operacional Conectado</span>
        </div>
      </div>

      {/* Right side notification bell, role switcher & profile dropdown */}
      <div className="flex items-center gap-3">
        {/* Theme Toggle */}
        <button
          onClick={cycleTheme}
          aria-label={`Alternar tema (${resolvedTheme})`}
          title={`Tema: ${resolvedTheme === 'dark' ? 'Escuro' : 'Claro'}`}
          className="p-2 rounded-xl surface-hover border surface-border sidebar-text transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        >
          {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Role Switcher Button */}
        {onToggleRole && (
          <button
            onClick={onToggleRole}
            title="Alternar Perfil Simulado (Admin vs Atendente)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full surface-hover sidebar-text border surface-border transition text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            {currentRole === 'admin' ? (
              <>
                <ShieldCheck className="w-4 h-4 accent-text" />
                <span>Admin</span>
              </>
            ) : currentRole === 'manager' ? (
              <>
                <Shield className="w-4 h-4 text-indigo-500" />
                <span>Gerente</span>
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4 text-teal-500" />
                <span>Atendente</span>
              </>
            )}
            <span className="text-[10px] sidebar-text ml-1 hidden sm:inline opacity-70">(Alternar Perfil)</span>
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
            className="p-2 rounded-xl surface-hover border surface-border sidebar-text transition relative focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            title="Notificações e Lembretes"
          >
            <Bell className="w-4 h-4" />
            {pendingTasks.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--danger)] text-white font-bold text-[10px] flex items-center justify-center animate-pulse">
                {pendingTasks.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 surface-bg border surface-border rounded-2xl shadow-2xl py-3 z-50 text-xs animate-in fade-in zoom-in-95">
              <div className="px-4 pb-2 border-b surface-border flex items-center justify-between">
                <span className="font-bold text-[var(--foreground)] flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 accent-text" />
                  Notificações & Lembretes
                </span>
                <Badge variant="amber">{pendingTasks.length} Pendente(s)</Badge>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-[var(--surface-border)] my-1">
                {pendingTasks.length === 0 ? (
                  <div className="p-4 text-center sidebar-text text-xs">
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
                      className="p-3 surface-hover transition cursor-pointer space-y-1"
                    >
                      <div className="flex justify-between items-start">
                        <p className="font-semibold text-[var(--foreground)] line-clamp-1">{task.title}</p>
                        <span className="text-[10px] text-[var(--warning)] flex items-center gap-0.5 shrink-0 font-mono">
                          <Clock className="w-3 h-3" />
                          {task.dueDate}
                        </span>
                      </div>
                      <p className="text-[11px] sidebar-text line-clamp-1">{task.description}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 px-3 border-t surface-border text-center">
                <button
                  onClick={() => {
                    setNotifOpen(false)
                    router.push('/tarefas')
                  }}
                  className="text-[11px] accent-text hover:underline font-semibold"
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
            className="flex items-center gap-2 p-1.5 rounded-xl surface-hover transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <div className="w-8 h-8 rounded-full accent-bg text-white font-bold text-xs flex items-center justify-center border border-[var(--accent-green)]/40 shadow-sm">
              {userName.charAt(0)}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-[var(--foreground)]">{userName}</p>
              <p className="text-[10px] sidebar-text">
                {roleLabel}
              </p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 sidebar-text" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-60 surface-bg border surface-border rounded-2xl shadow-2xl py-2 z-50 text-xs animate-in fade-in zoom-in-95">
              <div className="px-4 py-3 border-b surface-border">
                <p className="font-bold text-[var(--foreground)]">{userName}</p>
                <p className="sidebar-text text-[11px] truncate">{userEmail}</p>
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
                  className="w-full text-left px-4 py-2 text-[var(--foreground)] surface-hover flex items-center gap-2 transition"
                >
                  <UserIcon className="w-4 h-4 accent-text" />
                  <span>Meu Perfil</span>
                </button>

                <button
                  onClick={() => {
                    setMenuOpen(false)
                    openPasswordModal()
                  }}
                  className="w-full text-left px-4 py-2 text-[var(--foreground)] surface-hover flex items-center gap-2 transition"
                >
                  <KeyRound className="w-4 h-4 accent-text" />
                  <span>Trocar Senha</span>
                </button>
              </div>

              <div className="pt-1 border-t surface-border">
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-[var(--danger)] hover:bg-[var(--danger)]/10 flex items-center gap-2 font-medium transition"
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
          <div className="flex items-center gap-3.5 p-3.5 surface-bg rounded-xl border surface-border">
            <div className="w-12 h-12 rounded-full accent-bg text-white font-extrabold text-base flex items-center justify-center shadow-lg">
              {userName.charAt(0)}
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--foreground)]">{userName}</h3>
              <p className="sidebar-text">{userEmail}</p>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between p-2.5 surface-bg rounded-xl border surface-border">
              <span className="sidebar-text flex items-center gap-1.5">
                <Building className="w-4 h-4 accent-text" /> Organização Ativa:
              </span>
              <span className="font-bold text-[var(--foreground)]">Quero Ser Fit</span>
            </div>

            <div className="flex items-center justify-between p-2.5 surface-bg rounded-xl border surface-border">
              <span className="sidebar-text flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-teal-500" /> Nível de Permissão:
              </span>
              <Badge variant={currentRole === 'admin' ? 'emerald' : currentRole === 'manager' ? 'indigo' : 'teal'}>
                {currentRole === 'admin' ? 'Administrador Total' : currentRole === 'manager' ? 'Supervisão Gerencial' : 'Atendimento Operacional'}
              </Badge>
            </div>

            <div className="flex items-center justify-between p-2.5 surface-bg rounded-xl border surface-border">
              <span className="sidebar-text flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 accent-text" /> Status da Conta:
              </span>
              <span className="accent-text font-semibold">Ativa e Autenticada</span>
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
            <div className="w-12 h-12 rounded-full bg-[var(--accent-green)]/20 accent-text flex items-center justify-center mx-auto border border-[var(--accent-green)]/30">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-[var(--foreground)] text-sm">Senha atualizada!</h3>
            <p className="sidebar-text leading-relaxed">
              Sua senha foi trocada com sucesso. Use a nova senha no seu próximo login.
            </p>
            <Button variant="secondary" onClick={() => setPasswordModalOpen(false)}>
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
            {passwordError && (
              <div className="p-3 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[var(--danger)] flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
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
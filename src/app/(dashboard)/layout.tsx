'use client'

import { useEffect, useState } from 'react'
import { DesktopSidebar } from '@/components/layout/DesktopSidebar'
import { Header } from '@/components/layout/Header'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { CurrentUserProvider } from '@/components/layout/CurrentUserProvider'
import { MobileChromeProvider, useMobileChrome } from '@/components/layout/MobileChromeProvider'
import { createClient } from '@/lib/supabase/client'
import { UserRole } from '@/types/database'
import { NetworkStatus } from '@/components/pwa/NetworkStatus'
import { getOfflineScope } from '@/lib/offline/scope'
import { replayOfflineMutations } from '@/lib/offline/sync'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `demoRole` backs the "Alternar Perfil Simulado" toggle — a preview-only affordance
  // (no real login) for showing what each role's nav looks like. `realRole` is the
  // actual authenticated user's role, resolved once from organization_members and used
  // instead whenever a real session exists. Defaults to the least-privileged role while
  // it's loading (or if the lookup fails) — flashing an over-privileged nav for a split
  // second is worse than briefly under-showing it, since the real security boundary
  // (RLS + middleware redirects) doesn't depend on this anyway, but a confused attendant
  // clicking an Admin-only link that then bounces them is a bad first impression.
  const [demoRole, setDemoRole] = useState<UserRole>('admin')
  const [realRole, setRealRole] = useState<UserRole | null>(null)
  const [realUser, setRealUser] = useState<{ fullName: string; email: string } | null>(null)
  const [isRealSession, setIsRealSession] = useState(false)

  useEffect(() => {
    let cancelled = false

    const resolveRealSession = async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) return

        const [{ data: member }, { data: profile }] = await Promise.all([
          (supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (col: string, val: string) => { single: () => Promise<{ data: { role: UserRole } | null }> }
              }
            }
          })
            .from('organization_members')
            .select('role')
            .eq('user_id', user.id)
            .single(),
          (supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (col: string, val: string) => { single: () => Promise<{ data: { full_name: string; email: string } | null }> }
              }
            }
          })
            .from('profiles')
            .select('full_name, email')
            .eq('id', user.id)
            .single(),
        ])

        if (cancelled) return

        setIsRealSession(true)
        if (member?.role) setRealRole(member.role)
        setRealUser({ fullName: profile?.full_name || user.email || 'Usuário', email: profile?.email || user.email || '' })
      } catch {
        // Sem sessão real (ou Supabase não configurado) — segue no modo simulado local.
      }
    }

    void resolveRealSession()

    const replay = () => {
      void getOfflineScope().then((scope) => scope && replayOfflineMutations(scope))
    }
    window.addEventListener('online', replay)
    replay()
    return () => {
      window.removeEventListener('online', replay)
      cancelled = true
    }
  }, [])

  const toggleDemoRole = () => {
    setDemoRole((prev) => {
      if (prev === 'admin') return 'manager'
      if (prev === 'manager') return 'attendant'
      return 'admin'
    })
  }

  const currentRole = isRealSession ? realRole || 'attendant' : demoRole

  return (
    <CurrentUserProvider value={{ role: currentRole, user: realUser, isRealSession }}>
      <MobileChromeProvider>
        <DashboardShell
          currentRole={currentRole}
          onToggleRole={isRealSession ? undefined : toggleDemoRole}
          realUser={realUser}
        >
          {children}
        </DashboardShell>
      </MobileChromeProvider>
    </CurrentUserProvider>
  )
}

/**
 * Separado do componente acima só porque precisa LER o MobileChromeProvider — um
 * componente não enxerga um contexto que ele mesmo fornece na própria renderização.
 */
function DashboardShell({
  currentRole,
  onToggleRole,
  realUser,
  children,
}: {
  currentRole: UserRole
  onToggleRole?: () => void
  realUser: { fullName: string; email: string } | null
  children: React.ReactNode
}) {
  // Uma tela pode pedir o celular inteiro pra si (hoje: conversa aberta no Inbox). No
  // desktop isso é ignorado — ver MobileChromeProvider.
  const { immersive } = useMobileChrome()

  return (
    /*
      Casca de aplicativo: altura exata da tela (h-dvh) com a rolagem acontecendo DENTRO
      do <main>, em vez de min-h-screen deixando o documento inteiro rolar.

      `dvh` e não `vh`: no navegador do celular 100vh é medido com a barra de endereço
      escondida, então a parte de baixo da tela ficava fora do alcance até a pessoa rolar
      — e com o teclado aberto o 100vh nem encolhia, escondendo o campo de digitar. `dvh`
      acompanha a altura realmente visível.
    */
    <div className="h-dvh bg-[#0b1320] text-slate-100 flex flex-row w-full overflow-hidden">
      <NetworkStatus />
      {/* Desktop Navigation (Filtered by currentRole) */}
      <DesktopSidebar userRole={currentRole} />

      {/* O padding de baixo reserva o espaço da barra fixa do celular (conteúdo + recorte
          do aparelho, ver --bottom-nav-h em globals.css). Em modo imersivo a barra não
          está lá, então o padding some junto — senão sobraria um vão morto de 60px. */}
      <div
        className={`flex-1 flex flex-col min-w-0 h-full lg:pb-0 ${
          immersive ? 'pb-0' : 'pb-[var(--bottom-nav-h)]'
        }`}
      >
        {/* Escondido no celular em modo imersivo: a tela que pediu imersão traz o próprio
            cabeçalho de contexto (na conversa, o nome do cliente), e dois empilhados só
            gastam altura. No desktop continua sempre visível. */}
        <div className={immersive ? 'hidden lg:contents' : 'contents'}>
          {/* O toggle de perfil simulado só existe fora de uma sessão real — ninguém deve
              poder "se fingir" de outro cargo numa conta de verdade. */}
          <Header currentRole={currentRole} onToggleRole={onToggleRole} realUser={realUser} />
        </div>
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">{children}</main>
      </div>

      {/* Mobile Navigation (Filtered by currentRole) */}
      {!immersive && <MobileBottomNav userRole={currentRole} />}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dumbbell } from 'lucide-react'
import { getNavItemsForRole } from '@/lib/navigation'
import { UserRole } from '@/types/database'
import { useUnread } from '@/components/layout/UnreadProvider'
import { formatUnreadBadge } from '@/lib/inbox/unread'

export interface DesktopSidebarProps {
  userRole?: UserRole
}

export function DesktopSidebar({ userRole = 'admin' }: DesktopSidebarProps) {
  const pathname = usePathname()
  const navItems = getNavItemsForRole(userRole)
  // Antes do return abaixo de propósito: hook não pode ficar depois de uma saída
  // condicional, senão a ordem das chamadas muda entre renderizações e o React quebra.
  const { total: unreadTotal } = useUnread()

  // Hide sidebar on public login pages if rendered inside non-grouped layout
  if (pathname === '/login' || pathname === '/recuperar-senha') {
    return null
  }

  return (
    <aside
      aria-label="Navegação Principal Desktop"
      className="hidden lg:flex flex-col w-64 border-r sidebar-border sidebar-bg h-screen sticky top-0 shrink-0 select-none transition-colors duration-200"
    >
      {/* Brand Header */}
      <div className="p-5 flex items-center gap-3 border-b sidebar-border transition-colors duration-200">
        <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center text-white shadow-lg shadow-emerald-900/20">
          <Dumbbell className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-[var(--foreground)] text-sm tracking-wide transition-colors duration-200">
            Quero Ser Fit
          </h1>
          <span className="text-xs accent-text font-medium bg-[var(--surface-hover)] px-2 py-0.5 rounded-full border surface-border transition-colors duration-200">
            CRM Oficial
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-semibold sidebar-text uppercase tracking-wider opacity-70 transition-colors duration-200">
          Menu ({userRole === 'admin' ? 'Administrador' : userRole === 'manager' ? 'Gerente' : 'Atendente'})
        </div>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${
                isActive
                  ? 'sidebar-item-active accent-text font-semibold shadow-sm border surface-border'
                  : 'sidebar-text sidebar-item-hover'
              }`}
            >
              <Icon className={`w-4 h-4 transition-colors duration-200 ${isActive ? 'accent-text' : 'sidebar-text'}`} />
              <span className="flex-1">{item.label}</span>
              {/* Mesma contagem da barra do celular (ver UnreadProvider) — aqui cabe ao
                  lado do rótulo, então não precisa ficar por cima do ícone. */}
              {item.href === '/inbox' && unreadTotal > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full unread-badge-bg text-white text-[10px] font-bold flex items-center justify-center tabular-nums shrink-0">
                  {formatUnreadBadge(unreadTotal)}
                  <span className="sr-only"> mensagens não lidas</span>
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t sidebar-border text-xs sidebar-text flex justify-between items-center transition-colors duration-200">
        <span>Quero Ser Fit</span>
        <span className="text-[10px] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded sidebar-text border surface-border transition-colors duration-200">v1.1</span>
      </div>
    </aside>
  )
}
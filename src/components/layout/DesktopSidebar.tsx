'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dumbbell } from 'lucide-react'
import { getNavItemsForRole } from '@/lib/navigation'
import { UserRole } from '@/types/database'

export interface DesktopSidebarProps {
  userRole?: UserRole
}

export function DesktopSidebar({ userRole = 'admin' }: DesktopSidebarProps) {
  const pathname = usePathname()
  const navItems = getNavItemsForRole(userRole)

  // Hide sidebar on public login pages if rendered inside non-grouped layout
  if (pathname === '/login' || pathname === '/recuperar-senha') {
    return null
  }

  return (
    <aside
      aria-label="Navegação Principal Desktop"
      className="hidden lg:flex flex-col w-64 border-r border-slate-800 bg-[#0f172a] h-screen sticky top-0 shrink-0 select-none"
    >
      {/* Brand Header */}
      <div className="p-5 flex items-center gap-3 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-900/30">
          <Dumbbell className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-slate-100 text-sm tracking-wide">
            Quero Ser Fit
          </h1>
          <span className="text-xs text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/40">
            CRM Oficial
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          Menu ({userRole === 'admin' ? 'Administrador' : 'Atendente'})
        </div>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 flex justify-between items-center">
        <span>Quero Ser Fit</span>
        <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">v1.1</span>
      </div>
    </aside>
  )
}

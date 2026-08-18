'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getNavItemsForRole } from '@/lib/navigation'
import { UserRole } from '@/types/database'

export interface MobileBottomNavProps {
  userRole?: UserRole
}

export function MobileBottomNav({ userRole = 'admin' }: MobileBottomNavProps) {
  const pathname = usePathname()
  const navItems = getNavItemsForRole(userRole)

  if (pathname === '/login' || pathname === '/recuperar-senha') {
    return null
  }

  return (
    <nav
      aria-label="Navegação Inferior Mobile"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0f172a]/95 backdrop-blur-md border-t border-slate-800 px-2 py-1.5 shadow-2xl pb-safe select-none"
    >
      <div className="flex justify-around items-center">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center py-1 px-3 rounded-lg text-[11px] font-medium transition-all active:scale-90 ${
                isActive
                  ? 'text-emerald-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`p-1 rounded-full ${
                  isActive ? 'bg-emerald-500/20 text-emerald-400' : ''
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="mt-0.5">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
